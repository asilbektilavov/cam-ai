import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_audit');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || '';
  const action = searchParams.get('action') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const search = searchParams.get('search') || '';
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { organizationId: orgId };

    if (userId) where.userId = userId;
    if (action) where.action = action;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    if (search) {
      where.AND = [
        {
          OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { target: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({ logs, total });
  } catch (err) {
    console.error('[Audit API] Error:', err);
    return NextResponse.json({ logs: [], total: 0 });
  }
}
