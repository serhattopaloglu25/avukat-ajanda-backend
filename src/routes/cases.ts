import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middlewares/auth';

const router = Router();
const prisma = new PrismaClient();

const caseSchema = z.object({
  caseNo: z.string().min(1),
  title: z.string().min(1),
  clientId: z.number(),
  status: z.enum(['active', 'closed', 'pending']).default('active')
});

// List cases
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = req.query.status as string;
    const skip = (page - 1) * limit;
    
    const where: any = { userId: req.user?.userId };
    if (status) where.status = status;
    
    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        skip,
        take: limit,
        include: { client: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.case.count({ where })
    ]);
    
    res.json({
      data: cases,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cases' });
  }
});

// Create case
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = caseSchema.parse(req.body);
    
    // Verify client belongs to user
    const client = await prisma.client.findFirst({
      where: { 
        id: data.clientId,
        userId: req.user?.userId 
      }
    });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const newCase = await prisma.case.create({
      data: { ...data, userId: req.user!.userId },
      include: { client: true }
    });
    
    res.status(201).json(newCase);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ errors: error.issues });
    }
    res.status(500).json({ error: 'Failed to create case' });
  }
});

// Get case by ID
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const caseData = await prisma.case.findFirst({
      where: { 
        id: parseInt(req.params.id),
        userId: req.user?.userId 
      },
      include: { client: true }
    });
    
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    res.json(caseData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch case' });
  }
});

// Update case
router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = caseSchema.partial().parse(req.body);
    
    const result = await prisma.case.updateMany({
      where: { 
        id: parseInt(req.params.id),
        userId: req.user?.userId 
      },
      data
    });
    
    if (result.count === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    res.json({ message: 'Case updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ errors: error.issues });
    }
    res.status(500).json({ error: 'Failed to update case' });
  }
});

// Delete case
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await prisma.case.deleteMany({
      where: { 
        id: parseInt(req.params.id),
        userId: req.user?.userId 
      }
    });
    
    if (result.count === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    res.json({ message: 'Case deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete case' });
  }
});

export default router;
