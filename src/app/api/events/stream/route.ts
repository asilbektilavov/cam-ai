import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';
import { checkPermission, RBACError } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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

  const orgId = session.user.organizationId;
  const branchId = new URL(request.url).searchParams.get('branchId');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const handler = (event: CameraEvent) => {
        // Only send events for this organization (and branch if specified)
        if (event.organizationId !== orgId) return;
        if (branchId && event.branchId !== branchId) return;

        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream closed
        }
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

      // Use request.signal to detect client disconnect
      request.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
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
