import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  // Allow internal calls from attendance-service
  const isInternal = req.headers.get('x-attendance-sync') === 'true';

  let orgFilter: { organizationId: string } | object = {};

  if (isInternal) {
    // Internal call — return all active search persons across all orgs
    orgFilter = {};
  } else {
    const session = await getAuthSession();
    if (!session) return unauthorized();

    try {
      checkPermission(session, 'view_events');
    } catch (e: any) {
      if (e instanceof RBACError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    orgFilter = { organizationId: session.user.organizationId };
  }

  const persons = await prisma.searchPerson.findMany({
    where: { ...orgFilter, isActive: true },
    select: {
      id: true,
      name: true,
      faceDescriptor: true,
      integrationId: true,
    },
  });

  const result = persons.map((p) => ({
    id: p.id,
    name: p.name,
    descriptor: JSON.parse(p.faceDescriptor) as number[],
    integrationId: p.integrationId,
  }));

  return NextResponse.json(result);
}
