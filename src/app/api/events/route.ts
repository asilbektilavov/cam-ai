import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, parseRemoteBranchId } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(req: NextRequest) {
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

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);

  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const cameraId = searchParams.get('cameraId');
  const type = searchParams.get('type');
  const severity = searchParams.get('severity');
  const rawBranchId = searchParams.get('branchId');
  const { isRemote, localBranchId, remoteInstanceId } = parseRemoteBranchId(rawBranchId);

  // If filtering by a remote instance, only return remote events
  if (isRemote && remoteInstanceId) {
    const remoteWhere = {
      remoteInstanceId,
      ...(type && { type }),
      ...(severity && { severity }),
    };

    const [remoteEvents, remoteTotal] = await Promise.all([
      prisma.remoteEvent.findMany({
        where: remoteWhere,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { remoteInstance: { select: { branchName: true } } },
      }),
      prisma.remoteEvent.count({ where: remoteWhere }),
    ]);

    const events = remoteEvents.map((e) => ({
      id: e.id,
      cameraId: null,
      type: e.type,
      severity: e.severity,
      description: e.description,
      timestamp: e.timestamp,
      metadata: e.metadata,
      camera: { name: e.cameraName, location: e.cameraLocation },
      branchName: e.remoteInstance.branchName,
      isRemote: true,
    }));

    return NextResponse.json({
      events,
      pagination: {
        page,
        limit,
        total: remoteTotal,
        totalPages: Math.ceil(remoteTotal / limit),
      },
    });
  }

  const where = {
    organizationId: orgId,
    ...(localBranchId && { branchId: localBranchId }),
    ...(cameraId && { cameraId }),
    ...(type && { type }),
    ...(severity && { severity }),
  };

  const [localEvents, localTotal] = await Promise.all([
    prisma.event.findMany({
      where,
      include: { camera: { select: { name: true, location: true } } },
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count({ where }),
  ]);

  // On central without branch filter, merge remote events
  if (process.env.INSTANCE_ROLE === 'central' && !localBranchId) {
    const remoteWhere = {
      ...(type && { type }),
      ...(severity && { severity }),
    };

    const [remoteEvents, remoteTotal] = await Promise.all([
      prisma.remoteEvent.findMany({
        where: remoteWhere,
        orderBy: { timestamp: 'desc' },
        take: limit,
        include: { remoteInstance: { select: { branchName: true } } },
      }),
      prisma.remoteEvent.count({ where: remoteWhere }),
    ]);

    const mergedEvents = [
      ...localEvents.map((e) => ({ ...e, isRemote: false })),
      ...remoteEvents.map((e) => ({
        id: e.id,
        cameraId: null,
        type: e.type,
        severity: e.severity,
        description: e.description,
        timestamp: e.timestamp,
        metadata: e.metadata,
        camera: { name: e.cameraName, location: e.cameraLocation },
        branchName: e.remoteInstance.branchName,
        isRemote: true,
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return NextResponse.json({
      events: mergedEvents,
      pagination: {
        page,
        limit,
        total: localTotal + remoteTotal,
        totalPages: Math.ceil((localTotal + remoteTotal) / limit),
      },
    });
  }

  return NextResponse.json({
    events: localEvents,
    pagination: {
      page,
      limit,
      total: localTotal,
      totalPages: Math.ceil(localTotal / limit),
    },
  });
}
