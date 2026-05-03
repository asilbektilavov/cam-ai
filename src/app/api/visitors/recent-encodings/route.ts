import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/visitors/recent-encodings?cameraId=xxx&seconds=600
// Internal endpoint used by attendance-service on startup to repopulate
// its in-frame face tracker. Without this, a service restart would
// re-count everyone still standing in the queue.
export async function GET(req: NextRequest) {
  const cameraId = req.nextUrl.searchParams.get('cameraId');
  if (!cameraId) {
    return NextResponse.json({ error: 'cameraId required' }, { status: 400 });
  }
  const seconds = Math.max(
    60,
    Math.min(3600, parseInt(req.nextUrl.searchParams.get('seconds') || '600', 10))
  );
  const since = new Date(Date.now() - seconds * 1000);

  const visitors = await prisma.visitor.findMany({
    where: { cameraId, timestamp: { gte: since } },
    select: { faceDescriptor: true, timestamp: true },
    orderBy: { timestamp: 'desc' },
  });

  const items: Array<{ encoding: number[]; timestamp: string }> = [];
  for (const v of visitors) {
    try {
      const enc = JSON.parse(v.faceDescriptor) as number[];
      if (Array.isArray(enc) && enc.length > 0) {
        items.push({ encoding: enc, timestamp: v.timestamp.toISOString() });
      }
    } catch {
      /* skip malformed */
    }
  }

  return NextResponse.json({ count: items.length, items });
}
