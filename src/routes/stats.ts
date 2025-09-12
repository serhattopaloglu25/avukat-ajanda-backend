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

    // Get comprehensive stats with org isolation
    const [
      clientCount,
      totalCases,
      activeCaseCount,
      upcomingEvents,
      nextHearing,
      unpaidInvoiceCount,
      recentActivities
    ] = await Promise.all([
      // Total clients
      prisma.client.count({ where: { orgId } }),
      
      // Total cases
      prisma.case.count({ where: { orgId } }),
      
      // Active cases
      prisma.case.count({ where: { orgId, status: 'active' } }),
      
      // Upcoming events
      prisma.event.count({ 
        where: { 
          orgId,
          startAt: { gte: new Date() }
        } 
      }),
      
      // Next hearing (nearest event of type 'hearing')
      prisma.event.findFirst({
        where: {
          orgId,
          type: 'hearing',
          startAt: { gte: new Date() }
        },
        orderBy: { startAt: 'asc' },
        select: {
          id: true,
          title: true,
          startAt: true,
          location: true
        }
      }),
      
      // Unpaid invoices count
      prisma.invoice.count({
        where: {
          orgId,
          status: { in: ['draft', 'sent', 'overdue'] }
        }
      }),
      
      // Recent activities (last 10)
      prisma.auditLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              email: true
            }
          }
        }
      })
    ]);

    res.json({
      clientCount,
      activeCaseCount,
      nextHearing,
      unpaidInvoiceCount,
      totalCases,
      upcomingEvents,
      recentActivities
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Dashboard summary endpoint
router.get('/api/dashboard/summary', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    
    if (!orgId) {
      return res.status(400).json({ error: 'Organization not found' });
    }

    // Get this week's and month's stats
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      weeklyNewClients,
      weeklyNewCases,
      monthlyRevenue,
      pendingTasks
    ] = await Promise.all([
      // New clients this week
      prisma.client.count({
        where: {
          orgId,
          createdAt: { gte: startOfWeek }
        }
      }),
      
      // New cases this week
      prisma.case.count({
        where: {
          orgId,
          createdAt: { gte: startOfWeek }
        }
      }),
      
      // Monthly revenue (paid invoices)
      prisma.invoice.aggregate({
        where: {
          orgId,
          status: 'paid',
          paidAt: { gte: startOfMonth }
        },
        _sum: {
          totalAmount: true
        }
      }),
      
      // Pending tasks (events in next 7 days)
      prisma.event.count({
        where: {
          orgId,
          startAt: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          }
        }
      })
    ]);

    res.json({
      weeklyNewClients,
      weeklyNewCases,
      monthlyRevenue: monthlyRevenue._sum.totalAmount || 0,
      pendingTasks
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

export default router;