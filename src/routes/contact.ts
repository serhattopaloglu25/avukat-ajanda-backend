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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many requests, please try again later.',
});

router.post('/api/contact', limiter, async (req, res) => {
  try {
    const data = contactSchema.parse(req.body);
    
    // For now, just log it
    console.log('Contact form submission:', data);
    
    res.json({ success: true, message: 'Message received' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

export default router;
