import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { register, login } from './auth/auth.controller';
import { authMiddleware, AuthRequest } from './auth/auth.middleware';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api', limiter);

// Auth rate limiting (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again later'
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'AvukatAjanda API',
    version: '1.0.0',
    status: 'active',
    endpoints: {
      auth: '/auth/register, /auth/login',
      protected: '/me',
      health: '/health'
    }
  });
});

// Auth endpoints
app.post('/auth/register', authLimiter, register);
app.post('/auth/login', authLimiter, login);

// Protected endpoints
app.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            clients: true,
            cases: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API stats (protected)
app.get('/api/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    
    const [totalClients, totalCases, activeCases] = await Promise.all([
      prisma.client.count({ where: { userId } }),
      prisma.case.count({ where: { userId } }),
      prisma.case.count({ where: { userId, status: 'active' } })
    ]);
    
    res.json({
      total_clients: totalClients,
      total_cases: totalCases,
      active_cases: activeCases,
      pending_invoices: 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    prisma.$disconnect();
  });
});
