import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const handler = (event: CameraEvent) => {
        // Only send events for this organization
        if (event.organizationId !== orgId) return;

        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      appEvents.on('camera-event', handler);

      // Send keepalive every 30 seconds
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 30000);

      // Cleanup when client disconnects
      const cleanup = () => {
        appEvents.off('camera-event', handler);
        clearInterval(keepalive);
      };

      // Handle stream cancellation
      const originalCancel = stream.cancel?.bind(stream);
      stream.cancel = (reason) => {
        cleanup();
        return originalCancel?.(reason) ?? Promise.resolve();
      };
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
    },
  });
}
