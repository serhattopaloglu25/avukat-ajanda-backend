import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.get('/api/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    
    if (!orgId) {
      return res.status(400).json({ error: 'Organization not found' });
    }

    // Get stats with org isolation
    const [totalClients, totalCases, activeCases, upcomingEvents] = await Promise.all([
      prisma.client.count({ where: { orgId } }),
      prisma.case.count({ where: { orgId } }),
      prisma.case.count({ where: { orgId, status: 'active' } }),
      prisma.event.count({ 
        where: { 
          orgId,
          startAt: { gte: new Date() }
        } 
      }),
    ]);

    res.json({
      total_clients: totalClients,
      total_cases: totalCases,
      active_cases: activeCases,
      upcoming_events: upcomingEvents,
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

export default router;
