import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';
import type { SmartAlert } from '@/lib/services/event-emitter';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const person = await prisma.searchPerson.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!person) return notFound('Person not found');

  const body = await req.json();
  const { cameraId, confidence, description } = body;

  if (!cameraId || confidence === undefined) {
    return badRequest('Missing cameraId or confidence');
  }

  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, organizationId: orgId },
  });
  if (!camera) return badRequest('Camera not found');

  const sighting = await prisma.personSighting.create({
    data: {
      searchPersonId: id,
      cameraId,
      confidence,
      description: description || null,
      notified: true,
    },
  });

  // Emit smart alert for notification
  if (person.integrationId) {
    const alert: SmartAlert = {
      featureType: 'person_search',
      cameraId,
      cameraName: camera.name,
      cameraLocation: camera.location,
      organizationId: orgId,
      branchId: camera.branchId,
      integrationId: person.integrationId,
      severity: 'critical',
      message: `Обнаружен разыскиваемый: ${person.name} (камера: ${camera.name}, ${camera.location}). Точность: ${Math.round(confidence * 100)}%`,
      metadata: {
        personId: person.id,
        personName: person.name,
        confidence,
        sightingId: sighting.id,
      },
    };
    appEvents.emit('smart-alert', alert);
  }

  // Emit camera event
  const event: CameraEvent = {
    type: 'person_sighting',
    cameraId,
    organizationId: orgId,
    branchId: camera.branchId,
    data: {
      personId: person.id,
      personName: person.name,
      confidence,
      sightingId: sighting.id,
    },
  };
  appEvents.emit('camera-event', event);

  return NextResponse.json(sighting);
}
