import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { getFrameAbsolutePath } from '@/lib/services/frame-storage';
import { getAuthSession } from '@/lib/api-utils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path: segments } = await params;
  const relativePath = segments.join('/');

  // Security: ensure path doesn't escape the frames directory
  if (relativePath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Verify the org prefix matches the user's org
  const orgId = session.user.organizationId;
  if (!relativePath.startsWith(orgId + '/')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const absPath = getFrameAbsolutePath(relativePath);

  try {
    const data = await readFile(absPath);
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Frame not found' }, { status: 404 });
  }
}
