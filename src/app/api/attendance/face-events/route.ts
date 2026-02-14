import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';
import fs from 'fs';
import path from 'path';

// File-based cache for face detections — reliable across Turbopack HMR and workers.
const CACHE_DIR = path.join('/tmp', 'camai-face-events');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheFile(cameraId: string) {
  // Sanitize cameraId for filesystem
  return path.join(CACHE_DIR, `${cameraId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function readCache(cameraId: string): { detections: unknown[]; ts: number } | null {
  try {
    const file = getCacheFile(cameraId);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return data;
  } catch {
    return null;
  }
}

function writeCache(cameraId: string, detections: unknown[]) {
  try {
    ensureCacheDir();
    const file = getCacheFile(cameraId);
    fs.writeFileSync(file, JSON.stringify({ detections, ts: Date.now() }));
  } catch {
    // ignore write errors
  }
}

// GET /api/attendance/face-events?cameraId=xxx — browser polls for latest face data
export async function GET(req: NextRequest) {
  const cameraId = req.nextUrl.searchParams.get('cameraId');
  if (!cameraId) {
    return NextResponse.json({ detections: [] });
  }

  const cached = readCache(cameraId);
  if (!cached || Date.now() - cached.ts > 5000) {
    // No data or stale (>5s) — return empty
    return NextResponse.json({ detections: [] });
  }

  return NextResponse.json({ detections: cached.detections });
}

// POST /api/attendance/face-events — called by attendance-service with face detections
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { cameraId, faces } = body as {
    cameraId: string;
    faces: Array<{
      bbox: { x: number; y: number; w: number; h: number };
      name: string | null;
      confidence: number;
    }>;
  };

  if (!cameraId || !Array.isArray(faces)) {
    return NextResponse.json({ error: 'cameraId and faces required' }, { status: 400 });
  }

  // Convert to Detection format
  const detections = faces.map((f) => ({
    type: 'face',
    label: f.name || 'Unknown',
    confidence: f.confidence,
    bbox: f.bbox,
    classId: -1,
    color: f.name ? '#22C55E' : '#EF4444', // green for recognized, red for unknown
  }));

  // Store in file-based cache for polling
  writeCache(cameraId, detections);

  // Also emit via SSE for backward compatibility
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { organizationId: true, branchId: true },
  });

  if (camera) {
    const event: CameraEvent = {
      type: 'face_detected',
      cameraId,
      organizationId: camera.organizationId,
      branchId: camera.branchId || '',
      data: { detections, capturedAt: Date.now() },
    };
    appEvents.emit('camera-event', event);
  }

  return NextResponse.json({ ok: true });
}
