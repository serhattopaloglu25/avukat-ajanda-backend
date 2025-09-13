import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createCaseSchema = z.object({
  clientId: z.number(),
  title: z.string().min(1, 'Başlık zorunludur'),
  caseNo: z.string().optional().nullable(),
  court: z.string().optional().nullable(),
  jurisdiction: z.string().optional().nullable(),
  judge: z.string().optional().nullable(),
  status: z.enum(['active', 'pending', 'closed', 'archived']).optional(),
  description: z.string().optional().nullable(),
  hearingDates: z.array(z.string().datetime()).optional().default([]),
  nextHearing: z.string().datetime().optional().nullable()
});

const updateCaseSchema = createCaseSchema.partial().omit({ clientId: true });

// Get all cases with filtering
router.get('/api/cases', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { 
      search, 
      status,
      clientId,
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
        { title: { contains: search as string, mode: 'insensitive' } },
        { caseNo: { contains: search as string, mode: 'insensitive' } },
        { court: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (status) {
      where.status = status;
    }

    if (clientId) {
      where.clientId = parseInt(clientId as string);
    }

    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          },
          _count: {
            select: {
              events: true,
              files: true,
              expenses: true,
              advances: true
            }
          }
        }
      }),
      prisma.case.count({ where })
    ]);

    res.json({
      cases,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('Get cases error:', error);
    res.status(500).json({ error: 'Davalar yüklenemedi' });
  }
});

// Get single case with full details
router.get('/api/cases/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    const caseData = await prisma.case.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      },
      include: {
        client: true,
        events: {
          orderBy: { startAt: 'asc' }
        },
        files: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        documents: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        expenses: {
          orderBy: { date: 'desc' }
        },
        advances: {
          orderBy: { date: 'desc' }
        },
        timeEntries: {
          orderBy: { startTime: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    // Calculate financial summary
    const totalExpenses = caseData.expenses.reduce((sum, exp) => 
      sum + parseFloat(exp.amount.toString()), 0);
    const totalAdvances = caseData.advances.reduce((sum, adv) => 
      sum + parseFloat(adv.amount.toString()), 0);
    const totalTimeValue = caseData.timeEntries.reduce((sum, entry) => {
      const rate = entry.rate ? parseFloat(entry.rate.toString()) : 0;
      const duration = entry.duration || 0;
      return sum + (rate * duration / 60);
    }, 0);

    res.json({
      ...caseData,
      financialSummary: {
        totalExpenses,
        totalAdvances,
        totalTimeValue,
        balance: totalAdvances - totalExpenses - totalTimeValue
      }
    });
  } catch (error) {
    console.error('Get case error:', error);
    res.status(500).json({ error: 'Dava bilgileri yüklenemedi' });
  }
});

// Create case
router.post('/api/cases', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId!;
    const userId = req.userId!;
    
    const validatedData = createCaseSchema.parse(req.body);

    // Check if caseNo is unique
    if (validatedData.caseNo) {
      const existing = await prisma.case.findFirst({
        where: { caseNo: validatedData.caseNo }
      });
      
      if (existing) {
        return res.status(400).json({ 
          error: 'Bu dava numarası zaten kullanılıyor' 
        });
      }
    }

    const caseData = await prisma.case.create({
      data: {
        ...validatedData,
        orgId,
        createdByUserId: userId
      },
      include: {
        client: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'create',
        entityType: 'case',
        entityId: caseData.id.toString(),
        meta: validatedData
      }
    });

    res.status(201).json(caseData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Create case error:', error);
    res.status(500).json({ error: 'Dava oluşturulamadı' });
  }
});

// Update case
router.put('/api/cases/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;
    
    const validatedData = updateCaseSchema.parse(req.body);

    // Check if case exists and belongs to org
    const existing = await prisma.case.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    // Check if caseNo is unique (if being updated)
    if (validatedData.caseNo && validatedData.caseNo !== existing.caseNo) {
      const duplicateCase = await prisma.case.findFirst({
        where: { 
          caseNo: validatedData.caseNo,
          id: { not: parseInt(id) }
        }
      });
      
      if (duplicateCase) {
        return res.status(400).json({ 
          error: 'Bu dava numarası zaten kullanılıyor' 
        });
      }
    }

    const caseData = await prisma.case.update({
      where: { id: parseInt(id) },
      data: {
        ...validatedData,
        updatedByUserId: userId
      },
      include: {
        client: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'update',
        entityType: 'case',
        entityId: id,
        meta: validatedData
      }
    });

    res.json(caseData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Update case error:', error);
    res.status(500).json({ error: 'Dava güncellenemedi' });
  }
});

// Add hearing date
router.post('/api/cases/:id/hearings', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Tarih zorunludur' });
    }

    const caseData = await prisma.case.findFirst({
      where: { 
        id: parseInt(id),
        orgId 
      }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    const hearingDates = [...(caseData.hearingDates || []), new Date(date)];
    hearingDates.sort((a, b) => a.getTime() - b.getTime());

    const updated = await prisma.case.update({
      where: { id: parseInt(id) },
      data: {
        hearingDates,
        nextHearing: hearingDates.find(d => d > new Date()) || null
      }
    });

    // Create event for the hearing
    await prisma.event.create({
      data: {
        orgId,
        caseId: parseInt(id),
        type: 'hearing',
        title: `Duruşma - ${caseData.title}`,
        startAt: new Date(date),
        location: caseData.court || undefined,
        createdByUserId: userId
      }
    });

    res.json(updated);
  } catch (error) {
    console.error('Add hearing error:', error);
    res.status(500).json({ error: 'Duruşma tarihi eklenemedi' });
  }
});

// Case expenses CRUD
router.get('/api/cases/:id/expenses', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;

    // Verify case belongs to org
    const caseData = await prisma.case.findFirst({
      where: { id: parseInt(id), orgId }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    const expenses = await prisma.caseExpense.findMany({
      where: { caseId: parseInt(id) },
      orderBy: { date: 'desc' }
    });

    res.json(expenses);
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Masraflar yüklenemedi' });
  }
});

router.post('/api/cases/:id/expenses', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const { type, amount, currency = 'TRY', description, date } = req.body;

    // Verify case belongs to org
    const caseData = await prisma.case.findFirst({
      where: { id: parseInt(id), orgId }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    const expense = await prisma.caseExpense.create({
      data: {
        caseId: parseInt(id),
        type,
        amount,
        currency,
        description,
        date: new Date(date)
      }
    });

    res.status(201).json(expense);
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ error: 'Masraf eklenemedi' });
  }
});

// Case advances CRUD
router.get('/api/cases/:id/advances', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;

    // Verify case belongs to org
    const caseData = await prisma.case.findFirst({
      where: { id: parseInt(id), orgId }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    const advances = await prisma.caseAdvance.findMany({
      where: { caseId: parseInt(id) },
      orderBy: { date: 'desc' }
    });

    res.json(advances);
  } catch (error) {
    console.error('Get advances error:', error);
    res.status(500).json({ error: 'Avanslar yüklenemedi' });
  }
});

router.post('/api/cases/:id/advances', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const { amount, currency = 'TRY', description, date } = req.body;

    // Verify case belongs to org
    const caseData = await prisma.case.findFirst({
      where: { id: parseInt(id), orgId }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    const advance = await prisma.caseAdvance.create({
      data: {
        caseId: parseInt(id),
        amount,
        currency,
        description,
        date: new Date(date)
      }
    });

    res.status(201).json(advance);
  } catch (error) {
    console.error('Create advance error:', error);
    res.status(500).json({ error: 'Avans eklenemedi' });
  }
});

export default router;