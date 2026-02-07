import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function PATCH(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_integrations');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const body = await request.json();
  const { notifyBranches } = body as { notifyBranches: string[] };

  if (!Array.isArray(notifyBranches)) {
    return badRequest('notifyBranches должен быть массивом');
  }

  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'telegram' } },
  });

  if (!integration) {
    return badRequest('Telegram не подключён');
  }

  const config = JSON.parse(integration.config) as Record<string, string>;
  config.notifyBranches = JSON.stringify(notifyBranches);

  await prisma.integration.update({
    where: { id: integration.id },
    data: { config: JSON.stringify(config) },
  });

  return NextResponse.json({ success: true, notifyBranches });
}
