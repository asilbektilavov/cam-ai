'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';

interface CameraEvent {
  type: string;
  cameraId: string;
  organizationId: string;
  branchId?: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: CameraEvent) => void;

export function useEventStream(onEvent: EventHandler) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const { selectedBranchId } = useAppStore();
  const branchIdRef = useRef(selectedBranchId);
  branchIdRef.current = selectedBranchId;

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;

      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const branchParam = branchIdRef.current ? `?branchId=${branchIdRef.current}` : '';
      const es = new EventSource(`/api/events/stream${branchParam}`);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as CameraEvent;
          onEventRef.current(event);
        } catch {
          // Ignore parse errors (keepalive, etc.)
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    // Watchdog: check every 5s if connection is alive, reconnect if dead
    const watchdog = setInterval(() => {
      if (cancelled) return;
      const es = eventSourceRef.current;
      if (!es || es.readyState === EventSource.CLOSED) {
        // Connection lost without onerror firing (Turbopack HMR, etc.)
        connect();
      }
    }, 5000);

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(watchdog);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [selectedBranchId]);
}
