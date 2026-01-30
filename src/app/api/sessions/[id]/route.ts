import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const orgId = session.user.organizationId;

  const analysisSession = await prisma.analysisSession.findFirst({
    where: {
      id,
      camera: { organizationId: orgId },
    },
    include: {
      camera: { select: { name: true, location: true } },
      frames: {
        orderBy: { capturedAt: 'asc' },
      },
    },
  });

  if (!analysisSession) return notFound('Session not found');

  return NextResponse.json(analysisSession);
}
