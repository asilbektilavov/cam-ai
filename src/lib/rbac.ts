/**
 * Role-Based Access Control (RBAC) for CamAI
 *
 * Roles: admin, operator, viewer
 * Each role has a defined set of permissions.
 */

export type Role = 'admin' | 'operator' | 'viewer';

export type Permission =
  | 'view_dashboard'
  | 'manage_cameras'
  | 'view_cameras'
  | 'view_analytics'
  | 'manage_recordings'
  | 'use_ptz'
  | 'view_events'
  | 'manage_users'
  | 'manage_integrations'
  | 'manage_branches'
  | 'manage_settings'
  | 'manage_organization'
  | 'manage_automation'
  | 'view_audit'
  | 'manage_lpr'
  | 'export_video';

const PERMISSIONS_MAP: Record<Role, Set<Permission>> = {
  admin: new Set([
    'view_dashboard',
    'manage_cameras',
    'view_cameras',
    'view_analytics',
    'manage_recordings',
    'use_ptz',
    'view_events',
    'manage_users',
    'manage_integrations',
    'manage_branches',
    'manage_settings',
    'manage_organization',
    'manage_automation',
    'view_audit',
    'manage_lpr',
    'export_video',
  ]),
  operator: new Set([
    'view_dashboard',
    'manage_cameras',
    'view_cameras',
    'view_analytics',
    'manage_recordings',
    'use_ptz',
    'view_events',
    'manage_lpr',
    'export_video',
  ]),
  viewer: new Set([
    'view_dashboard',
    'view_cameras',
    'view_analytics',
    'view_events',
    'view_audit',
  ]),
};

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: string, permission: string): boolean {
  const perms = PERMISSIONS_MAP[role as Role];
  if (!perms) return false;
  return perms.has(permission as Permission);
}

/**
 * Require the session user to have one of the specified roles.
 * Throws an error with status info if the user is not authorized.
 */
export function requireRole(
  session: { user: { role: string } } | null,
  ...roles: string[]
): void {
  if (!session?.user) {
    throw new RBACError('Не авторизован', 401);
  }
  if (!roles.includes(session.user.role)) {
    throw new RBACError('Недостаточно прав', 403);
  }
}

/**
 * Check that the session user has a specific permission.
 * Throws an error with status info if the user lacks the permission.
 */
export function checkPermission(
  session: { user: { role: string } } | null,
  permission: string
): void {
  if (!session?.user) {
    throw new RBACError('Не авторизован', 401);
  }
  if (!hasPermission(session.user.role, permission)) {
    throw new RBACError('Недостаточно прав', 403);
  }
}

/**
 * Custom error class that carries an HTTP status code for API route handlers.
 */
export class RBACError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RBACError';
    this.status = status;
  }
}
