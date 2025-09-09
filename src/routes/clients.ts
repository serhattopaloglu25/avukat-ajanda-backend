import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get clients
router.get('/clients', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    
    const where: any = { orgId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.client.count({ where }),
    ]);

    res.json({
      clients,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Create client
const createClientSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  tcNo: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/clients', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = createClientSchema.parse(req.body);
    
    const client = await prisma.client.create({
      data: {
        ...data,
        orgId: req.orgId!,
        createdByUserId: req.user.id,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'create',
        resource: 'client',
        resourceId: client.id.toString(),
        ip: req.ip,
        ua: req.headers['user-agent'],
      },
    });

    res.status(201).json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ error: 'Invalid data', details: error.errors });
    }
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update client
router.patch('/clients/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = createClientSchema.partial().parse(req.body);
    
    const client = await prisma.client.update({
      where: { id, orgId: req.orgId },
      data: {
        ...data,
        updatedByUserId: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'update',
        resource: 'client',
        resourceId: id.toString(),
        meta: data,
        ip: req.ip,
        ua: req.headers['user-agent'],
      },
    });

    res.json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ error: 'Invalid data' });
    }
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Delete client
router.delete('/clients/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    
    await prisma.client.delete({
      where: { id, orgId: req.orgId },
    });

    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'delete',
        resource: 'client',
        resourceId: id.toString(),
        ip: req.ip,
        ua: req.headers['user-agent'],
      },
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

export default router;
