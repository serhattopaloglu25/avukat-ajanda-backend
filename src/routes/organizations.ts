import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();

const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.substring(7);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || '') as any;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// POST /api/orgs - Create organization
router.post('/', authMiddleware, async (req: any, res) => {
  try {
    const org = await prisma.organization.create({
      data: {
        name: req.body.name,
        memberships: {
          create: {
            userId: req.user.userId,
            role: 'admin'
          }
        }
      }
    });
    res.status(201).json(org);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// GET /api/orgs - Get user's organizations
router.get('/', authMiddleware, async (req: any, res) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.user.userId },
    include: { org: true }
  });
  res.json(memberships);
});

// GET /api/orgs/:id/members
router.get('/:id/members', authMiddleware, async (req: any, res) => {
  // Check if user is member
  const membership = await prisma.membership.findFirst({
    where: {
      userId: req.user.userId,
      orgId: parseInt(req.params.id)
    }
  });
  
  if (!membership) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const members = await prisma.membership.findMany({
    where: { orgId: parseInt(req.params.id) },
    include: { user: { select: { id: true, email: true, name: true } } }
  });
  
  res.json(members);
});

// POST /api/orgs/:id/invite
router.post('/:id/invite', authMiddleware, async (req: any, res) => {
  const { email, role } = req.body;
  
  // Check if user is admin
  const adminCheck = await prisma.membership.findFirst({
    where: {
      userId: req.user.userId,
      orgId: parseInt(req.params.id),
      role: 'admin'
    }
  });
  
  if (!adminCheck) {
    return res.status(403).json({ error: 'Only admins can invite' });
  }
  
  // Find or create user
  let invitedUser = await prisma.user.findUnique({ where: { email } });
  if (!invitedUser) {
    // Create placeholder user
    invitedUser = await prisma.user.create({
      data: {
        email,
        passwordHash: 'PENDING',
        name: email.split('@')[0]
      }
    });
  }
  
  // Create membership
  const membership = await prisma.membership.create({
    data: {
      userId: invitedUser.id,
      orgId: parseInt(req.params.id),
      role
    }
  });
  
  res.status(201).json(membership);
});

// PUT /api/orgs/:id/members/:memberId
router.put('/:id/members/:memberId', authMiddleware, async (req: any, res) => {
  const { role } = req.body;
  
  // Check if user is admin
  const adminCheck = await prisma.membership.findFirst({
    where: {
      userId: req.user.userId,
      orgId: parseInt(req.params.id),
      role: 'admin'
    }
  });
  
  if (!adminCheck) {
    return res.status(403).json({ error: 'Only admins can update roles' });
  }
  
  await prisma.membership.update({
    where: { id: parseInt(req.params.memberId) },
    data: { role }
  });
  
  res.json({ message: 'Role updated' });
});

export default router;
