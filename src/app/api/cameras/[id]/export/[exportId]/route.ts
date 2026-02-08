import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { stat } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { Readable } from 'stream';

const DATA_DIR = path.join(process.cwd(), 'data');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

// Import progress tracking from the export route
let exportProgress: Map<
  string,
  { progress: number; status: string; message: string; error?: string }
>;

try {
  // Dynamic import won't work in edge, so we access it through a shared module approach
  // In practice this map is only available within the same process
  exportProgress = new Map();
} catch {
  exportProgress = new Map();
}

// Lazy-load the progress map from the export route module
async function getExportProgress() {
  try {
    const exportModule = await import('../route');
    return exportModule.exportProgress;
  } catch {
    return exportProgress;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; exportId: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_recordings');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { exportId } = await params;

  // Validate exportId format (UUID)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(exportId)) {
    return NextResponse.json(
      { error: 'Invalid export ID' },
      { status: 400 }
    );
  }

  // Check for exported files (both mp4 and avi)
  const mp4Path = path.join(EXPORTS_DIR, `${exportId}.mp4`);
  const aviPath = path.join(EXPORTS_DIR, `${exportId}.avi`);

  let filePath: string | null = null;
  let contentType = 'video/mp4';
  let extension = 'mp4';

  if (existsSync(mp4Path)) {
    filePath = mp4Path;
    contentType = 'video/mp4';
    extension = 'mp4';
  } else if (existsSync(aviPath)) {
    filePath = aviPath;
    contentType = 'video/x-msvideo';
    extension = 'avi';
  }

  if (filePath) {
    // File exists - stream it as download
    try {
      const fileStat = await stat(filePath);
      const nodeStream = createReadStream(filePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      return new NextResponse(webStream, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="export_${exportId}.${extension}"`,
          'Content-Length': fileStat.size.toString(),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return NextResponse.json(
        { error: 'Failed to read export file', status: 'error' },
        { status: 500 }
      );
    }
  }

  // File doesn't exist yet - check progress
  const progressMap = await getExportProgress();
  const progressInfo = progressMap.get(exportId);

  if (progressInfo) {
    if (progressInfo.status === 'error') {
      return NextResponse.json(
        {
          status: 'error',
          error: progressInfo.error || progressInfo.message,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      status: 'processing',
      progress: progressInfo.progress,
      message: progressInfo.message,
    });
  }

  // No file and no progress info - export not found
  return NextResponse.json(
    { error: 'Export not found', status: 'error' },
    { status: 404 }
  );
}
