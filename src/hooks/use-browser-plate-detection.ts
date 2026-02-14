'use client';

import { useState, useEffect, useRef } from 'react';
import type { Detection } from '@/components/detection-overlay';
import { browserPlateDetector } from '@/lib/browser-plate-detector';

interface UseBrowserPlateDetectionOptions {
  enabled?: boolean;
}

interface UseBrowserPlateDetectionResult {
  detections: Detection[];
  fps: number;
  backend: string | null;
  loading: boolean;
  error: string | null;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Hook that runs license plate detection in the browser via ONNX YOLOv8.
 * Provides fast visual bbox for plates.
 *
 * Uses setTimeout instead of requestAnimationFrame to avoid blocking
 * the browser's paint/render pipeline. The heavy ONNX inference (~50-100ms)
 * would cause video frame drops if run inside rAF callbacks.
 * With setTimeout, the browser can render video frames between detections.
 */
export function useBrowserPlateDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseBrowserPlateDetectionOptions = {},
): UseBrowserPlateDetectionResult {
  const { enabled = true } = options;

  const [detections, setDetections] = useState<Detection[]>([]);
  const [fps, setFps] = useState(0);
  const [loading, setLoading] = useState(!browserPlateDetector.isReady);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<string | null>(browserPlateDetector.backend);

  const fpsCountRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (browserPlateDetector.isReady) {
      setLoading(false);
      setBackend(browserPlateDetector.backend);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    browserPlateDetector.init().then(() => {
      if (cancelled) return;
      setLoading(false);
      setBackend(browserPlateDetector.backend);
    }).catch((e) => {
      if (cancelled) return;
      setLoading(false);
      setError((e as Error).message);
      console.error('[BrowserPlate] Init failed:', e);
    });

    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, [enabled]);

  // Detection loop — uses setTimeout to NOT block the video render pipeline.
  // rAF callbacks block paint; setTimeout macrotasks let the browser paint between runs.
  useEffect(() => {
    if (!enabled || loading || error) return;

    let running = true;
    let lastPoster = '';
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      if (!running) return;

      if (document.hidden) {
        timerId = setTimeout(loop, 500);
        return;
      }

      const video = videoRef.current;
      if (!video) {
        timerId = setTimeout(loop, 200);
        return;
      }

      const hasVideoData = video.readyState >= 2 && video.videoWidth > 0;
      const poster = video.poster || '';
      const hasPoster = poster.startsWith('data:image') || poster.startsWith('blob:');
      const posterChanged = hasPoster && poster !== lastPoster;

      if (!hasVideoData && !posterChanged) {
        timerId = setTimeout(loop, 100);
        return;
      }

      try {
        let dets: Detection[] = [];
        if (hasVideoData) {
          dets = await browserPlateDetector.detect(video);
        } else if (posterChanged) {
          lastPoster = poster;
          if (poster.startsWith('data:image')) {
            const img = await loadImage(poster);
            if (img) {
              dets = await browserPlateDetector.detect(img);
            }
          }
        }
        if (running) {
          setDetections(dets);
          fpsCountRef.current++;
        }
      } catch {
        // transient error
      }

      // Yield 150ms to browser for video rendering (~9 video frames at 60fps).
      // Without this gap, ONNX inference (~50-100ms) would hog the main thread.
      if (running) {
        timerId = setTimeout(loop, 150);
      }
    };

    timerId = setTimeout(loop, 0);

    return () => {
      running = false;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [enabled, loading, error, videoRef]);

  return { detections, fps, backend, loading, error };
}
