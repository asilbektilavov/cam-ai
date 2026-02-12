import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

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
  return NextResponse.json({ success: true });
}
