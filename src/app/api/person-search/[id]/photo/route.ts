import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import fs from 'fs/promises';
import path from 'path';

export async function GET(
  _req: NextRequest,
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
    select: { photoPath: true },
  });

  if (!person) return notFound('Person not found');

  const filePath = path.join(process.cwd(), person.photoPath);

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch {
    return notFound('Photo file not found');
  }

  const ext = person.photoPath.split('.').pop()?.toLowerCase() || 'jpg';
  const contentType =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
