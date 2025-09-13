import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, attachOrg, requireRole, AuthRequest } from '../middleware/auth';
import { audit } from '../lib/audit';
import { generateRandomToken, hashToken } from '../lib/auth';

const router = Router();
const prisma = new PrismaClient();

// Get user's organizations
router.get('/orgs', requireAuth, async (req: AuthRequest, res) => {
  const orgs = await prisma.organization.findMany({
    where: {
      memberships: {
        some: {
          userId: req.user.id,
          status: 'active',
        },
      },
    },
    include: {
      _count: {
        select: {
          memberships: true,
          clients: true,
          cases: true,
        },
      },
    },
  });

  res.json(orgs);
});

// Get organization members
router.get('/orgs/:id/members', requireAuth, attachOrg, async (req: AuthRequest, res) => {
  const members = await prisma.membership.findMany({
    where: {
      orgId: parseInt(req.params.id),
      status: 'active',
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  res.json(members);
});

// Invite member
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'lawyer', 'assistant']),
});

router.post(
  '/orgs/:id/invites',
  requireAuth,
  attachOrg,
  requireRole('owner', 'admin'),
  async (req: AuthRequest, res) => {
    try {
      const data = inviteSchema.parse(req.body);
      const orgId = parseInt(req.params.id);

      // Check if already member
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (existingUser) {
        const existingMembership = await prisma.membership.findUnique({
          where: {
            userId_orgId: {
              userId: existingUser.id,
              orgId,
            },
          },
        });

        if (existingMembership) {
          return res.status(400).json({ error: 'User is already a member' });
        }
      }

      // Create invite
      const token = generateRandomToken();
      const invite = await prisma.invite.create({
        data: {
          orgId,
          email: data.email,
          role: data.role,
          tokenHash: hashToken(token),
          invitedByUserId: req.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      // TODO: Send email with invite link
      const inviteUrl = `https://avukatajanda.com/invite?token=${token}`;

      await audit(
        {
          action: 'invite_sent',
          resource: 'invite',
          resourceId: invite.id.toString(),
          meta: { email: data.email, role: data.role },
        },
        req
      );

      res.json({
        success: true,
        inviteUrl, // In production, this would be sent via email
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid data' });
      }
      console.error('Invite error:', error);
      res.status(500).json({ error: 'Failed to send invite' });
    }
  }
);

export default router;
