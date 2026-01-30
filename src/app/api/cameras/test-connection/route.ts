import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const { streamUrl } = body;

  if (!streamUrl) {
    return badRequest('streamUrl is required');
  }

  try {
    // IP Webcam app serves snapshots at /shot.jpg
    const snapshotUrl = streamUrl.replace(/\/$/, '') + '/shot.jpg';
    const response = await fetch(snapshotUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `Camera returned ${response.status}`,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({
        success: false,
        error: `Expected image, got ${contentType}`,
      });
    }

    return NextResponse.json({
      success: true,
      contentType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return NextResponse.json({
      success: false,
      error: message,
    });
  }
}
