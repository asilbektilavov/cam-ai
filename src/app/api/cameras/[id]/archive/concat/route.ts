import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat, writeFile, mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { tmpdir } from 'os';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const DEFAULT_RECORDINGS_DIR = path.join(process.cwd(), 'data', 'recordings');

async function getRecordingsDir(organizationId: string): Promise<string> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { storagePath: true },
    });
    if (org?.storagePath) return org.storagePath;
  } catch { /* fallback */ }
  return DEFAULT_RECORDINGS_DIR;
}

function isValidDate(d: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(d); }
function isValidHour(h: string): boolean { return /^\d{2}$/.test(h) && +h >= 0 && +h <= 23; }

// GET /api/cameras/{id}/archive/concat?date=YYYY-MM-DD&hour=HH
// Streams the whole hour as one MPEG-TS file with normalized PTS so browser
// players can seek across the full duration like a regular video file.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  try {
    checkPermission(session, 'view_cameras');
  } catch (e: unknown) {
    if (e instanceof RBACError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!camera) return notFound('Camera not found');

  const date = req.nextUrl.searchParams.get('date');
  const hour = req.nextUrl.searchParams.get('hour');
  if (!date || !isValidDate(date)) return badRequest('Invalid date');
  if (!hour || !isValidHour(hour)) return badRequest('Invalid hour');

  const base = await getRecordingsDir(orgId);
  const hourDir = path.join(base, id, date, hour);

  let files: string[];
  try {
    files = (await readdir(hourDir)).filter((f) => f.endsWith('.ts')).sort();
  } catch {
    return NextResponse.json({ error: 'No recordings' }, { status: 404 });
  }
  if (files.length === 0) return NextResponse.json({ error: 'No recordings' }, { status: 404 });

  // Build a concat list file in /tmp
  const listDir = path.join(tmpdir(), 'camai-concat');
  await mkdir(listDir, { recursive: true });
  const listPath = path.join(listDir, `${id}-${date}-${hour}-${Date.now()}.txt`);
  const listBody = files
    .map((f) => `file '${path.join(hourDir, f).replace(/'/g, "'\\''")}'`)
    .join('\n');
  await writeFile(listPath, listBody, 'utf8');

  // Quick sanity: total size for Content-Length hint (approximate)
  let totalSize = 0;
  for (const f of files) {
    try { totalSize += (await stat(path.join(hourDir, f))).size; } catch { /* skip */ }
  }

  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-v', 'error',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-fflags', '+genpts+igndts',
    '-avoid_negative_ts', 'make_zero',
    '-f', 'mpegts',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const stream = new ReadableStream({
    start(controller) {
      ffmpeg.stdout.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      ffmpeg.stdout.on('end', () => controller.close());
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().slice(0, 200);
        if (msg.trim()) console.warn(`[concat ${id}/${date}/${hour}] ffmpeg: ${msg}`);
      });
      ffmpeg.on('error', (err) => controller.error(err));
      ffmpeg.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`[concat ${id}/${date}/${hour}] ffmpeg exited ${code}`);
        }
      });
      req.signal.addEventListener('abort', () => {
        try { ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
      });
    },
    cancel() {
      try { ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'public, max-age=300',
      'X-Estimated-Size': String(totalSize),
    },
  });
}
