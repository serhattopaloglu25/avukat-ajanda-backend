import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get cases
router.get('/cases', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;
    
    const where: any = { orgId };
    if (status) {
      where.status = status;
    }

    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { client: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.case.count({ where }),
    ]);

    res.json({
      cases,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cases' });
  }
});

// Create case
const createCaseSchema = z.object({
  clientId: z.number(),
  title: z.string().min(2),
  caseNumber: z.string().optional(),
  court: z.string().optional(),
  judge: z.string().optional(),
  status: z.enum(['active', 'pending', 'closed', 'archived']).default('active'),
  description: z.string().optional(),
  nextHearing: z.string().optional(),
});

router.post('/cases', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = createCaseSchema.parse(req.body);
    
    const caseData = await prisma.case.create({
      data: {
        ...data,
        nextHearing: data.nextHearing ? new Date(data.nextHearing) : undefined,
        orgId: req.orgId!,
        createdByUserId: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'create',
        resource: 'case',
        resourceId: caseData.id.toString(),
        ip: req.ip,
        ua: req.headers['user-agent'],
      },
    });

    res.status(201).json(caseData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ error: 'Invalid data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create case' });
  }
});

export default router;
