import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://avukatajanda.com'
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'avukat-ajanda-backend'
  });
});

// Basic auth routes (temporary)
app.post('/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  // For now, just return success
  res.json({ 
    success: true, 
    message: 'Registration endpoint ready',
    user: { email, name }
  });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  // Basic mock response
  res.json({
    token: 'mock-jwt-token',
    user: { 
      id: 1, 
      email, 
      name: 'Test User',
      memberships: []
    }
  });
});

// Contact endpoint
app.post('/api/contact', (req, res) => {
  console.log('Contact form:', req.body);
  res.json({ success: true });
});

// Me endpoint
app.get('/me', (req, res) => {
  // Mock user for testing
  res.json({
    user: {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      memberships: [{
        orgId: 1,
        role: 'owner',
        org: { id: 1, name: 'Test Büro' }
      }]
    }
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
