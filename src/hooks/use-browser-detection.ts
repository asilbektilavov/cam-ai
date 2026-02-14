'use client';

import { useState, useEffect, useRef } from 'react';
import type { Detection } from '@/components/detection-overlay';
import { browserYolo } from '@/lib/browser-yolo';

interface UseBrowserDetectionOptions {
  enabled?: boolean;
  enabledClasses?: Set<string>;
}

interface UseBrowserDetectionResult {
  detections: Detection[];
  fps: number;
  backend: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load an Image from a data URL. Returns null on failure.
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Hook that runs YOLOv8n in the browser via ONNX Runtime Web.
 * Supports both WebRTC (video.readyState >= 2) and MJPEG (poster data URL) modes.
 *
 * Uses setTimeout instead of requestAnimationFrame to avoid blocking
 * the browser's paint/render pipeline. ONNX inference on the 12MB YOLOv8n
 * model takes ~50-100ms which would cause video frame drops inside rAF.
 */
export function useBrowserDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseBrowserDetectionOptions = {},
): UseBrowserDetectionResult {
  const { enabled = true, enabledClasses } = options;

  const [detections, setDetections] = useState<Detection[]>([]);
  const [fps, setFps] = useState(0);
  const [loading, setLoading] = useState(!browserYolo.isReady);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<string | null>(browserYolo.backend);

  const fpsCountRef = useRef(0);
  const enabledClassesRef = useRef(enabledClasses);
  enabledClassesRef.current = enabledClasses;

  // Init model on mount — skip loading flicker if already ready
  useEffect(() => {
    if (!enabled) return;
    if (browserYolo.isReady) {
      setLoading(false);
      setBackend(browserYolo.backend);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    browserYolo.init().then(() => {
      if (cancelled) return;
      setLoading(false);
      setBackend(browserYolo.backend);
      console.log(`[BrowserDetection] Ready (${browserYolo.backend})`);
    }).catch((e) => {
      if (cancelled) return;
      setLoading(false);
      setError((e as Error).message);
      console.error('[BrowserDetection] Init failed:', e);
    });

    return () => { cancelled = true; };
  }, [enabled]);

  // FPS counter
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
      const hasPoster = !!(video.poster && video.poster.startsWith('data:image'));
      const posterChanged = hasPoster && video.poster !== lastPoster;

      if (!hasVideoData && !posterChanged) {
        timerId = setTimeout(loop, 100);
        return;
      }

      try {
        let dets: Detection[] = [];
        if (hasVideoData) {
          dets = await browserYolo.detect(video, enabledClassesRef.current);
        } else if (hasPoster && posterChanged) {
          lastPoster = video.poster;
          const img = await loadImage(video.poster);
          if (img) {
            dets = await browserYolo.detect(img, enabledClassesRef.current);
          }
        } else {
          timerId = setTimeout(loop, 100);
          return;
        }

        if (running) {
          setDetections(dets);
          fpsCountRef.current++;
        }
      } catch (e) {
        console.warn('[BrowserDetection] Detection error:', e);
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
