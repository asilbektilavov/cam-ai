import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { requireRole } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

const VALID_ROLES = ['admin', 'operator', 'viewer'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const roleErr = requireRole(session, 'admin');
  if (roleErr) return roleErr;

  const { id } = await params;
  const orgId = session.user.organizationId;
  const body = await request.json();
  const { role } = body;

  if (!role || !VALID_ROLES.includes(role)) return badRequest('Недопустимая роль');

  // Cannot change own role
  if (id === session.user.id) {
    return badRequest('Нельзя изменить свою роль');
  }

  const user = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!user) return notFound('Пользователь не найден');

  // Cannot demote the last admin
  if (user.role === 'admin' && role !== 'admin') {
    const adminCount = await prisma.user.count({
      where: { organizationId: orgId, role: 'admin' },
    });
    if (adminCount <= 1) {
      return badRequest('Нельзя понизить единственного администратора');
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role },
    select: { id: true, name: true, email: true, role: true },
  });

  logAudit({
    organizationId: orgId,
    userId: session.user.id,
    action: 'user.role_change',
    entityType: 'user',
    entityId: id,
    details: { oldRole: user.role, newRole: role },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const roleErr = requireRole(session, 'admin');
  if (roleErr) return roleErr;

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Cannot remove self
  if (id === session.user.id) {
    return badRequest('Нельзя удалить себя');
  }

  const user = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!user) return notFound('Пользователь не найден');

  // Cannot remove the last admin
  if (user.role === 'admin') {
    const adminCount = await prisma.user.count({
      where: { organizationId: orgId, role: 'admin' },
    });
    if (adminCount <= 1) {
      return badRequest('Нельзя удалить единственного администратора');
    }
  }

  await prisma.user.delete({ where: { id } });

  logAudit({
    organizationId: orgId,
    userId: session.user.id,
    action: 'user.remove',
    entityType: 'user',
    entityId: id,
    details: { email: user.email, name: user.name },
  });

  return NextResponse.json({ success: true });
}
