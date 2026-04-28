import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/line-crossing/count — called by line-crossing-service on EVERY
// crossing (not just recognized employees). Records an Event row so we can
// aggregate per-camera per-day in analytics.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { cameraId, trackId, direction } = body as {
    cameraId?: string; trackId?: number; direction?: string;
  };

  if (!cameraId) {
    return NextResponse.json({ error: 'cameraId required' }, { status: 400 });
  }

  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { organizationId: true, branchId: true, name: true },
  });
  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  await prisma.event.create({
    data: {
      cameraId,
      organizationId: camera.organizationId,
      branchId: camera.branchId || undefined,
      type: 'line_crossing',
      severity: 'info',
      description: `Пересечение линии (${direction || 'unknown'})`,
      metadata: JSON.stringify({ trackId, direction }),
    },
  });

  return NextResponse.json({ success: true });
}

// GET /api/line-crossing/count?from=YYYY-MM-DD&to=YYYY-MM-DD — aggregate
// per-camera per-day counts. Used by /analytics line-crossing widget.
export async function GET(req: NextRequest) {
  const { getAuthSession, unauthorized } = await import('@/lib/api-utils');
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const url = req.nextUrl;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: Record<string, unknown> = {
    organizationId: orgId,
    type: 'line_crossing',
  };
  if (from || to) {
    const ts: Record<string, Date> = {};
    if (from) ts.gte = new Date(from);
    if (to) {
      const t = new Date(to);
      t.setHours(23, 59, 59, 999);
      ts.lte = t;
    }
    where.timestamp = ts;
  } else {
    // Default: last 7 days
    const since = new Date();
    since.setDate(since.getDate() - 7);
    where.timestamp = { gte: since };
  }

  const events = await prisma.event.findMany({
    where,
    select: { cameraId: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  });

  // Group: { cameraId: { dayISO: count } } — bucket by Tashkent local day,
  // not UTC. Otherwise events between 00:00-05:00 local time fall into the
  // previous UTC date and the daily counter looks like it never resets.
  const tzFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  type Bucket = Record<string, Record<string, number>>;
  const buckets: Bucket = {};
  for (const e of events) {
    const day = tzFormatter.format(e.timestamp); // YYYY-MM-DD in Tashkent
    if (!buckets[e.cameraId]) buckets[e.cameraId] = {};
    buckets[e.cameraId][day] = (buckets[e.cameraId][day] || 0) + 1;
  }

  // Pull camera names
  const cameras = await prisma.camera.findMany({
    where: { organizationId: orgId, id: { in: Object.keys(buckets) } },
    select: { id: true, name: true, location: true },
  });
  const camMap = new Map(cameras.map((c) => [c.id, c]));

  const result = Object.entries(buckets).map(([cameraId, days]) => ({
    cameraId,
    cameraName: camMap.get(cameraId)?.name || cameraId,
    location: camMap.get(cameraId)?.location || '',
    total: Object.values(days).reduce((a, b) => a + b, 0),
    byDay: days,
  }));

  result.sort((a, b) => b.total - a.total);
  return NextResponse.json({ cameras: result });
}
