import { prisma } from '@/lib/prisma';

interface AuditLogParams {
  userId: string;
  organizationId: string;
  action: string;
  target?: string;
  targetType?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

class AuditLogger {
  private static instance: AuditLogger;

  private constructor() {}

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  async log(params: AuditLogParams): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: params.userId,
          organizationId: params.organizationId,
          action: params.action,
          target: params.target ?? null,
          targetType: params.targetType ?? null,
          details: params.details ? JSON.stringify(params.details) : null,
          ip: params.ip ?? null,
        },
      });
    } catch (error) {
      console.error('[AuditLogger] Failed to write audit log:', error);
    }
  }
}

export const auditLogger = AuditLogger.getInstance();
