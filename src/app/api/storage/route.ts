import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { storageManager } from '@/lib/services/storage-manager';
import { checkPermission, RBACError } from '@/lib/rbac';

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

  const orgId = session.user.organizationId;
  const url = new URL(req.url);
  const retentionDaysParam = url.searchParams.get('retentionDays');
  const retentionDays = retentionDaysParam
    ? parseInt(retentionDaysParam, 10)
    : undefined;

  if (retentionDays !== undefined && (isNaN(retentionDays) || retentionDays < 0)) {
    return NextResponse.json(
      { error: 'retentionDays must be a non-negative number' },
      { status: 400 }
    );
  }

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
