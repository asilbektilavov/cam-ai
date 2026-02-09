import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';

const DETECTION_SERVICE_URL = process.env.DETECTION_SERVICE_URL || 'http://localhost:8001';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cameraId: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const { cameraId } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, organizationId: orgId },
    select: { id: true, streamUrl: true },
  });

  if (!camera || !camera.streamUrl) return notFound('Camera not found');

  // Redirect to detection service MJPEG stream directly (CORS enabled there)
  const url = `${DETECTION_SERVICE_URL}/stream/mjpeg?camera_url=${encodeURIComponent(camera.streamUrl)}`;

  return NextResponse.redirect(url);
}
