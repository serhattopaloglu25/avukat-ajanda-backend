import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['*'],
  credentials: true
}));
app.use(express.json());

// Health check - basit versiyon
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', message: 'API is running' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'AvukatAjanda API',
    version: '1.0.0',
    status: 'active'
  });
});

// Temporary auth endpoints (without DB)
app.post('/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  res.status(201).json({ 
    message: 'Registration would work with DB',
    user: { email } 
  });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  // Fake token for testing
  res.json({ 
    token: 'fake-jwt-token-for-testing',
    user: { email }
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Server closed');
  });
});
