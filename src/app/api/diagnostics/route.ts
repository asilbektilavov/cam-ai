import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
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

  // ── Attendance service check ───────────────────────────────
  let attendanceStatus = 'offline';
  let attendanceLatency = 0;
  let attendanceEmployees = 0;
  let attendanceCameras: Array<{
    id: string;
    direction: string;
    alive: boolean;
    fps: number;
    facesDetected: number;
    matchesFound: number;
  }> = [];
  try {
    const attUrl = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:8002';
    const t = Date.now();
    const res = await fetch(`${attUrl}/health`, { signal: AbortSignal.timeout(3000) });
    attendanceLatency = Date.now() - t;
    if (res.ok) {
      attendanceStatus = 'ok';
      const health = await res.json();
      attendanceEmployees = health.employees_loaded || 0;
      if (health.cameras) {
        attendanceCameras = Object.entries(health.cameras).map(([id, cam]: [string, any]) => ({
          id,
          direction: cam.direction || 'unknown',
          alive: cam.alive ?? false,
          fps: Math.round((cam.fps || 0) * 10) / 10,
          facesDetected: cam.faces_detected || 0,
          matchesFound: cam.matches_found || 0,
        }));
      }
    }
  } catch {
    attendanceStatus = 'offline';
  }

  // ── Camera stats ─────────────────────────────────────────────
  const orgCameras = await prisma.camera.findMany({
    where: { organizationId: orgId },
    select: { id: true, status: true, isMonitoring: true, purpose: true },
  });
  const totalCameras = orgCameras.length;
  const onlineCameras = orgCameras.filter((c) => c.status === 'online').length;
  const monitoringCameras = orgCameras.filter((c) => c.isMonitoring).length;
  const orgCameraIds = new Set(orgCameras.map((c) => c.id));

  // ── Camera purpose breakdown ───────────────────────────────
  const detectionCameras = orgCameras.filter((c) => c.purpose === 'detection').length;
  const attendanceEntryCameras = orgCameras.filter((c) => c.purpose === 'attendance_entry').length;
  const attendanceExitCameras = orgCameras.filter((c) => c.purpose === 'attendance_exit').length;

  // ── go2rtc check (after camera stats so we can filter by org) ─
  let go2rtcStatus = 'offline';
  let go2rtcStreams = 0;
  try {
    const go2rtcUrl = process.env.GO2RTC_API_URL || 'http://localhost:1984';
    const res = await fetch(`${go2rtcUrl}/api/streams`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      go2rtcStatus = 'ok';
      const streams = await res.json();
      // Count only streams belonging to this org's cameras
      go2rtcStreams = Object.keys(streams).filter((id) => orgCameraIds.has(id)).length;
    }
  } catch {
    go2rtcStatus = 'offline';
  }

  // ── Recent events count ──────────────────────────────────────
  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  const lastHour = new Date(now - 60 * 60 * 1000);

  const [eventsLast24h, eventsLastHour, criticalEventsLast24h] = await Promise.all([
    prisma.event.count({ where: { organizationId: orgId, timestamp: { gte: last24h } } }),
    prisma.event.count({ where: { organizationId: orgId, timestamp: { gte: lastHour } } }),
    prisma.event.count({ where: { organizationId: orgId, timestamp: { gte: last24h }, severity: 'critical' } }),
  ]);

  // ── Event type distribution (last 24h) ────────────────────
  const eventsByType = await prisma.event.groupBy({
    by: ['type'],
    where: { organizationId: orgId, timestamp: { gte: last24h } },
    _count: true,
  });

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
      go2rtc: { status: go2rtcStatus, activeStreams: go2rtcStreams },
      attendance: {
        status: attendanceStatus,
        latencyMs: attendanceLatency,
        employeesLoaded: attendanceEmployees,
        cameras: attendanceCameras,
      },
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
      byPurpose: {
        detection: detectionCameras,
        attendanceEntry: attendanceEntryCameras,
        attendanceExit: attendanceExitCameras,
      },
    },
    events: {
      last24h: eventsLast24h,
      lastHour: eventsLastHour,
      criticalLast24h: criticalEventsLast24h,
      byType: eventsByType.map((e) => ({
        type: e.type,
        count: typeof e._count === 'number' ? e._count : (e._count as any)?._all ?? 0,
      })),
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
