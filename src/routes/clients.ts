import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middlewares/auth';

const router = Router();
const prisma = new PrismaClient();

const clientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string(),
  address: z.string().optional()
});

// List clients (with pagination)
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where: { userId: req.user?.userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.client.count({ where: { userId: req.user?.userId } })
    ]);
    
    res.json({
      data: clients,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Create client
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = clientSchema.parse(req.body);
    const client = await prisma.client.create({
      data: { ...data, userId: req.user!.userId }
    });
    res.status(201).json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ errors: error.issues });
    }
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Get client by ID
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: { 
        id: parseInt(req.params.id),
        userId: req.user?.userId 
      }
    });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json(client);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// Update client
router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = clientSchema.partial().parse(req.body);
    const client = await prisma.client.updateMany({
      where: { 
        id: parseInt(req.params.id),
        userId: req.user?.userId 
      },
      data
    });
    
    if (client.count === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({ message: 'Client updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({ errors: error.issues });
    }
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Delete client
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await prisma.client.deleteMany({
      where: { 
        id: parseInt(req.params.id),
        userId: req.user?.userId 
      }
    });
    
    if (result.count === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({ message: 'Client deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

export default router;
