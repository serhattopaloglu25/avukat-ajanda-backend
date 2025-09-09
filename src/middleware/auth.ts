import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function requireAuth(
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        memberships: {
          include: { org: true },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export async function attachOrg(
  req: Request & { user?: any; orgId?: number },
  res: Response,
  next: NextFunction
) {
  const orgId = parseInt(
    req.headers['x-org-id']?.toString() ||
    req.query.orgId?.toString() ||
    req.body.orgId
  );

  if (!orgId) {
    return next();
  }

  const membership = req.user?.memberships?.find(
    (m: any) => m.orgId === orgId && m.status === 'active'
  );

  if (!membership) {
    return res.status(403).json({ error: 'Access denied to organization' });
  }

  req.orgId = orgId;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request & { user?: any; orgId?: number }, res: Response, next: NextFunction) => {
    const membership = req.user?.memberships?.find(
      (m: any) => m.orgId === req.orgId
    );

    if (!membership || !roles.includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
