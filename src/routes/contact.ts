import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

const router = Router();

const contactSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  subject: z.string().min(3).max(200),
  message: z.string().min(10).max(5000),
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/api/contact', limiter, async (req, res) => {
  try {
    const data = contactSchema.parse(req.body);
    
    if (process.env.RESEND_API_KEY) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@avukatajanda.com',
          to: process.env.CONTACT_TO || 'destek@avukatajanda.com',
          subject: `[İletişim] ${data.subject}`,
          html: `
            <h2>Yeni İletişim Formu</h2>
            <p><strong>Ad:</strong> ${data.name}</p>
            <p><strong>Email:</strong> ${data.email}</p>
            <p><strong>Konu:</strong> ${data.subject}</p>
            <p><strong>Mesaj:</strong></p>
            <p>${data.message.replace(/\n/g, '<br>')}</p>
          `,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Email send failed');
      }
    }
    
    console.log('Contact form:', data);
    res.json({ success: true });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data' });
    }
    console.error('Contact error:', error);
    res.status(500).json({ error: 'Failed to send' });
  }
});

export default router;
