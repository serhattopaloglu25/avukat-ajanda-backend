import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Dashboard stats endpoint
router.get('/dashboard/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const orgId = req.orgId || 1;

    const [
      totalClients,
      activeCases,
      upcomingEvents,
      unpaidInvoices
    ] = await Promise.all([
      // Count clients
      prisma.client.count({
        where: {
          OR: [
            { userId },
            { orgId }
          ]
        }
      }),
      
      // Count active cases
      prisma.case.count({
        where: {
          OR: [
            { userId, status: 'active' },
            { orgId, status: 'active' }
          ]
        }
      }),
      
      // Count upcoming events
      prisma.event.count({
        where: {
          AND: [
            {
              OR: [
                { userId },
                { orgId }
              ]
            },
            {
              OR: [
                { startsAt: { gte: new Date() } },
                { startAt: { gte: new Date() } }
              ]
            }
          ]
        }
      }),
      
      // Count unpaid invoices
      prisma.invoice.count({
        where: {
          orgId,
          status: { in: ['draft', 'sent'] }
        }
      })
    ]);

    // Get next hearing
    const nextEvent = await prisma.event.findFirst({
      where: {
        OR: [
          { userId },
          { orgId }
        ],
        type: 'hearing',
        OR: [
          { startsAt: { gte: new Date() } },
          { startAt: { gte: new Date() } }
        ]
      },
      orderBy: [
        { startsAt: 'asc' },
        { startAt: 'asc' }
      ],
      include: {
        case: {
          select: {
            title: true,
            caseNo: true
          }
        }
      }
    });

    const nextHearing = nextEvent ? {
      id: nextEvent.id.toString(),
      title: nextEvent.title,
      startAt: (nextEvent.startsAt || nextEvent.startAt)?.toISOString(),
      location: nextEvent.location,
      case: nextEvent.case
    } : null;

    res.json({
      totalClients,
      activeCases,
      upcomingEvents,
      unpaidInvoices,
      nextHearing
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'İstatistikler yüklenemedi' });
  }
});

export default router;