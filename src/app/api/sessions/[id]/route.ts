import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_analytics');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

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
