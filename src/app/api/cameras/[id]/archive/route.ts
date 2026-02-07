import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

const DATA_DIR = path.join(process.cwd(), 'data');

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

  const recordingsDir = path.join(DATA_DIR, 'recordings', id, date);

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

  const segments: SegmentInfo[] = [];

  for (const file of tsFiles) {
    const filePath = path.join(dirPath, file);
    try {
      const fileStat = await stat(filePath);
      // Estimate duration: typical TS segment is ~6 seconds
      // If segment naming contains duration info, parse it; otherwise estimate from file size
      const duration = estimateSegmentDuration(file, fileStat.size);

      segments.push({
        name: file,
        size: fileStat.size,
        duration,
        url: `/api/cameras/${cameraId}/archive/${date}/${hour}/${file}`,
      });
    } catch {
      // Skip files that can't be stat'd
    }
  }

  return segments;
}

function estimateSegmentDuration(filename: string, size: number): number {
  // Try to extract duration from filename pattern like "segment_6.0s.ts"
  const durationMatch = filename.match(/_(\d+(?:\.\d+)?)s\.ts$/);
  if (durationMatch) {
    return parseFloat(durationMatch[1]);
  }
  // Default estimate: ~1 Mbps bitrate, so duration = size / (1_000_000 / 8) = size / 125000
  // Typical segment: 6 seconds
  // Fallback to 6 seconds if we can't determine
  if (size > 0) {
    return Math.round((size / 125000) * 10) / 10 || 6;
  }
  return 6;
}

function generatePlaylist(segments: SegmentInfo[]): string {
  if (segments.length === 0) {
    return '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-ENDLIST\n';
  }

  const maxDuration = Math.ceil(Math.max(...segments.map((s) => s.duration)));

  let playlist = '#EXTM3U\n';
  playlist += '#EXT-X-VERSION:3\n';
  playlist += `#EXT-X-TARGETDURATION:${maxDuration}\n`;
  playlist += '#EXT-X-PLAYLIST-TYPE:VOD\n';

  for (const segment of segments) {
    playlist += `#EXTINF:${segment.duration.toFixed(3)},\n`;
    playlist += `${segment.url}\n`;
  }

  playlist += '#EXT-X-ENDLIST\n';
  return playlist;
}
