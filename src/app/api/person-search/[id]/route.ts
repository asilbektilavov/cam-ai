import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const orgId = session.user.organizationId;

  const person = await prisma.searchPerson.findFirst({
    where: { id, organizationId: orgId },
    include: {
      integration: { select: { id: true, type: true, name: true } },
      sightings: {
        include: {
          camera: { select: { id: true, name: true, location: true } },
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
      },
    },
  });

  if (!person) return notFound('Person not found');

  return NextResponse.json(person);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.searchPerson.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Person not found');

  const body = await req.json();
  const { isActive, integrationId } = body;

  const updated = await prisma.searchPerson.update({
    where: { id },
    data: {
      ...(isActive !== undefined && { isActive }),
      ...(integrationId !== undefined && { integrationId: integrationId || null }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const orgId = session.user.organizationId;

  const deleted = await prisma.searchPerson.deleteMany({
    where: { id, organizationId: orgId },
  });

  if (deleted.count === 0) return notFound('Person not found');

  return NextResponse.json({ success: true });
}
