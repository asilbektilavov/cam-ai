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

interface HourData {
  available: boolean;
  segments: number;
  duration: number;
  size: number;
}

type TimelineHours = Record<string, HourData>;

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

  if (!date) return badRequest('Query parameter "date" is required (YYYY-MM-DD)');
  if (!isValidDate(date)) return badRequest('Invalid date format. Use YYYY-MM-DD');

  const recordingsDir = path.join(DATA_DIR, 'recordings', id, date);

  // Initialize all 24 hours as unavailable
  const hours: TimelineHours = {};
  for (let h = 0; h < 24; h++) {
    const hourStr = h.toString().padStart(2, '0');
    hours[hourStr] = {
      available: false,
      segments: 0,
      duration: 0,
      size: 0,
    };
  }

  try {
    let hourDirs: string[];
    try {
      hourDirs = await readdir(recordingsDir);
    } catch {
      // No recordings directory for this date - return empty timeline
      return NextResponse.json({
        cameraId: id,
        cameraName: camera.name,
        date,
        hours,
        totalSegments: 0,
        totalDuration: 0,
        totalSize: 0,
      });
    }

    let totalSegments = 0;
    let totalDuration = 0;
    let totalSize = 0;

    for (const hourDir of hourDirs) {
      // Only process valid hour directories (00-23)
      if (!/^\d{2}$/.test(hourDir)) continue;
      const hourNum = parseInt(hourDir, 10);
      if (hourNum < 0 || hourNum > 23) continue;

      const hourPath = path.join(recordingsDir, hourDir);

      try {
        const hourStat = await stat(hourPath);
        if (!hourStat.isDirectory()) continue;

        const files = await readdir(hourPath);
        const tsFiles = files.filter((f) => f.endsWith('.ts'));

        if (tsFiles.length === 0) continue;

        let hourSize = 0;
        let hourDuration = 0;

        for (const tsFile of tsFiles) {
          const filePath = path.join(hourPath, tsFile);
          try {
            const fileStat = await stat(filePath);
            hourSize += fileStat.size;

            // Estimate duration from filename or file size
            const durationMatch = tsFile.match(/_(\d+(?:\.\d+)?)s\.ts$/);
            if (durationMatch) {
              hourDuration += parseFloat(durationMatch[1]);
            } else {
              // Estimate: ~1 Mbps bitrate
              const estimated = fileStat.size / 125000;
              hourDuration += estimated > 0 ? estimated : 6;
            }
          } catch {
            // Skip files that can't be stat'd
          }
        }

        hours[hourDir] = {
          available: true,
          segments: tsFiles.length,
          duration: Math.round(hourDuration),
          size: hourSize,
        };

        totalSegments += tsFiles.length;
        totalDuration += hourDuration;
        totalSize += hourSize;
      } catch {
        // Skip directories that can't be read
      }
    }

    return NextResponse.json({
      cameraId: id,
      cameraName: camera.name,
      date,
      hours,
      totalSegments,
      totalDuration: Math.round(totalDuration),
      totalSize,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to build timeline' },
      { status: 500 }
    );
  }
}
