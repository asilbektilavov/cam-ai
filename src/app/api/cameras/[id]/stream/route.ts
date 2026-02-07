import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { streamManager } from '@/lib/services/stream-manager';
import { checkPermission, RBACError } from '@/lib/rbac';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });

  if (!camera) return notFound('Camera not found');

  const playlistPath = path.join(DATA_DIR, 'streams', id, 'live.m3u8');

  try {
    const playlist = await readFile(playlistPath, 'utf-8');

    return new NextResponse(playlist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Stream not available. Camera may be offline or not streaming.' },
      { status: 503 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, streamUrl: true, name: true },
  });

  if (!camera) return notFound('Camera not found');

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { action } = body;

  if (action !== 'start' && action !== 'stop') {
    return badRequest('Action must be "start" or "stop"');
  }

  try {
    if (action === 'start') {
      const streamInfo = await streamManager.startStream(id);
      return NextResponse.json({
        success: true,
        message: `Stream started for camera "${camera.name}"`,
        streamUrl: `/api/cameras/${id}/stream`,
        info: streamInfo,
      });
    } else {
      await streamManager.stopStream(id);
      return NextResponse.json({
        success: true,
        message: `Stream stopped for camera "${camera.name}"`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to manage stream';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
