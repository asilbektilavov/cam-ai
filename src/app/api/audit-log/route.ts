import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { requireRole } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const roleErr = requireRole(session, 'admin');
  if (roleErr) return roleErr;

  const orgId = session.user.organizationId;
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const action = url.searchParams.get('action');
  const userId = url.searchParams.get('userId');

  const where = {
    organizationId: orgId,
    ...(action && { action: { contains: action } }),
    ...(userId && { userId }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        organization: { select: { name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Resolve user names
  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const enriched = logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    details: log.details ? JSON.parse(log.details) : null,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt,
    user: log.userId ? userMap.get(log.userId) || { id: log.userId, name: null, email: null } : null,
  }));

  return NextResponse.json({
    logs: enriched,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
