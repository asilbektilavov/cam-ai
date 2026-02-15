import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

// GET /api/attendance/snapshot?path=data/attendance-snapshots/orgId/file.jpg
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path');
  if (!path || !path.startsWith('data/attendance-snapshots/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Prevent path traversal
  if (path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const fullPath = join(process.cwd(), path);
    const buf = await readFile(fullPath);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
