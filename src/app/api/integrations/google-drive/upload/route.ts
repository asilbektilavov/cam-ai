import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { uploadRecording } from '@/lib/services/google-drive';

/** POST — upload a recording to Google Drive. */
export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => ({}));
  const { recordingId } = body as { recordingId?: string };

  if (!recordingId) return badRequest('recordingId обязателен');

  try {
    const uploadedCount = await uploadRecording(session.user.organizationId, recordingId);
    return NextResponse.json({ success: true, uploadedFiles: uploadedCount });
  } catch (err) {
    console.error('[GoogleDrive] Upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
