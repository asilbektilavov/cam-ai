import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';
import '@/lib/services/notification-dispatcher'; // ensure listener is active
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

  // Also create Event for analytics
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { organizationId: true, branchId: true },
  });
  if (camera) {
    const description = `${direction === 'check_in' ? 'Вход' : 'Выход'}: ${employee.name} (${Math.round((confidence ?? 0) * 100)}%)`;

    await prisma.event.create({
      data: {
        cameraId,
        organizationId: camera.organizationId,
        branchId: camera.branchId || undefined,
        type: 'face_detected',
        severity: 'info',
        description,
        metadata: JSON.stringify({ employeeId, direction, confidence }),
      },
    });

    // Get camera name for notifications
    const cameraFull = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { name: true, location: true },
    });

    // Emit camera-event for AutomationEngine
    const cameraEvent: CameraEvent = {
      type: 'face_detected',
      cameraId,
      organizationId: camera.organizationId,
      branchId: camera.branchId || '',
      data: { employeeId, employeeName: employee.name, direction, confidence },
    };
    appEvents.emit('camera-event', cameraEvent);

    // Emit smart-alert for NotificationDispatcher (Telegram)
    appEvents.emit('smart-alert', {
      featureType: 'person_search',
      cameraId,
      cameraName: cameraFull?.name || 'Камера',
      cameraLocation: cameraFull?.location || '',
      organizationId: camera.organizationId,
      branchId: camera.branchId || '',
      integrationId: null,
      severity: 'info',
      message: description,
      metadata: { employeeId, employeeName: employee.name, direction, confidence },
    });
  }

  return NextResponse.json({ success: true, recordId: record.id });
}
