import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

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

  // Build the file path
  const filePath = path.join(DATA_DIR, 'recordings', id, date, hour, segment);

  // Resolve and verify path is within expected directory (prevent traversal)
  const resolvedPath = path.resolve(filePath);
  const expectedBase = path.resolve(path.join(DATA_DIR, 'recordings', id));
  if (!resolvedPath.startsWith(expectedBase + path.sep)) {
    return NextResponse.json(
      { error: 'Invalid path' },
      { status: 403 }
    );
  }

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
    return NextResponse.json(
      { error: 'File not found' },
      { status: 404 }
    );
  }
}
