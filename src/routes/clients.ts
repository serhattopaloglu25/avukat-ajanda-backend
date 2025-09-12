import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createClientSchema = z.object({
  name: z.string().min(1, 'İsim zorunludur'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  tcKimlik: z.string().length(11).optional().nullable(),
  vergiNo: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([])
});

const updateClientSchema = createClientSchema.partial();

// Get all clients with filtering
router.get('/api/clients', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { 
      search, 
      tags,
      page = '1',
      limit = '20',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Build where clause
    const where: any = { orgId };
    
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string, mode: 'insensitive' } },
        { tcKimlik: { contains: search as string, mode: 'insensitive' } },
        { vergiNo: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      where.tags = { hasSome: tagArray };
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          _count: {
            select: {
              cases: true,
              invoices: true
            }
          }
        }
      }),
      prisma.client.count({ where })
    ]);

    res.json({
      clients,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Müvekkiller yüklenemedi' });
  }
});

// Get single client with related data
router.get('/api/clients/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    const client = await prisma.client.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      },
      include: {
        cases: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        invoices: {
          orderBy: { date: 'desc' },
          take: 10
        },
        documents: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Müvekkil bulunamadı' });
    }

    res.json(client);
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ error: 'Müvekkil bilgileri yüklenemedi' });
  }
});

// Create client
router.post('/api/clients', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId!;
    const userId = req.userId!;
    
    const validatedData = createClientSchema.parse(req.body);

    const client = await prisma.client.create({
      data: {
        ...validatedData,
        orgId,
        createdByUserId: userId
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'create',
        entityType: 'client',
        entityId: client.id.toString(),
        meta: validatedData
      }
    });

    res.status(201).json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Müvekkil oluşturulamadı' });
  }
});

// Update client
router.put('/api/clients/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;
    
    const validatedData = updateClientSchema.parse(req.body);

    // Check if client exists and belongs to org
    const existing = await prisma.client.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Müvekkil bulunamadı' });
    }

    const client = await prisma.client.update({
      where: { id: parseInt(id) },
      data: {
        ...validatedData,
        updatedByUserId: userId
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'update',
        entityType: 'client',
        entityId: id,
        meta: validatedData
      }
    });

    res.json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Update client error:', error);
    res.status(500).json({ error: 'Müvekkil güncellenemedi' });
  }
});

// Delete client (soft delete by archiving related data)
router.delete('/api/clients/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;

    // Check if client exists and has no active cases
    const client = await prisma.client.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      },
      include: {
        _count: {
          select: {
            cases: {
              where: { status: 'active' }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Müvekkil bulunamadı' });
    }

    if (client._count.cases > 0) {
      return res.status(400).json({ 
        error: 'Aktif davası olan müvekkil silinemez' 
      });
    }

    // Archive all related cases
    await prisma.case.updateMany({
      where: { clientId: parseInt(id) },
      data: { status: 'archived' }
    });

    // Delete the client
    await prisma.client.delete({
      where: { id: parseInt(id) }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'delete',
        entityType: 'client',
        entityId: id,
        meta: { clientName: client.name }
      }
    });

    res.json({ message: 'Müvekkil başarıyla silindi' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Müvekkil silinemedi' });
  }
});

// Get client statistics
router.get('/api/clients/:id/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;

    const [
      totalCases,
      activeCases,
      totalInvoices,
      unpaidAmount,
      totalDocuments
    ] = await Promise.all([
      prisma.case.count({
        where: { clientId: parseInt(id), orgId }
      }),
      prisma.case.count({
        where: { clientId: parseInt(id), orgId, status: 'active' }
      }),
      prisma.invoice.count({
        where: { clientId: parseInt(id), orgId }
      }),
      prisma.invoice.aggregate({
        where: { 
          clientId: parseInt(id), 
          orgId,
          status: { in: ['draft', 'sent', 'overdue'] }
        },
        _sum: { totalAmount: true }
      }),
      prisma.document.count({
        where: { clientId: parseInt(id), orgId }
      })
    ]);

    res.json({
      totalCases,
      activeCases,
      totalInvoices,
      unpaidAmount: unpaidAmount._sum.totalAmount || 0,
      totalDocuments
    });
  } catch (error) {
    console.error('Get client stats error:', error);
    res.status(500).json({ error: 'İstatistikler yüklenemedi' });
  }
});

export default router;