import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// Validate segment name: must end with .ts, no path traversal
function isValidSegment(segment: string): boolean {
  if (!segment.endsWith('.ts')) return false;
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) return false;
  // Only allow alphanumeric, hyphens, underscores, dots
  if (!/^[a-zA-Z0-9_\-]+\.ts$/.test(segment)) return false;
  return true;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; segment: string }> }
) {
  const { id, segment } = await params;

  if (!isValidSegment(segment)) {
    return NextResponse.json(
      { error: 'Invalid segment name' },
      { status: 400 }
    );
  }

  const segmentPath = path.join(DATA_DIR, 'streams', id, segment);

  // Ensure resolved path is within the expected directory (prevent traversal)
  const resolvedPath = path.resolve(segmentPath);
  const expectedDir = path.resolve(path.join(DATA_DIR, 'streams', id));
  if (!resolvedPath.startsWith(expectedDir + path.sep)) {
    return NextResponse.json(
      { error: 'Invalid path' },
      { status: 403 }
    );
  }

  try {
    const data = await readFile(resolvedPath);

    return new NextResponse(data, {
      headers: {
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Segment not found' },
      { status: 404 }
    );
  }
}
