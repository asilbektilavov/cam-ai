import { prisma } from '@/lib/prisma';

export function logAudit(params: {
  organizationId: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): void {
  // Fire-and-forget — audit logging should never break the main flow
  prisma.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details ? JSON.stringify(params.details) : null,
      ipAddress: params.ipAddress,
    },
  }).catch((err) => {
    console.error('[Audit] Failed to log:', params.action, err);
  });
}
