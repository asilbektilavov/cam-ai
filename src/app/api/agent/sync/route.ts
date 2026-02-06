import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/agent/sync — Edge Agent pushes data to cloud
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing agent token' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const agentToken = await prisma.agentToken.findUnique({
    where: { token },
    include: { organization: true },
  });

  if (!agentToken) {
    return NextResponse.json({ error: 'Invalid agent token' }, { status: 401 });
  }

  // Update last used
  await prisma.agentToken.update({
    where: { id: agentToken.id },
    data: { lastUsedAt: new Date() },
  });

  try {
    const body = await req.json();
    const { agentName, version, cameras, events } = body as {
      agentName?: string;
      version?: string;
      cameras?: { id: string; name: string; location: string; status: string; isMonitoring: boolean }[];
      events?: { id: string; cameraName: string; cameraLocation: string; type: string; severity: string; description: string; timestamp: string; metadata?: string }[];
    };

    // Upsert agent
    const agent = await prisma.agent.upsert({
      where: agentToken.agentId ? { id: agentToken.agentId } : { id: 'none' },
      update: {
        name: agentName || 'Agent',
        status: 'online',
        lastSeenAt: new Date(),
        version: version || null,
        ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
      },
      create: {
        organizationId: agentToken.organizationId,
        name: agentName || 'Agent',
        status: 'online',
        lastSeenAt: new Date(),
        version: version || null,
        ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
      },
    });

    // Link token to agent
    if (!agentToken.agentId) {
      await prisma.agentToken.update({
        where: { id: agentToken.id },
        data: { agentId: agent.id },
      });
    }

    // Upsert cameras
    let camerasAccepted = 0;
    for (const cam of cameras || []) {
      await prisma.agentCamera.upsert({
        where: {
          agentId_originalId: { agentId: agent.id, originalId: cam.id },
        },
        update: {
          name: cam.name,
          location: cam.location,
          status: cam.status,
          isMonitoring: cam.isMonitoring,
        },
        create: {
          agentId: agent.id,
          originalId: cam.id,
          name: cam.name,
          location: cam.location,
          status: cam.status,
          isMonitoring: cam.isMonitoring,
        },
      });
      camerasAccepted++;
    }

    // Insert events (skip duplicates)
    let eventsAccepted = 0;
    for (const evt of events || []) {
      try {
        await prisma.agentEvent.upsert({
          where: {
            agentId_originalId: { agentId: agent.id, originalId: evt.id },
          },
          update: {},
          create: {
            agentId: agent.id,
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
        // duplicate — skip
      }
    }

    return NextResponse.json({
      ok: true,
      agentId: agent.id,
      accepted: { cameras: camerasAccepted, events: eventsAccepted },
    });
  } catch (error) {
    console.error('[Agent Sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
