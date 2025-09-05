import express from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const router = express.Router();
const prisma = new PrismaClient();

// Uptime check endpoint
router.get('/check', async (req, res) => {
  const secret = req.headers['x-uptime-secret'];
  
  if (secret !== process.env.UPTIME_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;
    
    // Check critical services
    const checks = {
      database: 'healthy',
      api: 'healthy',
      timestamp: new Date().toISOString()
    };
    
    logger.info({ type: 'uptime_check', ...checks });
    res.json(checks);
  } catch (error) {
    logger.error({ type: 'uptime_check_failed', error });
    res.status(503).json({ error: 'Service unavailable' });
  }
});

export default router;
