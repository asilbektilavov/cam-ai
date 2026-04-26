import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

const DEFAULT_RECORDINGS_DIR = path.join(process.cwd(), 'data', 'recordings');

async function getRecordingsDir(organizationId: string): Promise<string> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { storagePath: true },
    });
    if (org?.storagePath) return org.storagePath;
  } catch { /* fallback */ }
  return DEFAULT_RECORDINGS_DIR;
}

// GET /api/cameras/{id}/dates — list YYYY-MM-DD dirs that contain at least one .ts file
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: unknown) {
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

  const base = await getRecordingsDir(orgId);
  const cameraDir = path.join(base, id);

  let entries: string[];
  try {
    entries = await readdir(cameraDir);
  } catch {
    return NextResponse.json({ dates: [] });
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const candidates = entries.filter((e) => dateRe.test(e));
  const dates: string[] = [];

  for (const dateDir of candidates) {
    const full = path.join(cameraDir, dateDir);
    try {
      const s = await stat(full);
      if (!s.isDirectory()) continue;
      const hourDirs = await readdir(full);
      let hasFiles = false;
      for (const h of hourDirs) {
        if (!/^\d{2}$/.test(h)) continue;
        const files = await readdir(path.join(full, h)).catch(() => [] as string[]);
        if (files.some((f) => f.endsWith('.ts'))) {
          hasFiles = true;
          break;
        }
      }
      if (hasFiles) dates.push(dateDir);
    } catch { /* skip */ }
  }

  dates.sort().reverse(); // newest first
  return NextResponse.json({ dates });
}
