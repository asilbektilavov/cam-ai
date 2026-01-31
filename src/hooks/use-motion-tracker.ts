'use client';

import { useState, useCallback } from 'react';
import { useEventStream } from './use-event-stream';

/**
 * Tracks which cameras currently have active motion/sessions.
 * Uses SSE events to maintain the set of active cameras.
 */
export function useMotionTracker() {
  const [activeCameras, setActiveCameras] = useState<Set<string>>(new Set());

  useEventStream(
    useCallback((event) => {
      if (event.type === 'session_started') {
        setActiveCameras((prev) => {
          const next = new Set(prev);
          next.add(event.cameraId);
          return next;
        });
      } else if (event.type === 'session_ended') {
        setActiveCameras((prev) => {
          const next = new Set(prev);
          next.delete(event.cameraId);
          return next;
        });
      }
    }, [])
  );

  const hasMotion = useCallback(
    (cameraId: string) => activeCameras.has(cameraId),
    [activeCameras]
  );

  return { activeCameras, hasMotion };
}
