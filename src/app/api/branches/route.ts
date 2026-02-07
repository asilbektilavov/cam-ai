import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_dashboard');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;

  const branches = await prisma.branch.findMany({
    where: { organizationId: orgId },
    include: {
      _count: { select: { cameras: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // On central, append remote instances as virtual branches
  if (process.env.INSTANCE_ROLE === 'central') {
    const remoteInstances = await prisma.remoteInstance.findMany({
      include: { _count: { select: { remoteCameras: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const TEN_MINUTES = 10 * 60 * 1000;
    const remoteBranches = remoteInstances.map((ri) => ({
      id: `remote:${ri.id}`,
      organizationId: ri.organizationId,
      name: ri.branchName,
      address: ri.address,
      createdAt: ri.createdAt,
      updatedAt: ri.updatedAt,
      isRemote: true,
      status: ri.lastSyncAt && Date.now() - ri.lastSyncAt.getTime() < TEN_MINUTES
        ? 'online'
        : 'offline',
      lastSyncAt: ri.lastSyncAt,
      _count: { cameras: ri._count.remoteCameras },
    }));

    return NextResponse.json([...branches, ...remoteBranches]);
  }

  return NextResponse.json(branches);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_branches');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

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
