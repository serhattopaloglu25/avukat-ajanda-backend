import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createTimeEntrySchema = z.object({
  caseId: z.number(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional().nullable(),
  duration: z.number().optional().nullable(),
  rate: z.number().optional().nullable(),
  currency: z.string().default('TRY'),
  description: z.string().optional().nullable()
});

const createInvoiceSchema = z.object({
  clientId: z.number(),
  date: z.string().datetime(),
  dueDate: z.string().datetime().optional().nullable(),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    rate: z.number(),
    amount: z.number()
  })),
  notes: z.string().optional().nullable()
});

// Time Entry endpoints
router.get('/api/time-entries', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const userId = req.userId;
    const { caseId, startDate, endDate } = req.query;

    const where: any = {};
    
    // Get user's cases for org isolation
    const userCases = await prisma.case.findMany({
      where: { orgId },
      select: { id: true }
    });
    where.caseId = { in: userCases.map(c => c.id) };

    if (caseId) {
      where.caseId = parseInt(caseId as string);
    }

    if (startDate && endDate) {
      where.startTime = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      orderBy: { startTime: 'desc' },
      include: {
        case: {
          select: {
            id: true,
            title: true,
            caseNo: true,
            client: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    // Calculate totals
    const totalDuration = entries.reduce((sum, entry) => sum + (entry.duration || 0), 0);
    const totalValue = entries.reduce((sum, entry) => {
      const rate = entry.rate ? parseFloat(entry.rate.toString()) : 0;
      const duration = entry.duration || 0;
      return sum + (rate * duration / 60);
    }, 0);

    res.json({
      entries,
      summary: {
        totalEntries: entries.length,
        totalDuration, // in minutes
        totalHours: Math.round(totalDuration / 60 * 100) / 100,
        totalValue
      }
    });
  } catch (error) {
    console.error('Get time entries error:', error);
    res.status(500).json({ error: 'Zaman kayıtları yüklenemedi' });
  }
});

router.post('/api/time-entries', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const validatedData = createTimeEntrySchema.parse(req.body);

    // Verify case belongs to user's org
    const caseData = await prisma.case.findUnique({
      where: { id: validatedData.caseId }
    });

    if (!caseData || caseData.orgId !== req.orgId) {
      return res.status(403).json({ error: 'Bu davaya erişim yetkiniz yok' });
    }

    // Calculate duration if endTime is provided
    let duration = validatedData.duration;
    if (validatedData.endTime && !duration) {
      const start = new Date(validatedData.startTime);
      const end = new Date(validatedData.endTime);
      duration = Math.round((end.getTime() - start.getTime()) / 60000); // minutes
    }

    const entry = await prisma.timeEntry.create({
      data: {
        userId,
        caseId: validatedData.caseId,
        startTime: new Date(validatedData.startTime),
        endTime: validatedData.endTime ? new Date(validatedData.endTime) : undefined,
        duration,
        rate: validatedData.rate,
        currency: validatedData.currency,
        description: validatedData.description
      },
      include: {
        case: {
          select: {
            id: true,
            title: true,
            client: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.status(201).json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Create time entry error:', error);
    res.status(500).json({ error: 'Zaman kaydı oluşturulamadı' });
  }
});

router.delete('/api/time-entries/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;

    const entry = await prisma.timeEntry.findUnique({
      where: { id: parseInt(id) },
      include: {
        case: {
          select: { orgId: true }
        }
      }
    });

    if (!entry) {
      return res.status(404).json({ error: 'Zaman kaydı bulunamadı' });
    }

    if (entry.case.orgId !== req.orgId) {
      return res.status(403).json({ error: 'Bu kaydı silme yetkiniz yok' });
    }

    await prisma.timeEntry.delete({
      where: { id: parseInt(id) }
    });

    res.json({ message: 'Zaman kaydı silindi' });
  } catch (error) {
    console.error('Delete time entry error:', error);
    res.status(500).json({ error: 'Zaman kaydı silinemedi' });
  }
});

// Invoice endpoints
router.get('/api/invoices', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { status, clientId, page = '1', limit = '20' } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = { orgId };
    
    if (status) {
      where.status = status;
    }

    if (clientId) {
      where.clientId = parseInt(clientId as string);
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take,
        orderBy: { date: 'desc' },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              address: true,
              vergiNo: true
            }
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }),
      prisma.invoice.count({ where })
    ]);

    // Calculate totals by status
    const [totalDraft, totalSent, totalPaid, totalOverdue] = await Promise.all([
      prisma.invoice.aggregate({
        where: { orgId, status: 'draft' },
        _sum: { totalAmount: true }
      }),
      prisma.invoice.aggregate({
        where: { orgId, status: 'sent' },
        _sum: { totalAmount: true }
      }),
      prisma.invoice.aggregate({
        where: { orgId, status: 'paid' },
        _sum: { totalAmount: true }
      }),
      prisma.invoice.aggregate({
        where: { orgId, status: 'overdue' },
        _sum: { totalAmount: true }
      })
    ]);

    res.json({
      invoices,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      },
      summary: {
        totalDraft: totalDraft._sum.totalAmount || 0,
        totalSent: totalSent._sum.totalAmount || 0,
        totalPaid: totalPaid._sum.totalAmount || 0,
        totalOverdue: totalOverdue._sum.totalAmount || 0
      }
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Faturalar yüklenemedi' });
  }
});

router.post('/api/invoices', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const validatedData = createInvoiceSchema.parse(req.body);

    // Generate invoice number
    const year = new Date().getFullYear();
    const lastInvoice = await prisma.invoice.findFirst({
      where: { 
        orgId,
        invoiceNo: { startsWith: `INV-${year}` }
      },
      orderBy: { invoiceNo: 'desc' }
    });

    let nextNumber = 1;
    if (lastInvoice) {
      const lastNumber = parseInt(lastInvoice.invoiceNo.split('-').pop() || '0');
      nextNumber = lastNumber + 1;
    }
    const invoiceNo = `INV-${year}-${nextNumber.toString().padStart(5, '0')}`;

    // Calculate totals
    const amount = validatedData.items.reduce((sum, item) => sum + item.amount, 0);
    const tax = amount * 0.20; // %20 KDV
    const totalAmount = amount + tax;

    const invoice = await prisma.invoice.create({
      data: {
        orgId,
        clientId: validatedData.clientId,
        invoiceNo,
        date: new Date(validatedData.date),
        dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : undefined,
        amount,
        tax,
        totalAmount,
        status: 'draft',
        items: validatedData.items,
        notes: validatedData.notes,
        createdBy: userId
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.status(201).json(invoice);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Geçersiz veri',
        details: error.errors 
      });
    }
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Fatura oluşturulamadı' });
  }
});

router.put('/api/invoices/:id/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const orgId = req.orgId!;

    if (!['draft', 'sent', 'paid', 'overdue', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Geçersiz durum' });
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: parseInt(id), orgId }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Fatura bulunamadı' });
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id: parseInt(id) },
      data: {
        status,
        ...(status === 'paid' && { paidAt: new Date() })
      }
    });

    res.json(updatedInvoice);
  } catch (error) {
    console.error('Update invoice status error:', error);
    res.status(500).json({ error: 'Fatura durumu güncellenemedi' });
  }
});

// Generate invoice from time entries and expenses
router.post('/api/billing/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { caseId } = req.query;

    if (!caseId) {
      return res.status(400).json({ error: 'Dava ID gerekli' });
    }

    const caseData = await prisma.case.findFirst({
      where: { id: parseInt(caseId as string), orgId },
      include: {
        client: true,
        timeEntries: {
          where: {
            // Only unbilled entries
            // In real app, you'd track which entries are already billed
          }
        },
        expenses: true
      }
    });

    if (!caseData) {
      return res.status(404).json({ error: 'Dava bulunamadı' });
    }

    // Calculate time-based items
    const timeItems = caseData.timeEntries.map(entry => ({
      description: `Hukuki Danışmanlık - ${entry.description || caseData.title}`,
      quantity: Math.round(entry.duration! / 60 * 100) / 100, // hours
      rate: parseFloat(entry.rate?.toString() || '500'), // default rate
      amount: (entry.duration! / 60) * parseFloat(entry.rate?.toString() || '500')
    }));

    // Calculate expense items
    const expenseItems = caseData.expenses.map(expense => ({
      description: `Masraf - ${expense.description || expense.type}`,
      quantity: 1,
      rate: parseFloat(expense.amount.toString()),
      amount: parseFloat(expense.amount.toString())
    }));

    const allItems = [...timeItems, ...expenseItems];
    
    if (allItems.length === 0) {
      return res.status(400).json({ error: 'Faturalanacak kalem bulunamadı' });
    }

    // Generate invoice
    const year = new Date().getFullYear();
    const lastInvoice = await prisma.invoice.findFirst({
      where: { 
        orgId,
        invoiceNo: { startsWith: `INV-${year}` }
      },
      orderBy: { invoiceNo: 'desc' }
    });

    let nextNumber = 1;
    if (lastInvoice) {
      const lastNumber = parseInt(lastInvoice.invoiceNo.split('-').pop() || '0');
      nextNumber = lastNumber + 1;
    }
    const invoiceNo = `INV-${year}-${nextNumber.toString().padStart(5, '0')}`;

    const amount = allItems.reduce((sum, item) => sum + item.amount, 0);
    const tax = amount * 0.20;
    const totalAmount = amount + tax;

    const invoice = await prisma.invoice.create({
      data: {
        orgId,
        clientId: caseData.clientId,
        invoiceNo,
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        amount,
        tax,
        totalAmount,
        status: 'draft',
        items: allItems,
        notes: `Dava: ${caseData.title}\nDosya No: ${caseData.caseNo || '-'}`,
        createdBy: userId
      },
      include: {
        client: true
      }
    });

    res.status(201).json(invoice);
  } catch (error) {
    console.error('Generate invoice error:', error);
    res.status(500).json({ error: 'Fatura oluşturulamadı' });
  }
});

// Generate invoice PDF
router.get('/api/invoices/:id/pdf', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    const invoice = await prisma.invoice.findFirst({
      where: { id: parseInt(id), orgId },
      include: {
        client: true,
        org: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Fatura bulunamadı' });
    }

    const doc = new PDFDocument();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fatura-${invoice.invoiceNo}.pdf"`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(20).text('FATURA', 50, 50);
    doc.fontSize(12).text(`Fatura No: ${invoice.invoiceNo}`, 50, 80);
    doc.text(`Tarih: ${invoice.date.toLocaleDateString('tr-TR')}`, 50, 100);
    
    if (invoice.dueDate) {
      doc.text(`Vade: ${invoice.dueDate.toLocaleDateString('tr-TR')}`, 50, 120);
    }

    // Organization info
    doc.fontSize(14).text(invoice.org.name, 300, 50);
    if (invoice.org.address) {
      doc.fontSize(10).text(invoice.org.address, 300, 70);
    }
    if (invoice.org.taxNo) {
      doc.text(`Vergi No: ${invoice.org.taxNo}`, 300, 90);
    }

    // Client info
    doc.fontSize(12).text('Sayın,', 50, 160);
    doc.fontSize(14).text(invoice.client.name, 50, 180);
    if (invoice.client.address) {
      doc.fontSize(10).text(invoice.client.address, 50, 200);
    }
    if (invoice.client.vergiNo) {
      doc.text(`Vergi No: ${invoice.client.vergiNo}`, 50, 220);
    }

    // Items table
    const items = invoice.items as any[];
    let y = 280;
    
    doc.fontSize(12).text('Açıklama', 50, y);
    doc.text('Miktar', 250, y);
    doc.text('Birim Fiyat', 320, y);
    doc.text('Tutar', 420, y);
    
    y += 20;
    doc.moveTo(50, y).lineTo(500, y).stroke();
    y += 10;

    items.forEach(item => {
      doc.fontSize(10);
      doc.text(item.description, 50, y, { width: 190 });
      doc.text(item.quantity.toString(), 250, y);
      doc.text(`₺${item.rate.toFixed(2)}`, 320, y);
      doc.text(`₺${item.amount.toFixed(2)}`, 420, y);
      y += 30;
    });

    // Totals
    doc.moveTo(50, y).lineTo(500, y).stroke();
    y += 10;
    
    doc.fontSize(10);
    doc.text('Ara Toplam:', 320, y);
    doc.text(`₺${invoice.amount.toNumber().toFixed(2)}`, 420, y);
    y += 20;
    
    doc.text('KDV (%20):', 320, y);
    doc.text(`₺${invoice.tax?.toNumber().toFixed(2) || '0.00'}`, 420, y);
    y += 20;
    
    doc.fontSize(12);
    doc.text('Genel Toplam:', 320, y);
    doc.text(`₺${invoice.totalAmount.toNumber().toFixed(2)}`, 420, y);

    // Notes
    if (invoice.notes) {
      y += 40;
      doc.fontSize(10).text('Notlar:', 50, y);
      doc.fontSize(9).text(invoice.notes, 50, y + 15);
    }

    doc.end();
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ error: 'PDF oluşturulamadı' });
  }
});

export default router;