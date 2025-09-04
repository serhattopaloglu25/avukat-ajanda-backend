import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8000;

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'AvukatAjanda API',
    version: '1.0.0',
    status: 'active'
  });
});

// Mount routes
app.use('/auth', authRoutes);
app.use('/me', meRoutes);

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    prisma.$disconnect();
  });
});

export default app;

import clientRoutes from './routes/clients';
import caseRoutes from './routes/cases';

app.use('/api/clients', clientRoutes);
app.use('/api/cases', caseRoutes);
