'use client';

import { useEffect, useRef, useCallback } from 'react';

interface CameraEvent {
  type: string;
  cameraId: string;
  organizationId: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: CameraEvent) => void;

export function useEventStream(onEvent: EventHandler) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource('/api/events/stream');
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
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);
}
