import { Router } from 'express';

const router = Router();

router.get('/__test-error', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  throw new Error('Test error for Sentry verification');
});

export default router;
