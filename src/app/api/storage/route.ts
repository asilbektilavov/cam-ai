import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { storageManager } from '@/lib/services/storage-manager';
import { checkPermission, RBACError } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_recordings');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;

  try {
    const [usage, disk, perCamera] = await Promise.all([
      storageManager.getUsage(orgId),
      storageManager.getDiskUsage(),
      storageManager.getPerCameraUsage(orgId),
    ]);

    return NextResponse.json({
      total: storageManager.formatBytes(disk.total),
      used: storageManager.formatBytes(disk.used),
      free: storageManager.formatBytes(disk.free),
      percent: disk.percent,
      recordings: usage.recordingCount,
      totalRecordingSize: storageManager.formatBytes(usage.totalBytes),
      totalRecordingBytes: usage.totalBytes,
      oldestRecording: usage.oldestRecording,
      perCamera: perCamera.map((c) => ({
        cameraId: c.cameraId,
        cameraName: c.cameraName,
        size: storageManager.formatBytes(c.totalBytes),
        sizeBytes: c.totalBytes,
        recordings: c.recordingCount,
      })),
    });
  } catch (err) {
    console.error('[API /storage] Error fetching storage usage:', err);
    return NextResponse.json(
      { error: 'Failed to fetch storage usage' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_recordings');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  // Read password + retentionDays from body
  const body = await req.json().catch(() => ({}));
  const { password, retentionDays } = body as {
    password?: string;
    retentionDays?: number;
  };

  if (!password) return badRequest('Введите пароль');

  // Verify password
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) return unauthorized();

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return badRequest('Неверный пароль');

  if (retentionDays !== undefined && (isNaN(retentionDays) || retentionDays < 0)) {
    return NextResponse.json(
      { error: 'retentionDays must be a non-negative number' },
      { status: 400 }
    );
  }

  const orgId = session.user.organizationId;

  try {
    const deleted = await storageManager.cleanup(orgId, retentionDays);

    return NextResponse.json({ deleted });
  } catch (err) {
    console.error('[API /storage] Error running cleanup:', err);
    return NextResponse.json(
      { error: 'Failed to run storage cleanup' },
      { status: 500 }
    );
  }
}
