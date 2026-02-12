import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

// GET /api/attendance — list attendance records (with filters)
export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_analytics');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const employeeId = searchParams.get('employeeId');
  const direction = searchParams.get('direction');
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 1000);

  const where: Record<string, unknown> = {
    employee: { organizationId: orgId },
  };

  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    where.timestamp = { gte: start, lte: end };
  }

  if (employeeId) where.employeeId = employeeId;
  if (direction) where.direction = direction;

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: {
      employee: { select: { id: true, name: true, position: true, department: true, photoPath: true } },
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  return NextResponse.json(records);
}

// POST /api/attendance — create manual attendance record
export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json();
  const { employeeId, cameraId, direction } = body;

  if (!employeeId || !direction) {
    return badRequest('employeeId and direction are required');
  }

  if (!['check_in', 'check_out'].includes(direction)) {
    return badRequest('direction must be check_in or check_out');
  }

  const record = await prisma.attendanceRecord.create({
    data: {
      employeeId,
      cameraId: cameraId || 'manual',
      direction,
      confidence: 1.0,
    },
    include: {
      employee: { select: { id: true, name: true, position: true, department: true } },
    },
  });

  return NextResponse.json(record);
}
