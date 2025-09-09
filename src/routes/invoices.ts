import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { generateInvoicePDF } from '../services/pdf';

const router = Router();
const prisma = new PrismaClient();

// Get invoice PDF
router.get('/invoices/:id/pdf', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const pdf = await generateInvoicePDF(id, req.orgId!);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Send invoice email
router.post('/invoices/:id/send', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { email } = req.body;

    // Generate PDF
    const pdf = await generateInvoicePDF(id, req.orgId!);

    // Send email with Resend
    if (process.env.RESEND_API_KEY) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: process.env.INVOICE_FROM || 'fatura@avukatajanda.com',
          to: email,
          subject: `Fatura #${id}`,
          html: '<p>Faturanız ekte bulunmaktadır.</p>',
          attachments: [{
            filename: `invoice-${id}.pdf`,
            content: pdf.toString('base64'),
          }],
        }),
      });

      if (!response.ok) {
        throw new Error('Email send failed');
      }
    }

    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        action: 'send',
        resource: 'invoice',
        resourceId: id.toString(),
        meta: { email },
      },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

// List invoices
router.get('/invoices', requireAuth, async (req: AuthRequest, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { orgId: req.orgId },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

export default router;
