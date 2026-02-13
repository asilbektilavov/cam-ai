import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

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

// GET /api/attendance/employees — list employees (also used by attendance-service sync)
export async function GET(req: NextRequest) {
  // Support service-to-service sync: x-attendance-sync header or x-api-key
  const syncHeader = req.headers.get('x-attendance-sync');
  const apiKey = req.headers.get('x-api-key');
  if (syncHeader === 'true' || apiKey) {
    // Service auth — return all active employees with photo paths for attendance-service
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, name: true, photoPath: true },
    });

    return NextResponse.json(
      employees.map((e) => ({
        id: e.id,
        name: e.name,
        photoPath: e.photoPath,
      }))
    );
  }

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
  const employees = await prisma.employee.findMany({
    where: { organizationId: orgId },
    include: {
      _count: { select: { attendanceRecords: true } },
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(employees);
}

// POST /api/attendance/employees — create employee
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

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { name, position, department, photoBase64, faceDescriptor } = body;

  if (!name) {
    return badRequest('name is required');
  }

  // Save photo if provided
  let photoPath: string | null = null;
  if (photoBase64) {
    const dir = join(process.cwd(), 'data', 'employee-photos', orgId);
    await mkdir(dir, { recursive: true });
    const filename = `${Date.now()}-${name.replace(/\s+/g, '_')}.jpg`;
    const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
    await writeFile(join(dir, filename), Buffer.from(base64Data, 'base64'));
    photoPath = `data/employee-photos/${orgId}/${filename}`;
  }

  const employee = await prisma.employee.create({
    data: {
      organizationId: orgId,
      name,
      position: position || null,
      department: department || null,
      photoPath,
      faceDescriptor: faceDescriptor ? JSON.stringify(faceDescriptor) : null,
    },
    include: {
      _count: { select: { attendanceRecords: true } },
    },
  });

  // Auto-sync to attendance-service so new employee is recognized immediately
  syncEmployeesToAttendanceService();

  return NextResponse.json(employee);
}
