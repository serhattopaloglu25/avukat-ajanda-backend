import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword, generateToken, generateRandomToken, hashToken } from '../lib/auth';
import { audit } from '../lib/audit';
import rateLimit from 'express-rate-limit';

const router = Router();
const prisma = new PrismaClient();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  inviteToken: z.string().optional(),
});

router.post('/auth/register', limiter, async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    
    // Check existing user
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });
    
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashPassword(data.password),
        name: data.name,
      },
    });

    // Handle invite or create org
    if (data.inviteToken) {
      const invite = await prisma.invite.findUnique({
        where: { tokenHash: hashToken(data.inviteToken) },
      });
      
      if (invite && invite.email === data.email && invite.expiresAt > new Date()) {
        await prisma.membership.create({
          data: {
            userId: user.id,
            orgId: invite.orgId,
            role: invite.role,
          },
        });
        
        await prisma.invite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
      }
    } else {
      // Create default org
      const orgSlug = data.email.split('@')[0] + '-' + Date.now();
      const org = await prisma.organization.create({
        data: {
          name: data.name + ' Hukuk Bürosu',
          slug: orgSlug,
        },
      });
      
      await prisma.membership.create({
        data: {
          userId: user.id,
          orgId: org.id,
          role: 'owner',
        },
      });
    }

    await audit(
      { action: 'register', resource: 'user', resourceId: user.id.toString() },
      req as any
    );

    const token = generateToken({ userId: user.id });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/auth/login', limiter, async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: {
        memberships: {
          include: { org: true },
        },
      },
    });

    if (!user || !verifyPassword(data.password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ userId: user.id });
    
    await audit(
      { action: 'login', resource: 'user', resourceId: user.id.toString() },
      req as any
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        memberships: user.memberships,
      },
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data' });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
