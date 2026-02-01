import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySyncKey } from '@/lib/sync-auth';

interface SyncCamera {
  id: string;
  name: string;
  location: string;
  status: string;
  isMonitoring: boolean;
}

interface SyncEvent {
  id: string;
  cameraName: string;
  cameraLocation: string;
  type: string;
  severity: string;
  description: string;
  timestamp: string;
  metadata?: string;
}

interface SyncPayload {
  instanceId: string;
  branchName: string;
  branchAddress?: string;
  organizationName: string;
  cameras: SyncCamera[];
  events: SyncEvent[];
}

export async function POST(req: NextRequest) {
  const authError = verifySyncKey(req);
  if (authError) return authError;

  try {
    const body = (await req.json()) as SyncPayload;

    if (!body.instanceId || !body.branchName) {
      return NextResponse.json({ error: 'instanceId and branchName are required' }, { status: 400 });
    }

    // Get organization (central's own org)
    const org = await prisma.organization.findFirst();
    if (!org) {
      return NextResponse.json({ error: 'No organization found' }, { status: 500 });
    }

    // Upsert remote instance
    const remoteInstance = await prisma.remoteInstance.upsert({
      where: { instanceId: body.instanceId },
      update: {
        name: body.organizationName,
        branchName: body.branchName,
        address: body.branchAddress || null,
        lastSyncAt: new Date(),
        status: 'online',
      },
      create: {
        organizationId: org.id,
        instanceId: body.instanceId,
        name: body.organizationName,
        branchName: body.branchName,
        address: body.branchAddress || null,
        lastSyncAt: new Date(),
        status: 'online',
      },
    });

    // Upsert cameras
    let camerasAccepted = 0;
    for (const cam of body.cameras || []) {
      await prisma.remoteCamera.upsert({
        where: {
          remoteInstanceId_originalId: {
            remoteInstanceId: remoteInstance.id,
            originalId: cam.id,
          },
        },
        update: {
          name: cam.name,
          location: cam.location,
          status: cam.status,
          isMonitoring: cam.isMonitoring,
        },
        create: {
          remoteInstanceId: remoteInstance.id,
          originalId: cam.id,
          name: cam.name,
          location: cam.location,
          status: cam.status,
          isMonitoring: cam.isMonitoring,
        },
      });
      camerasAccepted++;
    }

    // Insert events (skip duplicates via upsert)
    let eventsAccepted = 0;
    for (const evt of body.events || []) {
      try {
        await prisma.remoteEvent.upsert({
          where: {
            remoteInstanceId_originalId: {
              remoteInstanceId: remoteInstance.id,
              originalId: evt.id,
            },
          },
          update: {}, // Already exists — skip
          create: {
            remoteInstanceId: remoteInstance.id,
            originalId: evt.id,
            cameraName: evt.cameraName,
            cameraLocation: evt.cameraLocation,
            type: evt.type,
            severity: evt.severity,
            description: evt.description,
            timestamp: new Date(evt.timestamp),
            metadata: evt.metadata || null,
          },
        });
        eventsAccepted++;
      } catch {
        // Duplicate — skip
      }
    }

    return NextResponse.json({
      ok: true,
      accepted: { events: eventsAccepted, cameras: camerasAccepted },
    });
  } catch (error) {
    console.error('[Sync] Push error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
