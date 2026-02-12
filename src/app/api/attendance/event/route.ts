import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// POST /api/attendance/event — called by the attendance-service
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { employeeId, cameraId, direction, confidence, timestamp, snapshot } = body;

  if (!employeeId || !cameraId || !direction) {
    return NextResponse.json(
      { error: 'employeeId, cameraId, direction required' },
      { status: 400 }
    );
  }

  // Verify employee exists
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  // Save snapshot if provided
  let snapshotPath: string | null = null;
  if (snapshot) {
    const dir = join(process.cwd(), 'data', 'attendance-snapshots', employee.organizationId);
    await mkdir(dir, { recursive: true });
    const filename = `${Date.now()}-${employeeId}.jpg`;
    const buf = Buffer.from(snapshot, 'base64');
    await writeFile(join(dir, filename), buf);
    snapshotPath = `data/attendance-snapshots/${employee.organizationId}/${filename}`;
  }

  const record = await prisma.attendanceRecord.create({
    data: {
      employeeId,
      cameraId,
      direction,
      confidence: confidence ?? 0,
      snapshotPath,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    },
  });

  return NextResponse.json({ success: true, recordId: record.id });
}
