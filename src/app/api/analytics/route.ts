import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'today';

  const now = new Date();
  let startDate: Date;

  switch (period) {
    case 'yesterday': {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    }
    case 'week': {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      break;
    }
    case 'month': {
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    }
    default: {
      // today
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
    }
  }

  // Get events in period
  const events = await prisma.event.findMany({
    where: {
      organizationId: orgId,
      timestamp: { gte: startDate },
    },
    include: { camera: true },
    orderBy: { timestamp: 'desc' },
  });

  // Get analysis sessions in period
  const sessions = await prisma.analysisSession.findMany({
    where: {
      camera: { organizationId: orgId },
      startedAt: { gte: startDate },
    },
    include: {
      frames: true,
      camera: true,
    },
  });

  // Total people detected from frames
  const totalPeopleDetected = sessions.reduce((sum, s) => {
    return sum + s.frames.reduce((fSum, f) => fSum + (f.peopleCount || 0), 0);
  }, 0);

  // Events by type
  const eventsByType: Record<string, number> = {};
  for (const event of events) {
    const type = event.type;
    eventsByType[type] = (eventsByType[type] || 0) + 1;
  }

  // Events by severity
  const eventsBySeverity = {
    critical: events.filter((e) => e.severity === 'critical').length,
    warning: events.filter((e) => e.severity === 'warning').length,
    info: events.filter((e) => e.severity === 'info').length,
  };

  // Hourly distribution (for today)
  const hourlyData: { hour: string; count: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const hourStr = h.toString().padStart(2, '0');
    const hourStart = new Date(now);
    hourStart.setHours(h, 0, 0, 0);
    const hourEnd = new Date(now);
    hourEnd.setHours(h + 1, 0, 0, 0);

    const count = events.filter((e) => {
      const t = new Date(e.timestamp);
      return t >= hourStart && t < hourEnd;
    }).length;

    hourlyData.push({ hour: hourStr, count });
  }

  // Sessions summary
  const totalSessions = sessions.length;
  const activeSessions = sessions.filter((s) => s.status === 'active').length;
  const totalFrames = sessions.reduce((sum, s) => sum + s.frames.length, 0);

  // Events by camera
  const eventsByCamera: { cameraName: string; count: number }[] = [];
  const cameraMap = new Map<string, { name: string; count: number }>();
  for (const event of events) {
    const existing = cameraMap.get(event.cameraId);
    if (existing) {
      existing.count++;
    } else {
      cameraMap.set(event.cameraId, {
        name: event.camera.name,
        count: 1,
      });
    }
  }
  for (const [, value] of cameraMap) {
    eventsByCamera.push({ cameraName: value.name, count: value.count });
  }
  eventsByCamera.sort((a, b) => b.count - a.count);

  // Recent events for event log
  const recentEvents = events.slice(0, 50).map((e) => ({
    id: e.id,
    type: e.type,
    severity: e.severity,
    description: e.description,
    timestamp: e.timestamp.toISOString(),
    cameraName: e.camera.name,
    cameraLocation: e.camera.location,
  }));

  // Previous period comparison
  const prevStart = new Date(startDate);
  const periodDuration = now.getTime() - startDate.getTime();
  prevStart.setTime(prevStart.getTime() - periodDuration);

  const prevEvents = await prisma.event.count({
    where: {
      organizationId: orgId,
      timestamp: { gte: prevStart, lt: startDate },
    },
  });

  const prevSessions = await prisma.analysisSession.count({
    where: {
      camera: { organizationId: orgId },
      startedAt: { gte: prevStart, lt: startDate },
    },
  });

  return NextResponse.json({
    period,
    totalEvents: events.length,
    totalPeopleDetected,
    eventsByType,
    eventsBySeverity,
    hourlyData,
    totalSessions,
    activeSessions,
    totalFrames,
    eventsByCamera,
    recentEvents,
    comparison: {
      events: { current: events.length, previous: prevEvents },
      sessions: { current: totalSessions, previous: prevSessions },
    },
  });
}
