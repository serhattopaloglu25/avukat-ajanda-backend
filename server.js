const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.json({ status: 'healthy', database: 'disconnected' });
  }
});

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const [users, clients, cases] = await Promise.all([
      prisma.user.count(),
      prisma.client.count(),
      prisma.case.count()
    ]);
    res.json({ total_users: users, total_clients: clients, total_cases: cases });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Register
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    
    if (existing) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: name || email.split('@')[0] },
      select: { id: true, email: true, name: true, role: true }
    });
    
    res.status(201).json({ message: 'User registered', user });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Me endpoint
app.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.substring(7);
    if (!token) return res.status(401).json({ error: 'No token' });
    
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, role: true }
    });
    
    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
});

// Add to server.js
const eventRoutes = require('./dist/routes/events').default;
app.use('/api/events', eventRoutes);

