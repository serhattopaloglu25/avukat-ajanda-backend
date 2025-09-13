import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get audit logs (admin only)
router.get('/api/audit', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { 
      userId,
      action,
      entityType,
      startDate,
      endDate,
      page = '1',
      limit = '50'
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = { orgId };
    
    if (userId) {
      where.userId = parseInt(userId as string);
    }
    
    if (action) {
      where.action = action;
    }
    
    if (entityType) {
      where.entityType = entityType;
    }
    
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }),
      prisma.auditLog.count({ where })
    ]);

    res.json({
      logs,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Denetim kayıtları yüklenemedi' });
  }
});

// Get audit summary (admin only)
router.get('/api/audit/summary', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const orgId = req.orgId;
    const { days = '7' } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days as string));

    // Get action counts
    const actionCounts = await prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        orgId,
        createdAt: { gte: startDate }
      },
      _count: true
    });

    // Get entity type counts
    const entityCounts = await prisma.auditLog.groupBy({
      by: ['entityType'],
      where: {
        orgId,
        createdAt: { gte: startDate }
      },
      _count: true
    });

    // Get most active users
    const userActivity = await prisma.auditLog.groupBy({
      by: ['userId'],
      where: {
        orgId,
        createdAt: { gte: startDate }
      },
      _count: true,
      orderBy: {
        _count: {
          userId: 'desc'
        }
      },
      take: 10
    });

    // Get user details
    const userIds = userActivity.map(u => u.userId).filter(Boolean) as number[];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true
      }
    });

    const userMap = users.reduce((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {} as Record<number, any>);

    const activeUsers = userActivity.map(u => ({
      user: userMap[u.userId!],
      count: u._count
    }));

    // Get daily activity
    const dailyActivity = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM "AuditLog"
      WHERE org_id = ${orgId}
        AND created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    res.json({
      actionCounts: actionCounts.map(a => ({
        action: a.action,
        count: a._count
      })),
      entityCounts: entityCounts.map(e => ({
        entityType: e.entityType,
        count: e._count
      })),
      activeUsers,
      dailyActivity
    });
  } catch (error) {
    console.error('Get audit summary error:', error);
    res.status(500).json({ error: 'Denetim özeti yüklenemedi' });
  }
});

// Audit helper function
export const createAuditLog = async (
  orgId: number,
  userId: number,
  action: string,
  entityType: string,
  entityId?: string,
  meta?: any,
  ip?: string,
  ua?: string
) => {
  try {
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action,
        entityType,
        entityId,
        meta,
        ip,
        ua
      }
    });
  } catch (error) {
    console.error('Audit log creation failed:', error);
  }
};

export default router;