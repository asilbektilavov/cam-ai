import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// File-based cache for line crossing events — reliable across Turbopack HMR.
const CACHE_DIR = path.join('/tmp', 'camai-line-crossing-events');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheFile(cameraId: string) {
  return path.join(CACHE_DIR, `${cameraId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function readCache(cameraId: string): { events: unknown[]; ts: number } | null {
  try {
    const file = getCacheFile(cameraId);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() - data.ts > 5000) return null; // stale
    return data;
  } catch {
    return null;
  }
}

function writeCache(cameraId: string, events: unknown[]) {
  ensureCacheDir();
  const file = getCacheFile(cameraId);
  fs.writeFileSync(file, JSON.stringify({ events, ts: Date.now() }));
}

// POST /api/line-crossing/events — receive events from line-crossing-service
export async function POST(req: NextRequest) {
  const sync = req.headers.get('x-attendance-sync');
  if (!sync) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const cameraId = body.cameraId as string;
  const events = body.events as unknown[];

  if (!cameraId) {
    return NextResponse.json({ error: 'cameraId required' }, { status: 400 });
  }

  writeCache(cameraId, events || []);

  return NextResponse.json({ ok: true });
}

// GET /api/line-crossing/events?cameraId=xxx — browser polls for overlay data
export async function GET(req: NextRequest) {
  const cameraId = req.nextUrl.searchParams.get('cameraId');
  if (!cameraId) {
    return NextResponse.json({ error: 'cameraId required' }, { status: 400 });
  }

  const cached = readCache(cameraId);
  if (!cached) {
    return NextResponse.json({ events: [] });
  }

  return NextResponse.json({ events: cached.events });
}
