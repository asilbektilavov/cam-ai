import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
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

  const role = process.env.INSTANCE_ROLE || 'standalone';

  if (role === 'central') {
    const instances = await prisma.remoteInstance.findMany({
      include: {
        _count: { select: { remoteCameras: true, remoteEvents: true } },
      },
      orderBy: { lastSyncAt: 'desc' },
    });

    // Compute online/offline status based on lastSyncAt
    const TEN_MINUTES = 10 * 60 * 1000;
    const enriched = instances.map((inst) => ({
      id: inst.id,
      instanceId: inst.instanceId,
      name: inst.name,
      branchName: inst.branchName,
      address: inst.address,
      lastSyncAt: inst.lastSyncAt,
      status: inst.lastSyncAt && Date.now() - inst.lastSyncAt.getTime() < TEN_MINUTES
        ? 'online'
        : 'offline',
      cameras: inst._count.remoteCameras,
      events: inst._count.remoteEvents,
    }));

    return NextResponse.json({
      role: 'central',
      connectedInstances: enriched,
    });
  }

  if (role === 'satellite') {
    const queueSize = await prisma.syncQueue.count();
    return NextResponse.json({
      role: 'satellite',
      instanceId: process.env.INSTANCE_ID || null,
      syncTo: process.env.SYNC_TO || null,
      syncInterval: parseInt(process.env.SYNC_INTERVAL || '300'),
      queueSize,
    });
  }

  return NextResponse.json({ role: 'standalone' });
}
