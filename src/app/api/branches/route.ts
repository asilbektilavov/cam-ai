import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;

  const branches = await prisma.branch.findMany({
    where: { organizationId: orgId },
    include: {
      _count: { select: { cameras: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(branches);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { name, address } = body;

  if (!name) {
    return badRequest('Название филиала обязательно');
  }

  const branch = await prisma.branch.create({
    data: {
      name,
      address: address || null,
      organizationId: orgId,
    },
  });

  return NextResponse.json(branch, { status: 201 });
}
