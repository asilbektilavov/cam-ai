import { NextRequest } from 'next/server';
import { getAuthSession } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rbac';

async function getExportProgress() {
  try {
    const exportModule = await import('../../route');
    return exportModule.exportProgress;
  } catch {
    return new Map();
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; exportId: string }> }
) {
  const session = await getAuthSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    checkPermission(session, 'manage_recordings');
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const { id: _cameraId, exportId } = await params;

  const progressMap = await getExportProgress();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastProgress = -1;
      let ticks = 0;
      const maxTicks = 300; // 5 minutes max (1s intervals)

      const interval = setInterval(() => {
        ticks++;

        const info = progressMap.get(exportId);

        if (!info) {
          // Export not found or not started yet
          if (ticks > 10) {
            // Give up after 10 seconds
            const data = JSON.stringify({
              progress: 0,
              status: 'error',
              error: 'Экспорт не найден',
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            clearInterval(interval);
            controller.close();
          }
          return;
        }

        // Only send updates when progress changes
        if (info.progress !== lastProgress || info.status !== 'processing') {
          lastProgress = info.progress;

          const data = JSON.stringify({
            progress: info.progress,
            status: info.status,
            message: info.message,
            ...(info.status === 'completed'
              ? { downloadUrl: `/api/cameras/${_cameraId}/export/${exportId}` }
              : {}),
            ...(info.error ? { error: info.error } : {}),
          });

          controller.enqueue(encoder.encode(`data: ${data}\n\n`));

          // Close stream if completed or error
          if (info.status === 'completed' || info.status === 'error') {
            clearInterval(interval);
            controller.close();
            return;
          }
        }

        if (ticks >= maxTicks) {
          const data = JSON.stringify({
            progress: 0,
            status: 'error',
            error: 'Таймаут экспорта',
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          clearInterval(interval);
          controller.close();
        }
      }, 1000);

      // Send initial heartbeat
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 0, status: 'processing', message: 'Подключение...' })}\n\n`));
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
