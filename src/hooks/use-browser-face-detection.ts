'use client';

import { useState, useEffect, useRef } from 'react';
import type { Detection } from '@/components/detection-overlay';
import { browserFaceDetector } from '@/lib/browser-face-detector';

interface UseBrowserFaceDetectionOptions {
  enabled?: boolean;
}

interface UseBrowserFaceDetectionResult {
  detections: Detection[];
  fps: number;
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
 * Hook that runs face detection in the browser via ONNX UltraFace model.
 * WebGPU → WASM fallback — works on Linux/Mac/Windows.
 * Supports both WebRTC (video.readyState >= 2) and MJPEG (poster data URL) modes.
 */
export function useBrowserFaceDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseBrowserFaceDetectionOptions = {},
): UseBrowserFaceDetectionResult {
  const { enabled = true } = options;

  const [detections, setDetections] = useState<Detection[]>([]);
  const [fps, setFps] = useState(0);
  const [loading, setLoading] = useState(!browserFaceDetector.isReady);
  const [error, setError] = useState<string | null>(null);

  const fpsCountRef = useRef(0);

  // Init model
  useEffect(() => {
    if (!enabled) return;
    if (browserFaceDetector.isReady) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    browserFaceDetector.init().then(() => {
      if (cancelled) return;
      setLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      setLoading(false);
      setError((e as Error).message);
      console.error('[BrowserFace] Init failed:', e);
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

  // Detection loop — runs as fast as model allows, no FPS cap
  // Supports WebRTC (video data) and MJPEG (poster/blob) modes
  useEffect(() => {
    if (!enabled || loading || error) return;

    let running = true;
    let detecting = false;
    let lastPoster = '';

    const loop = () => {
      if (!running) return;

      if (detecting || document.hidden) {
        requestAnimationFrame(loop);
        return;
      }

      const video = videoRef.current;
      if (!video) {
        requestAnimationFrame(loop);
        return;
      }

      const hasVideoData = video.readyState >= 2 && video.videoWidth > 0;
      const poster = video.poster || '';
      const hasPoster = poster.startsWith('data:image') || poster.startsWith('blob:');
      const posterChanged = hasPoster && poster !== lastPoster;

      if (!hasVideoData && !posterChanged) {
        requestAnimationFrame(loop);
        return;
      }

      detecting = true;

      const runDetection = async () => {
        try {
          let dets: Detection[] = [];
          if (hasVideoData) {
            dets = await browserFaceDetector.detect(video);
          } else if (posterChanged) {
            lastPoster = poster;
            if (poster.startsWith('data:image')) {
              const img = await loadImage(poster);
              if (img) {
                dets = await browserFaceDetector.detect(img);
              }
            }
          }
          if (running) {
            setDetections(dets);
            fpsCountRef.current++;
          }
        } catch {
          // Ignore transient detection errors
        }
        detecting = false;
        if (running) requestAnimationFrame(loop);
      };

      runDetection();
    };

    requestAnimationFrame(loop);

    return () => { running = false; };
  }, [enabled, loading, error, videoRef]);

  return { detections, fps, loading, error };
}
