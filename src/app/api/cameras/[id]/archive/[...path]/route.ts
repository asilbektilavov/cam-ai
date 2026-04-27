import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { prisma } from '@/lib/prisma';

// Detect codec by reading the first PMT in the TS file. HEVC stream_type is
// 0x24, H.264 is 0x1B. Cheap and avoids spawning ffprobe.
async function isHevc(filePath: string): Promise<boolean> {
  try {
    const buf = await readFile(filePath, { encoding: null });
    // Scan for stream_type 0x24 in the first 64 KB (PMT usually appears early)
    const slice = buf.subarray(0, Math.min(64 * 1024, buf.length));
    for (let i = 0; i < slice.length - 1; i++) {
      if (slice[i] === 0x24 && (slice[i + 1] & 0xE0) === 0xE0) return true;
      if (slice[i] === 0x1B && (slice[i + 1] & 0xE0) === 0xE0) return false;
    }
  } catch { /* fall through */ }
  return false;
}

const DEFAULT_RECORDINGS_DIR = path.join(process.cwd(), 'data', 'recordings');

async function getRecordingsDir(organizationId: string): Promise<string> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { storagePath: true },
    });
    if (org?.storagePath) return org.storagePath;
  } catch { /* fallback to default */ }
  return DEFAULT_RECORDINGS_DIR;
}

// Validate date format YYYY-MM-DD
function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

// Validate hour format HH (00-23)
function isValidHour(hour: string): boolean {
  return /^\d{2}$/.test(hour) && parseInt(hour, 10) >= 0 && parseInt(hour, 10) <= 23;
}

// Validate segment filename
function isValidSegment(segment: string): boolean {
  if (!segment.endsWith('.ts') && !segment.endsWith('.m3u8')) return false;
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) return false;
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(segment)) return false;
  return true;
}

function getContentType(filename: string): string {
  if (filename.endsWith('.ts')) return 'video/mp2t';
  if (filename.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  return 'application/octet-stream';
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path: pathSegments } = await params;

  // Expected path format: [date, hour, segment] e.g., ["2025-01-15", "14", "segment001.ts"]
  if (!pathSegments || pathSegments.length < 2 || pathSegments.length > 3) {
    return NextResponse.json(
      { error: 'Invalid path. Expected format: /{date}/{hour}/{segment.ts} or /{date}/{hour}' },
      { status: 400 }
    );
  }

  const [date, hour, ...rest] = pathSegments;
  const segment = rest[0];

  // Validate date
  if (!isValidDate(date)) {
    return NextResponse.json(
      { error: 'Invalid date format. Use YYYY-MM-DD' },
      { status: 400 }
    );
  }

  // Validate hour
  if (!isValidHour(hour)) {
    return NextResponse.json(
      { error: 'Invalid hour format. Use HH (00-23)' },
      { status: 400 }
    );
  }

  // If no segment specified, return error
  if (!segment) {
    return NextResponse.json(
      { error: 'Segment filename is required in path' },
      { status: 400 }
    );
  }

  // Validate segment filename
  if (!isValidSegment(segment)) {
    return NextResponse.json(
      { error: 'Invalid segment filename' },
      { status: 400 }
    );
  }

  // Resolve recordings base via the camera's organization (custom storagePath)
  const camera = await prisma.camera.findUnique({
    where: { id },
    select: { organizationId: true },
  });
  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }
  const recordingsBase = await getRecordingsDir(camera.organizationId);

  // Build the file path
  const filePath = path.join(recordingsBase, id, date, hour, segment);

  // Resolve and verify path is within expected directory (prevent traversal)
  const resolvedPath = path.resolve(filePath);
  const expectedBase = path.resolve(path.join(recordingsBase, id));
  if (!resolvedPath.startsWith(expectedBase + path.sep)) {
    return NextResponse.json(
      { error: 'Invalid path' },
      { status: 403 }
    );
  }

  try {
    // Verify file exists
    await stat(resolvedPath);
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Browser (Chrome) cannot play HEVC natively. If the segment is HEVC,
  // transcode video to H.264 on the fly via ffmpeg streaming.
  if (segment.endsWith('.ts') && (await isHevc(resolvedPath))) {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-v', 'error',
      '-i', resolvedPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-an',
      '-fflags', '+genpts+igndts',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'mpegts',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const stream = new ReadableStream({
      start(controller) {
        ff.stdout.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        ff.stdout.on('end', () => controller.close());
        ff.stderr.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().slice(0, 200);
          if (msg.trim()) console.warn(`[archive ${segment}] ffmpeg: ${msg}`);
        });
        ff.on('error', (err) => controller.error(err));
      },
      cancel() { try { ff.kill('SIGKILL'); } catch { /* ignore */ } },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // H264 / .m3u8 — serve as-is
  try {
    const data = await readFile(resolvedPath);
    const contentType = getContentType(segment);
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
