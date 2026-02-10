import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rbac';
import { failoverManager } from '@/lib/services/failover-manager';

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'manage_settings');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const servers = failoverManager.getStatus();
  const onlineCount = servers.filter((s) => s.status === 'online').length;
  const offlineCount = servers.filter((s) => s.status === 'offline').length;
  const degradedCount = servers.filter((s) => s.status === 'degraded').length;

  return NextResponse.json({
    servers: servers.map((s) => ({
      id: s.id,
      url: s.url,
      role: s.role,
      status: s.status,
      lastCheckedAt: s.lastCheckedAt ? new Date(s.lastCheckedAt).toISOString() : null,
      lastOnlineAt: s.lastOnlineAt ? new Date(s.lastOnlineAt).toISOString() : null,
      consecutiveFailures: s.consecutiveFailures,
      registeredAt: new Date(s.registeredAt).toISOString(),
      healthHistory: s.healthHistory.slice(-20).map((h) => ({
        timestamp: new Date(h.timestamp).toISOString(),
        status: h.status,
        responseTimeMs: h.responseTimeMs,
        error: h.error,
      })),
    })),
    totalServers: servers.length,
    onlineCount,
    offlineCount,
    degradedCount,
    monitoring: failoverManager.isMonitoring(),
  });
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'manage_settings');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { name, url, role } = body;

  if (!name || !url) {
    return NextResponse.json(
      { error: 'name and url are required' },
      { status: 400 }
    );
  }

  const serverRole = role === 'primary' ? 'primary' : 'backup';
  const server = failoverManager.registerServer(name, url, serverRole);

  // Start monitoring if not already active
  if (!failoverManager.isMonitoring()) {
    failoverManager.startMonitoring();
  }

  return NextResponse.json({
    success: true,
    message: `Сервер "${name}" добавлен как ${serverRole === 'primary' ? 'основной' : 'резервный'}`,
    server: {
      id: server.id,
      url: server.url,
      role: server.role,
      status: server.status,
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'manage_settings');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { serverId, action } = body;

  if (!serverId || !action) {
    return NextResponse.json(
      { error: 'serverId and action are required' },
      { status: 400 }
    );
  }

  if (action === 'promote') {
    const success = failoverManager.promoteBackup(serverId);
    if (!success) {
      return NextResponse.json(
        { error: `Не удалось повысить сервер ${serverId}. Убедитесь, что он зарегистрирован как backup.` },
        { status: 400 }
      );
    }
    return NextResponse.json({
      success: true,
      message: `Сервер ${serverId} повышен до основного`,
    });
  }

  if (action === 'remove') {
    const deleted = failoverManager.unregisterServer(serverId);
    if (!deleted) {
      return NextResponse.json(
        { error: `Сервер ${serverId} не найден` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      message: `Сервер ${serverId} удалён`,
    });
  }

  if (action === 'check') {
    const status = await failoverManager.checkHealth(serverId);
    return NextResponse.json({
      success: true,
      serverId,
      status,
    });
  }

  return NextResponse.json(
    { error: `Неизвестное действие: ${action}` },
    { status: 400 }
  );
}
