import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// GET /me - Get current user
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Kullanıcı bilgileri alınamadı' });
  }
});

// GET /api/stats - Dashboard stats
router.get('/api/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json({
      clientCount: 0,
      activeCaseCount: 0,
      nextHearing: null,
      unpaidInvoiceCount: 0
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'İstatistikler yüklenemedi' });
  }
});

export default router;
