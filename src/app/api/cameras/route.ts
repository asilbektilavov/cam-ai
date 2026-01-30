import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;

  const cameras = await prisma.camera.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(cameras);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const body = await req.json();

  const { name, location, streamUrl, venueType, resolution, fps, motionThreshold, captureInterval } = body;

  if (!name || !location || !streamUrl) {
    return badRequest('Name, location, and streamUrl are required');
  }

  const camera = await prisma.camera.create({
    data: {
      name,
      location,
      streamUrl,
      venueType: venueType || 'retail',
      resolution: resolution || '1920x1080',
      fps: fps || 30,
      motionThreshold: motionThreshold || 5.0,
      captureInterval: captureInterval || 5,
      organizationId: orgId,
    },
  });

  return NextResponse.json(camera, { status: 201 });
}
