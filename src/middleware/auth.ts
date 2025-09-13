import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  userId?: number;
  orgId?: number;
  role?: string;
}

// Basic auth middleware
export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token gerekli' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    
    // Get user's current membership
    const membership = await prisma.membership.findFirst({
      where: {
        userId: decoded.userId,
        status: 'active'
      },
      include: {
        user: true
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Aktif üyelik bulunamadı' });
    }

    req.userId = decoded.userId;
    req.orgId = membership.orgId;
    req.role = membership.role;
    
    // Log activity
    await prisma.auditLog.create({
      data: {
        orgId: membership.orgId,
        userId: decoded.userId,
        action: 'api_access',
        entityType: req.path,
        ip: req.ip,
        ua: req.headers['user-agent']
      }
    }).catch(() => {}); // Don't fail request if audit fails

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Geçersiz token' });
  }
};

// Role-based access control
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      return res.status(403).json({ 
        error: 'Bu işlem için yetkiniz yok',
        required: allowedRoles,
        current: req.role
      });
    }
    next();
  };
};

// Owner only
export const requireOwner = requireRole(['owner']);

// Admin and above
export const requireAdmin = requireRole(['owner', 'admin']);

// Lawyer and above
export const requireLawyer = requireRole(['owner', 'admin', 'lawyer']);

// All authenticated users
export const requireAssistant = requireRole(['owner', 'admin', 'lawyer', 'assistant']);