import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

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

interface SegmentInfo {
  name: string;
  size: number;
  duration: number;
  url: string;
  startMs?: number; // epoch ms parsed from filename
}

interface HourInfo {
  hour: string;
  segments: SegmentInfo[];
  totalDuration: number;
  totalSize: number;
}

export async function GET(
  req: NextRequest,
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
    select: { id: true, name: true },
  });

  if (!camera) return notFound('Camera not found');

  const { searchParams } = req.nextUrl;
  const date = searchParams.get('date');
  const hour = searchParams.get('hour');
  const format = searchParams.get('format'); // 'json' (default) or 'playlist'

  if (!date) return badRequest('Query parameter "date" is required (YYYY-MM-DD)');
  if (!isValidDate(date)) return badRequest('Invalid date format. Use YYYY-MM-DD');
  if (hour && !isValidHour(hour)) return badRequest('Invalid hour format. Use HH (00-23)');

  const recordingsBase = await getRecordingsDir(orgId);
  const recordingsDir = path.join(recordingsBase, id, date);

  try {
    // If a specific hour is requested
    if (hour) {
      const hourDir = path.join(recordingsDir, hour);
      const segments = await listSegments(hourDir, id, date, hour);

      // If playlist format is requested, return m3u8
      if (format === 'playlist') {
        const playlist = generatePlaylist(segments);
        return new NextResponse(playlist, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'public, max-age=60',
          },
        });
      }

      return NextResponse.json({
        cameraId: id,
        cameraName: camera.name,
        date,
        hour,
        segments,
        totalDuration: segments.reduce((sum, s) => sum + s.duration, 0),
        totalSize: segments.reduce((sum, s) => sum + s.size, 0),
        playlistUrl: `/api/cameras/${id}/archive?date=${date}&hour=${hour}&format=playlist`,
      });
    }

    // List all hours for the date
    let hourDirs: string[];
    try {
      hourDirs = await readdir(recordingsDir);
    } catch {
      return NextResponse.json({
        cameraId: id,
        cameraName: camera.name,
        date,
        hours: [],
        message: 'No recordings found for this date',
      });
    }

    // Sort hours and collect info
    const sortedHours = hourDirs
      .filter((h) => /^\d{2}$/.test(h))
      .sort();

    const hours: HourInfo[] = [];

    for (const h of sortedHours) {
      const hourDir = path.join(recordingsDir, h);
      const segments = await listSegments(hourDir, id, date, h);
      if (segments.length > 0) {
        hours.push({
          hour: h,
          segments,
          totalDuration: segments.reduce((sum, s) => sum + s.duration, 0),
          totalSize: segments.reduce((sum, s) => sum + s.size, 0),
        });
      }
    }

    // If playlist format is requested, generate a combined playlist
    if (format === 'playlist') {
      const allSegments = hours.flatMap((h) => h.segments);
      const playlist = generatePlaylist(allSegments);
      return new NextResponse(playlist, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    return NextResponse.json({
      cameraId: id,
      cameraName: camera.name,
      date,
      hours,
      totalDuration: hours.reduce((sum, h) => sum + h.totalDuration, 0),
      totalSize: hours.reduce((sum, h) => sum + h.totalSize, 0),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to list recordings' },
      { status: 500 }
    );
  }
}

async function listSegments(
  dirPath: string,
  cameraId: string,
  date: string,
  hour: string
): Promise<SegmentInfo[]> {
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }

  const tsFiles = files
    .filter((f) => f.endsWith('.ts'))
    .sort();

  // Parse start times from filenames: "2026-04-26_14-26-16.ts" → epoch ms.
  // Duration of segment N = startTime[N+1] - startTime[N].
  // The recorder uses segment_time=60 so the last segment is ~60s by default.
  type Parsed = { file: string; size: number; startMs: number | null };
  const parsed: Parsed[] = [];
  for (const file of tsFiles) {
    let s = 0;
    try {
      s = (await stat(path.join(dirPath, file))).size;
    } catch { continue; }

    // Match YYYY-MM-DD_HH-MM-SS.ts (ffmpeg strftime output)
    const m = file.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.ts$/);
    let startMs: number | null = null;
    if (m) {
      // Treat as UTC to avoid TZ-induced negative gaps; only the diff matters
      startMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
    parsed.push({ file, size: s, startMs });
  }

  const segments: SegmentInfo[] = parsed.map((p, i) => {
    let duration = 60; // default — matches segment_time in stream-manager
    if (p.startMs !== null) {
      const next = parsed[i + 1];
      if (next?.startMs && next.startMs > p.startMs) {
        const diff = (next.startMs - p.startMs) / 1000;
        // Sanity: clamp to [0.5s, 600s]
        if (diff >= 0.5 && diff <= 600) duration = diff;
      }
    } else {
      // Fallback for non-strftime names: assume 2 Mbps
      duration = Math.max(1, Math.min(600, p.size / 250_000));
    }
    return {
      name: p.file,
      size: p.size,
      duration,
      url: `/api/cameras/${cameraId}/archive/${date}/${hour}/${p.file}`,
      startMs: p.startMs ?? undefined,
    };
  });

  return segments;
}

function generatePlaylist(segments: SegmentInfo[]): string {
  if (segments.length === 0) {
    return '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-ENDLIST\n';
  }

  const maxDuration = Math.ceil(Math.max(...segments.map((s) => s.duration)));

  let playlist = '#EXTM3U\n';
  playlist += '#EXT-X-VERSION:6\n';
  playlist += `#EXT-X-TARGETDURATION:${maxDuration}\n`;
  playlist += '#EXT-X-PLAYLIST-TYPE:VOD\n';
  playlist += '#EXT-X-INDEPENDENT-SEGMENTS\n';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Each .ts has its own PTS origin (camera-embedded timestamp). DISCONTINUITY
    // tells hls.js to splice them; PROGRAM-DATE-TIME tags pin each segment to
    // an absolute clock so the player can compute a consistent total duration
    // and seek to absolute positions.
    if (i > 0) {
      playlist += '#EXT-X-DISCONTINUITY\n';
    }
    if (seg.startMs !== undefined) {
      playlist += `#EXT-X-PROGRAM-DATE-TIME:${new Date(seg.startMs).toISOString()}\n`;
    }
    playlist += `#EXTINF:${seg.duration.toFixed(3)},\n`;
    playlist += `${seg.url}\n`;
  }

  playlist += '#EXT-X-ENDLIST\n';
  return playlist;
}
