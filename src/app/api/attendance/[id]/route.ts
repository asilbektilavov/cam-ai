import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

const ATTENDANCE_SERVICE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:8002';

/** Sync all active employees to the attendance-service (fire-and-forget). */
async function syncEmployeesToAttendanceService() {
  try {
    const employees = await prisma.employee.findMany({
      where: { isActive: true, photoPath: { not: null } },
      select: { id: true, name: true, photoPath: true },
    });
    const apiBase = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const payload = employees.map((e) => ({
      id: e.id,
      name: e.name,
      photoUrl: `${apiBase}/api/attendance/${e.id}/photo`,
    }));
    await fetch(`${ATTENDANCE_SERVICE_URL}/employees/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Non-critical — attendance-service may be offline
  }
}

// GET /api/attendance/[id] — get employee detail with recent attendance
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      attendanceRecords: {
        orderBy: { timestamp: 'desc' },
        take: 50,
      },
      _count: { select: { attendanceRecords: true } },
    },
  });

  if (!employee || employee.organizationId !== session.user.organizationId) {
    return notFound('Employee not found');
  }

  return NextResponse.json(employee);
}

// PATCH /api/attendance/[id] — update employee
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== session.user.organizationId) {
    return notFound('Employee not found');
  }

  const body = await req.json();
  const { name, position, department, isActive, faceDescriptor } = body;

  const employee = await prisma.employee.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(position !== undefined && { position }),
      ...(department !== undefined && { department }),
      ...(isActive !== undefined && { isActive }),
      ...(faceDescriptor !== undefined && { faceDescriptor: JSON.stringify(faceDescriptor) }),
    },
    include: {
      _count: { select: { attendanceRecords: true } },
    },
  });

  // Sync if name or active status changed
  if (name !== undefined || isActive !== undefined) {
    syncEmployeesToAttendanceService();
  }

  return NextResponse.json(employee);
}

// DELETE /api/attendance/[id] — delete employee
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== session.user.organizationId) {
    return notFound('Employee not found');
  }

  await prisma.employee.delete({ where: { id } });

  // Sync to attendance-service so deleted employee is no longer recognized
  syncEmployeesToAttendanceService();

  return NextResponse.json({ success: true });
}
