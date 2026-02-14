import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { cameraMonitor } from '@/lib/services/camera-monitor';
import { go2rtcManager } from '@/lib/services/go2rtc-manager';
import { plateServiceManager } from '@/lib/services/plate-service-manager';
import { checkPermission, RBACError } from '@/lib/rbac';

const ATTENDANCE_SERVICE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:8002';
const DETECTION_SERVICE_URL = process.env.DETECTION_SERVICE_URL || 'http://localhost:8001';
const PLATE_SERVICE_URL = process.env.PLATE_SERVICE_URL || 'http://localhost:8003';

async function startExternalCamera(
  serviceUrl: string,
  camera: { id: string; streamUrl: string; purpose: string },
) {
  const form = new URLSearchParams();
  form.append('camera_id', camera.id);
  form.append('stream_url', camera.streamUrl);
  // Attendance cameras need direction
  if (camera.purpose.startsWith('attendance_')) {
    form.append('direction', camera.purpose === 'attendance_entry' ? 'entry' : 'exit');
  } else if (camera.purpose === 'people_search') {
    form.append('direction', 'search');
  }

  const resp = await fetch(`${serviceUrl}/cameras/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Service error: ${err}`);
  }
}

async function syncSearchPersons() {
  try {
    // Fetch search person descriptors from our API (internal, no auth needed for server-side)
    const descriptorsResp = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/person-search/descriptors`, {
      headers: { 'x-attendance-sync': 'true' },
    });
    if (!descriptorsResp.ok) return;
    const descriptors = await descriptorsResp.json();
    if (!Array.isArray(descriptors) || descriptors.length === 0) return;

    // Send to attendance-service
    const resp = await fetch(`${ATTENDANCE_SERVICE_URL}/search-persons/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(descriptors),
    });
    if (!resp.ok) {
      console.warn('[Monitor] Failed to sync search persons:', await resp.text());
    }
  } catch (e) {
    console.warn('[Monitor] Search persons sync error:', e instanceof Error ? e.message : e);
  }
}

async function syncPlates() {
  try {
    const platesResp = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/lpr/plates-sync`, {
      headers: { 'x-plate-sync': 'true' },
    });
    if (!platesResp.ok) return;
    const plates = await platesResp.json();
    if (!Array.isArray(plates) || plates.length === 0) return;

    const resp = await fetch(`${PLATE_SERVICE_URL}/plates/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plates),
    });
    if (!resp.ok) {
      console.warn('[Monitor] Failed to sync plates:', await resp.text());
    }
  } catch (e) {
    console.warn('[Monitor] Plates sync error:', e instanceof Error ? e.message : e);
  }
}

async function startPlateCamera(camera: { id: string; streamUrl: string }) {
  const resp = await fetch(`${PLATE_SERVICE_URL}/cameras/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id: camera.id, stream_url: camera.streamUrl }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Plate service error: ${err}`);
  }
}

async function stopPlateCamera(cameraId: string) {
  const resp = await fetch(`${PLATE_SERVICE_URL}/cameras/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id: cameraId }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Plate service error: ${err}`);
  }
}

async function stopExternalCamera(serviceUrl: string, cameraId: string) {
  const form = new URLSearchParams();
  form.append('camera_id', cameraId);

  const resp = await fetch(`${serviceUrl}/cameras/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Service error: ${err}`);
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

  if (camera.purpose.startsWith('attendance_') || camera.purpose === 'people_search') {
    // Attendance / People Search camera — register go2rtc stream + send to attendance-service
    try {
      void go2rtcManager.addStream(id, camera.streamUrl);
      // Sync search persons before starting people_search camera
      if (camera.purpose === 'people_search') {
        await syncSearchPersons();
      }
      await startExternalCamera(ATTENDANCE_SERVICE_URL, camera);
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
  } else if (camera.purpose === 'lpr') {
    // LPR camera — auto-start plate-service + register go2rtc + send camera
    try {
      const serviceReady = await plateServiceManager.ensureRunning();
      if (!serviceReady) {
        return NextResponse.json(
          { error: 'Plate service не удалось запустить. Убедитесь что venv создан: cd plate-service && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt' },
          { status: 502 }
        );
      }
      void go2rtcManager.addStream(id, camera.streamUrl);
      await syncPlates();
      await startPlateCamera(camera);
      await prisma.camera.update({
        where: { id },
        data: { isMonitoring: true, status: 'online' },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Plate service unavailable' },
        { status: 502 }
      );
    }
  } else {
    // Detection camera — send to autonomous detection-service + register go2rtc + start CameraMonitor for motion/Gemini
    try {
      void go2rtcManager.addStream(id, camera.streamUrl);
      await startExternalCamera(DETECTION_SERVICE_URL, camera);
      // Still start CameraMonitor for motion detection + Gemini AI sessions
      await cameraMonitor.startMonitoring(id);
    } catch (e) {
      // Detection service may be unavailable, still start CameraMonitor
      console.warn(`[Monitor] Detection service unavailable, falling back to CameraMonitor only:`, e instanceof Error ? e.message : e);
      await cameraMonitor.startMonitoring(id);
    }
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

  if (camera.purpose.startsWith('attendance_') || camera.purpose === 'people_search') {
    try {
      await stopExternalCamera(ATTENDANCE_SERVICE_URL, id);
    } catch {
      // Attendance service may be down, still update DB
    }
    void go2rtcManager.removeStream(id);
    await prisma.camera.update({
      where: { id },
      data: { isMonitoring: false, status: 'offline' },
    });
  } else if (camera.purpose === 'lpr') {
    try {
      await stopPlateCamera(id);
    } catch {
      // Plate service may be down
    }
    void go2rtcManager.removeStream(id);
    await prisma.camera.update({
      where: { id },
      data: { isMonitoring: false, status: 'offline' },
    });
  } else {
    // Stop detection-service watcher
    try {
      await stopExternalCamera(DETECTION_SERVICE_URL, id);
    } catch {
      // Detection service may be down
    }
    // Stop CameraMonitor (motion/Gemini)
    await cameraMonitor.stopMonitoring(id);
  }

  return NextResponse.json({ success: true, monitoring: false });
}
