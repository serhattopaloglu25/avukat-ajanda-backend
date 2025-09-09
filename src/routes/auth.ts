import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { 
  hashPassword, 
  verifyPassword, 
  generateToken, 
  generateRandomToken, 
  hashToken 
} from '../lib/auth';
import { audit } from '../lib/audit';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many attempts, please try again later',
});

// Register
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 
    'Password must contain uppercase, lowercase and number'),
  name: z.string().min(2).max(100),
  inviteToken: z.string().optional(),
});

router.post('/auth/register', authLimiter, async (req: AuthRequest, res) => {
  try {
    const data = registerSchema.parse(req.body);

    // Check if user exists
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create user
    const hashedPassword = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
      },
    });

    let orgId: number;

    // Handle invite or create new org
    if (data.inviteToken) {
      const invite = await prisma.invite.findUnique({
        where: { tokenHash: hashToken(data.inviteToken) },
      });

      if (!invite || invite.email !== data.email || invite.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
      }

      // Create membership from invite
      await prisma.membership.create({
        data: {
          userId: user.id,
          orgId: invite.orgId,
          role: invite.role,
        },
      });

      // Mark invite as accepted
      await prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      orgId = invite.orgId;
    } else {
      // Create new organization
      const orgSlug = data.email.split('@')[0] + '-' + Date.now();
      const org = await prisma.organization.create({
        data: {
          name: data.name + ' Hukuk Bürosu',
          slug: orgSlug,
        },
      });

      // Create owner membership
      await prisma.membership.create({
        data: {
          userId: user.id,
          orgId: org.id,
          role: 'owner',
        },
      });

      orgId = org.id;
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      orgId,
    });

    // Audit log
    await audit(
      { 
        action: 'register', 
        resource: 'user', 
        resourceId: user.id.toString(),
        meta: { email: user.email }
      },
      req
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/auth/login', authLimiter, async (req: AuthRequest, res) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { org: true },
        },
      },
    });

    if (!user || !(await verifyPassword(data.password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const orgId = user.memberships[0]?.orgId;
    const token = generateToken({
      userId: user.id,
      email: user.email,
      orgId,
    });

    // Audit log
    await audit(
      { 
        action: 'login', 
        resource: 'user', 
        resourceId: user.id.toString() 
      },
      req
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

// Get current user
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

// Logout
router.post('/auth/logout', requireAuth, async (req: AuthRequest, res) => {
  await audit(
    { action: 'logout', resource: 'user', resourceId: req.user.id.toString() },
    req
  );
  res.json({ success: true });
});

export default router;
