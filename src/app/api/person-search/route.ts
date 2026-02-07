import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(_req: NextRequest) {
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

  const persons = await prisma.searchPerson.findMany({
    where: { organizationId: orgId },
    include: {
      integration: { select: { id: true, type: true, name: true } },
      _count: { select: { sightings: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(persons);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;

  const body = await req.json();
  const { name, photoBase64, faceDescriptor, integrationId } = body;

  if (!name || !photoBase64 || !faceDescriptor) {
    return badRequest('Missing required fields: name, photoBase64, faceDescriptor');
  }

  // Save photo to disk
  const photoDir = join(process.cwd(), 'data', 'search-photos', orgId);
  await mkdir(photoDir, { recursive: true });

  const photoName = `${Date.now()}-${name.replace(/\s+/g, '_')}.jpg`;
  const photoPath = join(photoDir, photoName);

  const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
  await writeFile(photoPath, Buffer.from(base64Data, 'base64'));

  const person = await prisma.searchPerson.create({
    data: {
      organizationId: orgId,
      name,
      photoPath: `data/search-photos/${orgId}/${photoName}`,
      faceDescriptor: JSON.stringify(faceDescriptor),
      integrationId: integrationId || null,
    },
    include: {
      integration: { select: { id: true, type: true, name: true } },
      _count: { select: { sightings: true } },
    },
  });

  return NextResponse.json(person);
}
