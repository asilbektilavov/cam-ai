import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rbac';

const VALID_MODES = ['yolo_only', 'yolo_gemini_events', 'yolo_gemini_always'] as const;

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session.user as { organizationId?: string }).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: 'No organization' }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { analysisMode: true },
  });

  return NextResponse.json({
    analysisMode: org?.analysisMode || 'yolo_gemini_events',
  });
}

export async function PUT(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'manage_settings');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const orgId = (session.user as { organizationId?: string }).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: 'No organization' }, { status: 400 });
  }

  const body = await req.json();
  const { analysisMode } = body;

  if (!VALID_MODES.includes(analysisMode)) {
    return NextResponse.json(
      { error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` },
      { status: 400 }
    );
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { analysisMode },
  });

  return NextResponse.json({ analysisMode });
}
