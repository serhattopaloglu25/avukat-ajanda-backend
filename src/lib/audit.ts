import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

export interface AuditLogParams {
  orgId?: number;
  userId?: number;
  action: string;
  entityType: string;
  entityId?: string;
  meta?: any;
  ip?: string;
  ua?: string;
}

export async function createAuditLog(req: AuthRequest, params: AuditLogParams): Promise<void> {
  try {
    const orgId = params.orgId || req.orgId || 1; // Default to 1 if no org
    
    await prisma.auditLog.create({
      data: {
        orgId,
        userId: params.userId || req.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        meta: params.meta,
        ip: params.ip || req.ip,
        ua: params.ua || req.headers['user-agent']
      }
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}