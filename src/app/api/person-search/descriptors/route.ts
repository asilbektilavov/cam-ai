import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function GET(_req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;

  const persons = await prisma.searchPerson.findMany({
    where: { organizationId: orgId, isActive: true },
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
