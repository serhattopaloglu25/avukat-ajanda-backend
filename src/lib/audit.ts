import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

const prisma = new PrismaClient();

export interface AuditParams {
  action: string;
  resource: string;
  resourceId?: string;
  meta?: any;
}

export interface AuthRequest extends Request {
  user?: any;
  orgId?: number;
}

export async function audit(params: AuditParams, req: AuthRequest): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: req.orgId || null,
        userId: req.user?.id || null,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId || null,
        ip: req.ip || req.headers['x-forwarded-for']?.toString() || null,
        ua: req.headers['user-agent'] || null,
        meta: params.meta || null,
      },
    });
  } catch (error) {
    console.error('Audit log failed:', error);
  }
}
