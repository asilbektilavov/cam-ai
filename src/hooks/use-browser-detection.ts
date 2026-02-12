'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Detection } from '@/components/detection-overlay';
import { browserYolo } from '@/lib/browser-yolo';

interface UseBrowserDetectionOptions {
  enabled?: boolean;
  enabledClasses?: Set<string>;
  targetFps?: number;
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
 */
export function useBrowserDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseBrowserDetectionOptions = {},
): UseBrowserDetectionResult {
  const { enabled = true, enabledClasses, targetFps = 10 } = options;

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

  // Detection loop — runs as long as enabled && model ready
  useEffect(() => {
    if (!enabled || loading || error) return;

    let running = true;
    let lastRunTime = 0;
    const minInterval = 1000 / targetFps;
    let detecting = false;
    let lastPoster = '';

    const loop = async () => {
      if (!running) return;

      const now = performance.now();
      if (now - lastRunTime < minInterval || detecting) {
        requestAnimationFrame(loop);
        return;
      }

      if (document.hidden) {
        requestAnimationFrame(loop);
        return;
      }

      const video = videoRef.current;
      if (!video) {
        requestAnimationFrame(loop);
        return;
      }

      detecting = true;
      lastRunTime = now;

      try {
        let dets: Detection[] = [];
        const hasVideoData = video.readyState >= 2 && video.videoWidth > 0;
        const hasPoster = !!(video.poster && video.poster.startsWith('data:image'));
        const posterChanged = hasPoster && video.poster !== lastPoster;

        if (hasVideoData) {
          dets = await browserYolo.detect(video, enabledClassesRef.current);
        } else if (hasPoster && posterChanged) {
          lastPoster = video.poster;
          const img = await loadImage(video.poster);
          if (img) {
            dets = await browserYolo.detect(img, enabledClassesRef.current);
          }
        } else {
          // No video data and no new poster — skip
          detecting = false;
          if (running) requestAnimationFrame(loop);
          return;
        }

        if (running) {
          setDetections(dets);
          fpsCountRef.current++;
        }
      } catch (e) {
        console.warn('[BrowserDetection] Detection error:', e);
      }

      detecting = false;

      if (running) {
        requestAnimationFrame(loop);
      }
    };

    requestAnimationFrame(loop);

    return () => {
      running = false;
    };
  }, [enabled, loading, error, targetFps, videoRef]);

  return { detections, fps, backend, loading, error };
}
