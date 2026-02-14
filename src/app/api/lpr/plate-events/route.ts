import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Force dynamic to prevent Next.js from caching GET responses
export const dynamic = 'force-dynamic';

// File-based cache for plate detections — same pattern as face-events
const CACHE_DIR = path.join('/tmp', 'camai-plate-events');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheFile(cameraId: string) {
  return path.join(CACHE_DIR, `${cameraId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function readCache(cameraId: string): { detections: unknown[]; ts: number } | null {
  try {
    const file = getCacheFile(cameraId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(cameraId: string, detections: unknown[]) {
  try {
    ensureCacheDir();
    const file = getCacheFile(cameraId);
    fs.writeFileSync(file, JSON.stringify({ detections, ts: Date.now() }));
  } catch (e) {
    console.error('[plate-events] writeCache error:', e);
  }
}

// GET — browser polls for latest plate detection overlay data
export async function GET(req: NextRequest) {
  const cameraId = req.nextUrl.searchParams.get('cameraId');
  if (!cameraId) {
    return NextResponse.json({ detections: [] });
  }

  const cached = readCache(cameraId);
  if (!cached || Date.now() - cached.ts > 15000) {
    return NextResponse.json({ detections: [] });
  }

  return NextResponse.json({ detections: cached.detections });
}

// POST — called by plate-service with plate detection bboxes
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { cameraId, plates } = body as {
    cameraId: string;
    plates: Array<{
      bbox: { x: number; y: number; w: number; h: number };
      number: string;
      confidence: number;
      isKnown: boolean;
    }>;
  };

  if (!cameraId || !Array.isArray(plates)) {
    return NextResponse.json({ error: 'cameraId and plates required' }, { status: 400 });
  }

  const detections = plates.map((p) => ({
    type: 'plate',
    label: p.number || '???',
    confidence: p.confidence,
    bbox: p.bbox,
    classId: -1,
    color: p.isKnown ? '#22C55E' : '#3B82F6', // green for known, blue for unknown
  }));

  writeCache(cameraId, detections);

  return NextResponse.json({ ok: true });
}
