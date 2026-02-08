import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rbac';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'view_analytics');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: cameraId } = await params;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Query params "from" and "to" are required (ISO timestamps)' },
      { status: 400 }
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json(
      { error: 'Invalid date format' },
      { status: 400 }
    );
  }

  const frames = await prisma.analysisFrame.findMany({
    where: {
      session: { cameraId },
      capturedAt: {
        gte: fromDate,
        lte: toDate,
      },
      detections: { not: null },
    },
    select: {
      capturedAt: true,
      detections: true,
    },
    orderBy: { capturedAt: 'asc' },
    take: 1000,
  });

  const result = frames.map((f) => ({
    capturedAt: f.capturedAt.toISOString(),
    detections: f.detections ? JSON.parse(f.detections) : [],
  }));

  return NextResponse.json(result);
}
