import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

// GET /api/visitors/stats?days=7&cameraId=optional
// Returns: { total, todayCount, byHour: [...], byDay: [...], byCamera: [...] }
export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  const orgId = session.user.organizationId;

  const url = req.nextUrl;
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '7', 10)));
  const cameraId = url.searchParams.get('cameraId') || undefined;

  // Tashkent local-day boundaries — keep aligned with line-crossing chart.
  const tzFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const now = new Date();
  const since = new Date(now.getTime() - (days - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = {
    organizationId: orgId,
    timestamp: { gte: since },
  };
  if (cameraId) where.cameraId = cameraId;

  const visitors = await prisma.visitor.findMany({
    where,
    select: {
      id: true,
      cameraId: true,
      timestamp: true,
      faceWidthPx: true,
    },
    orderBy: { timestamp: 'desc' },
  });

  // Build day list (oldest -> newest) using Tashkent timezone
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    dayList.push(tzFormatter.format(d));
  }
  const byDayMap: Record<string, number> = Object.fromEntries(dayList.map((d) => [d, 0]));

  // Hour buckets for today only
  const todayKey = tzFormatter.format(now);
  const byHour: number[] = Array(24).fill(0);

  // Per-camera totals (last N days)
  const byCameraMap: Record<string, number> = {};
  // Per-camera-per-day so the UI can drill into a specific day without
  // refetching — the dataset is small enough (90 days × ~20 cameras max)
  // that the extra payload is negligible.
  const byCameraDay: Record<string, Record<string, number>> = {};

  for (const v of visitors) {
    const day = tzFormatter.format(v.timestamp);
    if (day in byDayMap) byDayMap[day]++;
    if (day === todayKey) {
      const hour = parseInt(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tashkent',
          hour: '2-digit',
          hour12: false,
        }).format(v.timestamp),
        10
      );
      if (hour >= 0 && hour < 24) byHour[hour]++;
    }
    byCameraMap[v.cameraId] = (byCameraMap[v.cameraId] || 0) + 1;

    if (!byCameraDay[day]) byCameraDay[day] = {};
    byCameraDay[day][v.cameraId] = (byCameraDay[day][v.cameraId] || 0) + 1;
  }

  // Pull camera names for byCamera
  const cameras = await prisma.camera.findMany({
    where: { organizationId: orgId, id: { in: Object.keys(byCameraMap) } },
    select: { id: true, name: true, location: true },
  });
  const camMap = new Map(cameras.map((c) => [c.id, c]));
  const byCamera = Object.entries(byCameraMap)
    .map(([id, count]) => ({
      cameraId: id,
      cameraName: camMap.get(id)?.name || id,
      location: camMap.get(id)?.location || '',
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Same shape as byCamera but keyed by day, so the client can render the
  // table for a specific day on click.
  const byDayCamera: Record<string, typeof byCamera> = {};
  for (const day of dayList) {
    const dayMap = byCameraDay[day] || {};
    byDayCamera[day] = Object.entries(dayMap)
      .map(([id, count]) => ({
        cameraId: id,
        cameraName: camMap.get(id)?.name || id,
        location: camMap.get(id)?.location || '',
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  return NextResponse.json({
    total: visitors.length,
    todayCount: byDayMap[todayKey] || 0,
    byDay: dayList.map((d) => ({ day: d, count: byDayMap[d] })),
    byHour: byHour.map((count, hour) => ({ hour, count })),
    byCamera,
    byDayCamera,
  });
}
