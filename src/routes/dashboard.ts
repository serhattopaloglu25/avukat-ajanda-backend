import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Dashboard stats endpoint - basit versiyon
router.get('/dashboard/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    res.json({
      totalClients: 0,
      activeCases: 0,
      upcomingEvents: 0,
      unpaidInvoices: 0,
      nextHearing: null
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'İstatistikler yüklenemedi' });
  }
});

export default router;
