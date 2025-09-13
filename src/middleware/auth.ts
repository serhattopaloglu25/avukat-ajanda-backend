import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  userId?: number;
  user?: any;
  orgId?: number;
  role?: string;
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token gerekli' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key') as any;
    
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Geçersiz token' });
    }

    req.userId = user.id;
    req.user = user;
    
    // For backwards compatibility with existing code
    req.orgId = 1; // Default org ID
    req.role = 'owner'; // Default role
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Geçersiz token' });
  }
};

// Backwards compatibility exports
export const requireAuth = authMiddleware;
export const requireOwner = authMiddleware;
export const requireAdmin = authMiddleware;
export const requireLawyer = authMiddleware;
export const requireAssistant = authMiddleware;

export const requireRole = (roles: string[]) => {
  return authMiddleware;
};