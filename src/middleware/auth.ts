import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../lib/auth';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: any;
  orgId?: number;
  membership?: any;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payload = verifyToken(token);
    
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { org: true },
        },
      },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export async function attachOrg(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const orgId = parseInt(
    req.headers['x-org-id']?.toString() ||
    req.query.orgId?.toString() ||
    req.body.orgId ||
    ''
  );

  if (!orgId) {
    // Use first org if not specified
    if (req.user?.memberships?.length > 0) {
      req.orgId = req.user.memberships[0].orgId;
      req.membership = req.user.memberships[0];
    }
    return next();
  }

  const membership = req.user?.memberships?.find(
    (m: any) => m.orgId === orgId
  );

  if (!membership) {
    res.status(403).json({ error: 'Access denied to organization' });
    return;
  }

  req.orgId = orgId;
  req.membership = membership;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.membership || !roles.includes(req.membership.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
