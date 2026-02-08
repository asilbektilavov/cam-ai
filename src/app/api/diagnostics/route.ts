import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { yoloDetector } from '@/lib/services/yolo-detector';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const now = Date.now();

  // ── Database check ───────────────────────────────────────────
  let dbStatus = 'ok';
  let dbLatency = 0;
  try {
    const t = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - t;
  } catch {
    dbStatus = 'error';
  }

  // ── YOLO service check ───────────────────────────────────────
  let yoloStatus = 'ok';
  let yoloLatency = 0;
  try {
    const t = Date.now();
    const yoloUrl = process.env.YOLO_SERVICE_URL || 'http://localhost:8001';
    const res = await fetch(`${yoloUrl}/health`, { signal: AbortSignal.timeout(5000) });
    yoloLatency = Date.now() - t;
    if (!res.ok) yoloStatus = 'error';
  } catch {
    yoloStatus = 'offline';
  }

  // ── System metrics ───────────────────────────────────────────
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = (usedMem / totalMem) * 100;
  const uptime = process.uptime();
  const loadAvg = os.loadavg();

  // CPU usage (simplified: average across cores)
  const cpuModel = cpus[0]?.model || 'Unknown';
  const cpuCores = cpus.length;

  // ── Camera stats ─────────────────────────────────────────────
  const [totalCameras, onlineCameras, monitoringCameras] = await Promise.all([
    prisma.camera.count({ where: { organizationId: orgId } }),
    prisma.camera.count({ where: { organizationId: orgId, status: 'online' } }),
    prisma.camera.count({ where: { organizationId: orgId, isMonitoring: true } }),
  ]);

  // ── Recent events count ──────────────────────────────────────
  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  const lastHour = new Date(now - 60 * 60 * 1000);

  const [eventsLast24h, eventsLastHour, criticalEventsLast24h] = await Promise.all([
    prisma.event.count({ where: { organizationId: orgId, timestamp: { gte: last24h } } }),
    prisma.event.count({ where: { organizationId: orgId, timestamp: { gte: lastHour } } }),
    prisma.event.count({ where: { organizationId: orgId, timestamp: { gte: last24h }, severity: 'critical' } }),
  ]);

  // ── Disk usage ───────────────────────────────────────────────
  let diskTotal = 0;
  let diskUsed = 0;
  let diskPercent = 0;
  try {
    const { execSync } = await import('child_process');
    const dfOutput = execSync("df -k / | tail -1", { encoding: 'utf-8' });
    const parts = dfOutput.trim().split(/\s+/);
    diskTotal = parseInt(parts[1] || '0', 10) * 1024;
    diskUsed = parseInt(parts[2] || '0', 10) * 1024;
    diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;
  } catch { /* ignore */ }

  // ── Integration status ───────────────────────────────────────
  const integrations = await prisma.integration.findMany({
    where: { organizationId: orgId },
    select: { type: true, name: true, enabled: true, updatedAt: true },
  });

  // ── Active sessions ──────────────────────────────────────────
  const activeSessions = await prisma.analysisSession.count({
    where: {
      camera: { organizationId: orgId },
      status: 'active',
    },
  });

  // ── Notifications ────────────────────────────────────────────
  const [notifSent, notifFailed] = await Promise.all([
    prisma.notification.count({ where: { organizationId: orgId, status: 'sent', createdAt: { gte: last24h } } }),
    prisma.notification.count({ where: { organizationId: orgId, status: 'failed', createdAt: { gte: last24h } } }),
  ]);

  const overallStatus = dbStatus === 'ok' && yoloStatus === 'ok' ? 'healthy' :
    dbStatus === 'error' ? 'critical' : 'degraded';

  return NextResponse.json({
    overall: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptime),
    services: {
      database: { status: dbStatus, latencyMs: dbLatency },
      yolo: { status: yoloStatus, latencyMs: yoloLatency, url: process.env.YOLO_SERVICE_URL || 'http://localhost:8001' },
      gemini: { status: process.env.GEMINI_API_KEY ? 'configured' : 'not_configured' },
    },
    system: {
      cpuModel,
      cpuCores,
      loadAvg: loadAvg.map((l) => Math.round(l * 100) / 100),
      memoryTotal: totalMem,
      memoryUsed: usedMem,
      memoryPercent: Math.round(memPercent * 10) / 10,
      diskTotal,
      diskUsed,
      diskPercent: Math.round(diskPercent * 10) / 10,
      platform: os.platform(),
      nodeVersion: process.version,
    },
    cameras: {
      total: totalCameras,
      online: onlineCameras,
      monitoring: monitoringCameras,
    },
    events: {
      last24h: eventsLast24h,
      lastHour: eventsLastHour,
      criticalLast24h: criticalEventsLast24h,
    },
    sessions: {
      active: activeSessions,
    },
    notifications: {
      sentLast24h: notifSent,
      failedLast24h: notifFailed,
    },
    integrations: integrations.map((i) => ({
      type: i.type,
      name: i.name,
      enabled: i.enabled,
      lastUpdated: i.updatedAt,
    })),
  });
}
