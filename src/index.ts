import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import statsRouter from './routes/stats';
import meRouter from './routes/me';
import clientsRouter from './routes/clients';
import casesRouter from './routes/cases';
import eventsRouter from './routes/events';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CORS_ORIGIN || 'https://avukatajanda.com'
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}));

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'avukat-ajanda-backend',
  });
});

// Routes
app.use(authRouter);
app.use(meRouter);
app.use(statsRouter);
app.use(clientsRouter);
app.use(casesRouter);
app.use(eventsRouter);

// Contact endpoint
app.post('/api/contact', (req, res) => {
  console.log('Contact form:', req.body);
  res.json({ success: true });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
