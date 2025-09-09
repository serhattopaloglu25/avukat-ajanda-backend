import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

const prisma = new PrismaClient();

interface AuditParams {
  action: string;
  resource: string;
  resourceId?: string;
  meta?: any;
}

export async function audit(
  params: AuditParams,
  req: Request & { user?: any; orgId?: number }
) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: req.orgId,
        userId: req.user?.id,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        ip: req.ip || req.headers['x-forwarded-for']?.toString(),
        ua: req.headers['user-agent'],
        meta: params.meta,
      },
    });
  } catch (error) {
    console.error('Audit log failed:', error);
  }
}
