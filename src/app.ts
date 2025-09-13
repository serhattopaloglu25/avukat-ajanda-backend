import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Load environment variables
dotenv.config();

// Import working routes only
import authRoutes from './routes/auth';
import apiRoutes from './routes/api';
import dashboardRoutes from './routes/dashboard';

const app = express();
const prisma = new PrismaClient();

// CORS configuration
const corsOptions = {
  origin: function (origin: any, callback: any) {
    const allowedOrigins = [
      'https://avukatajanda.com',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in dev
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      service: 'avukat-ajanda-backend',
      environment: process.env.NODE_ENV || 'development',
      timezone: 'Europe/Istanbul'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
      service: 'avukat-ajanda-backend',
      error: 'Database connection failed'
    });
  }
});

// Routes
app.use('/', authRoutes);
app.use('/', apiRoutes);
app.use('/api', dashboardRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'AvukatAjanda API',
    version: '2.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      auth: {
        register: 'POST /auth/register',
        login: 'POST /auth/login'
      },
      api: {
        me: 'GET /me',
        stats: 'GET /api/stats',
        clients: 'GET/POST /api/clients',
        cases: 'GET/POST /api/cases',
        events: 'GET/POST /api/events'
      }
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

export default app;