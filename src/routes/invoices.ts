import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();

const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.substring(7);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || '') as any;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Generate invoice number
const generateInvoiceNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `INV-${year}${month}-${random}`;
};

// POST /api/invoices
router.post('/', authMiddleware, async (req: any, res) => {
  try {
    const invoice = await prisma.invoice.create({
      data: {
        ...req.body,
        number: generateInvoiceNumber(),
        userId: req.user.userId,
        issueDate: new Date(req.body.issueDate),
        dueDate: new Date(req.body.dueDate)
      }
    });
    res.status(201).json(invoice);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// GET /api/invoices
router.get('/', authMiddleware, async (req: any, res) => {
  const { status, clientId, from, to } = req.query;
  
  const where: any = { userId: req.user.userId };
  if (status) where.status = status;
  if (clientId) where.clientId = parseInt(clientId);
  if (from || to) {
    where.issueDate = {};
    if (from) where.issueDate.gte = new Date(from);
    if (to) where.issueDate.lte = new Date(to);
  }
  
  const invoices = await prisma.invoice.findMany({
    where,
    include: { client: true },
    orderBy: { createdAt: 'desc' }
  });
  
  res.json(invoices);
});

// GET /api/invoices/:id
router.get('/:id', authMiddleware, async (req: any, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { 
      id: parseInt(req.params.id),
      userId: req.user.userId 
    },
    include: { client: true }
  });
  
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json(invoice);
});

// PUT /api/invoices/:id
router.put('/:id', authMiddleware, async (req: any, res) => {
  await prisma.invoice.updateMany({
    where: { 
      id: parseInt(req.params.id),
      userId: req.user.userId 
    },
    data: req.body
  });
  res.json({ message: 'Invoice updated' });
});

// POST /api/invoices/:id/mark-paid
router.post('/:id/mark-paid', authMiddleware, async (req: any, res) => {
  await prisma.invoice.updateMany({
    where: { 
      id: parseInt(req.params.id),
      userId: req.user.userId 
    },
    data: { status: 'paid' }
  });
  res.json({ message: 'Invoice marked as paid' });
});

export default router;
