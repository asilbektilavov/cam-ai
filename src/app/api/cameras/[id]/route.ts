import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { cameraMonitor } from '@/lib/services/camera-monitor';
import { streamManager } from '@/lib/services/stream-manager';
import { go2rtcManager } from '@/lib/services/go2rtc-manager';

const ATTENDANCE_SERVICE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:8002';
const DETECTION_SERVICE_URL = process.env.DETECTION_SERVICE_URL || 'http://localhost:8001';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    include: {
      _count: { select: { sessions: true, events: true } },
    },
  });

  if (!camera) return notFound('Camera not found');

  return NextResponse.json(camera);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Camera not found');

  const body = await req.json();
  const {
    name, location, streamUrl, status, venueType, resolution, fps,
    motionThreshold, captureInterval, isMonitoring,
    onvifHost, onvifPort, onvifUser, onvifPass, hasPtz, retentionDays,
    purpose, maxPeopleCapacity,
  } = body;

  // Detect purpose change while camera is monitoring — need to switch services
  const purposeChanged = purpose !== undefined && purpose !== existing.purpose;
  const isCurrentlyMonitoring = existing.isMonitoring;

  const camera = await prisma.camera.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(location !== undefined && { location }),
      ...(streamUrl !== undefined && { streamUrl }),
      ...(status !== undefined && { status }),
      ...(venueType !== undefined && { venueType }),
      ...(purpose !== undefined && { purpose }),
      ...(resolution !== undefined && { resolution }),
      ...(fps !== undefined && { fps }),
      ...(motionThreshold !== undefined && { motionThreshold }),
      ...(captureInterval !== undefined && { captureInterval }),
      ...(isMonitoring !== undefined && { isMonitoring }),
      ...(onvifHost !== undefined && { onvifHost }),
      ...(onvifPort !== undefined && { onvifPort }),
      ...(onvifUser !== undefined && { onvifUser }),
      ...(onvifPass !== undefined && { onvifPass }),
      ...(hasPtz !== undefined && { hasPtz }),
      ...(retentionDays !== undefined && { retentionDays }),
      ...(maxPeopleCapacity !== undefined && { maxPeopleCapacity }),
    },
  });

  // If purpose changed and camera was monitoring, restart on the correct service
  if (purposeChanged && isCurrentlyMonitoring) {
    const stopService = async (serviceUrl: string, cameraId: string) => {
      const form = new URLSearchParams();
      form.append('camera_id', cameraId);
      await fetch(`${serviceUrl}/cameras/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }).catch(() => {});
    };

    const startService = async (
      serviceUrl: string,
      cam: { id: string; streamUrl: string; purpose: string },
    ) => {
      const form = new URLSearchParams();
      form.append('camera_id', cam.id);
      form.append('stream_url', cam.streamUrl);
      if (cam.purpose.startsWith('attendance_')) {
        form.append('direction', cam.purpose === 'attendance_entry' ? 'entry' : 'exit');
      }
      await fetch(`${serviceUrl}/cameras/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    };

    try {
      // Stop old service
      const wasAttendance = existing.purpose.startsWith('attendance_');
      if (wasAttendance) {
        await stopService(ATTENDANCE_SERVICE_URL, id);
      } else {
        await stopService(DETECTION_SERVICE_URL, id);
        await cameraMonitor.stopMonitoring(id).catch(() => {});
      }

      // Start new service
      const isNowAttendance = camera.purpose.startsWith('attendance_');
      if (isNowAttendance) {
        void go2rtcManager.addStream(id, camera.streamUrl);
        await startService(ATTENDANCE_SERVICE_URL, camera);
      } else {
        void go2rtcManager.addStream(id, camera.streamUrl);
        await startService(DETECTION_SERVICE_URL, camera).catch(() => {});
        await cameraMonitor.startMonitoring(id).catch(() => {});
      }
    } catch (e) {
      console.warn('[CameraUpdate] Failed to switch services on purpose change:', e);
    }
  }

  return NextResponse.json(camera);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const deleted = await prisma.camera.deleteMany({
    where: { id, organizationId: orgId },
  });
  if (deleted.count === 0) return notFound('Camera not found');

  // Stop monitoring and streaming for deleted camera
  await cameraMonitor.stopMonitoring(id).catch(() => {});
  await streamManager.stopStream(id).catch(() => {});

  return NextResponse.json({ success: true });
}
