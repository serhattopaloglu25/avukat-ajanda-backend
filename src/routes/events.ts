import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();

// Auth middleware
const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.substring(7);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || '') as any;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// GET /api/events
router.get('/', authMiddleware, async (req: any, res) => {
  const { from, to, page = '1', limit = '20' } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  const where: any = { userId: req.user.userId };
  if (from || to) {
    where.dateTime = {};
    if (from) where.dateTime.gte = new Date(from);
    if (to) where.dateTime.lte = new Date(to);
  }
  
  const events = await prisma.event.findMany({
    where,
    skip,
    take: parseInt(limit),
    include: { client: true },
    orderBy: { dateTime: 'asc' }
  });
  
  res.json({ data: events });
});

// POST /api/events
router.post('/', authMiddleware, async (req: any, res) => {
  const event = await prisma.event.create({
    data: {
      ...req.body,
      userId: req.user.userId,
      dateTime: new Date(req.body.dateTime)
    }
  });
  res.status(201).json(event);
});

// GET /api/events/:id
router.get('/:id', authMiddleware, async (req: any, res) => {
  const event = await prisma.event.findFirst({
    where: { id: parseInt(req.params.id), userId: req.user.userId }
  });
  if (!event) return res.status(404).json({ error: 'Not found' });
  res.json(event);
});

// PUT /api/events/:id
router.put('/:id', authMiddleware, async (req: any, res) => {
  await prisma.event.updateMany({
    where: { id: parseInt(req.params.id), userId: req.user.userId },
    data: req.body
  });
  res.json({ message: 'Updated' });
});

// DELETE /api/events/:id
router.delete('/:id', authMiddleware, async (req: any, res) => {
  await prisma.event.deleteMany({
    where: { id: parseInt(req.params.id), userId: req.user.userId }
  });
  res.json({ message: 'Deleted' });
});

export default router;
