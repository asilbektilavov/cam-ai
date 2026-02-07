import { NextResponse } from 'next/server';

const ROLE_HIERARCHY: Record<string, number> = {
  superadmin: 40,
  admin: 30,
  operator: 20,
  viewer: 10,
};

export function hasRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 100);
}

export function requireRole(
  session: { user: { role?: string } } | null,
  requiredRole: string
): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }
  const userRole = session.user.role ?? 'viewer';
  if (!hasRole(userRole, requiredRole)) {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  return null; // authorized
}
