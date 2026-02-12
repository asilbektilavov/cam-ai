import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { cameraMonitor } from '@/lib/services/camera-monitor';
import { checkPermission, RBACError } from '@/lib/rbac';

const ATTENDANCE_SERVICE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:8002';

async function startAttendanceCamera(camera: { id: string; streamUrl: string; purpose: string }) {
  const direction = camera.purpose === 'attendance_entry' ? 'entry' : 'exit';
  const form = new URLSearchParams();
  form.append('camera_id', camera.id);
  form.append('stream_url', camera.streamUrl);
  form.append('direction', direction);

  const resp = await fetch(`${ATTENDANCE_SERVICE_URL}/cameras/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Attendance service error: ${err}`);
  }
}

async function stopAttendanceCamera(cameraId: string) {
  const form = new URLSearchParams();
  form.append('camera_id', cameraId);

  const resp = await fetch(`${ATTENDANCE_SERVICE_URL}/cameras/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Attendance service error: ${err}`);
  }
}

export async function POST(
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
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!camera) return notFound('Camera not found');

  if (camera.purpose.startsWith('attendance_')) {
    // Attendance camera — send to attendance-service
    try {
      await startAttendanceCamera(camera);
      await prisma.camera.update({
        where: { id },
        data: { isMonitoring: true, status: 'online' },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Attendance service unavailable' },
        { status: 502 }
      );
    }
  } else {
    // Detection camera — use standard YOLO monitor
    await cameraMonitor.startMonitoring(id);
  }

  return NextResponse.json({ success: true, monitoring: true });
}

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
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!camera) return notFound('Camera not found');

  if (camera.purpose.startsWith('attendance_')) {
    try {
      await stopAttendanceCamera(id);
    } catch {
      // Attendance service may be down, still update DB
    }
    await prisma.camera.update({
      where: { id },
      data: { isMonitoring: false, status: 'offline' },
    });
  } else {
    await cameraMonitor.stopMonitoring(id);
  }

  return NextResponse.json({ success: true, monitoring: false });
}
