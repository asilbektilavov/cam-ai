'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

// Face descriptor matching types
interface TrackedFace {
  id: number;
  descriptor: Float32Array;
  lastSeen: number;
}

// Search descriptor from person search feature
export interface SearchDescriptor {
  id: string;
  name: string;
  descriptor: number[];
}

// Global face registry (persists across component instances within the session)
const faceRegistry: TrackedFace[] = [];
let nextFaceId = 1;

const MATCH_THRESHOLD = 0.6;
const SEARCH_MATCH_THRESHOLD = 0.5; // Stricter for person search
const FACE_EXPIRY_MS = 30000; // Remove faces not seen for 30s

function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function euclideanDistanceMixed(a: Float32Array, b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function matchOrCreateFace(descriptor: Float32Array): number {
  const now = Date.now();

  // Clean expired faces
  for (let i = faceRegistry.length - 1; i >= 0; i--) {
    if (now - faceRegistry[i].lastSeen > FACE_EXPIRY_MS) {
      faceRegistry.splice(i, 1);
    }
  }

  // Find best match
  let bestMatch: TrackedFace | null = null;
  let bestDistance = Infinity;

  for (const face of faceRegistry) {
    const dist = euclideanDistance(descriptor, face.descriptor);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = face;
    }
  }

  if (bestMatch && bestDistance < MATCH_THRESHOLD) {
    bestMatch.lastSeen = now;
    bestMatch.descriptor = descriptor; // Update descriptor
    return bestMatch.id;
  }

  // New face
  const id = nextFaceId++;
  faceRegistry.push({ id, descriptor, lastSeen: now });
  return id;
}

// Debounce sighting reports: once per person per camera per 60s
const sightingDebounce = new Map<string, number>();
const SIGHTING_DEBOUNCE_MS = 60000;

interface CameraFeedProps {
  cameraId: string;
  snapshotTick: number;
  className?: string;
  showFaceDetection?: boolean;
  rotateImage?: boolean; // true for IP Webcam (upside down), false for RTSP
  onMotionDetected?: (detected: boolean) => void;
  onFacesDetected?: (count: number) => void;
  searchDescriptors?: SearchDescriptor[];
}

// Lazy-load face-api
let faceApiPromise: Promise<typeof import('@vladmandic/face-api')> | null = null;
let faceApiLoaded = false;
let faceApiLoading = false;

async function loadFaceApi() {
  if (faceApiLoaded) return (await faceApiPromise)!;
  if (faceApiLoading) return faceApiPromise!;

  faceApiLoading = true;
  faceApiPromise = (async () => {
    const faceapi = await import('@vladmandic/face-api');

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]);

    faceApiLoaded = true;
    return faceapi;
  })();

  return faceApiPromise;
}

function findSearchMatch(
  descriptor: Float32Array,
  searchDescriptors: SearchDescriptor[]
): { person: SearchDescriptor; distance: number } | null {
  let bestMatch: SearchDescriptor | null = null;
  let bestDistance = Infinity;

  for (const sd of searchDescriptors) {
    const dist = euclideanDistanceMixed(descriptor, sd.descriptor);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = sd;
    }
  }

  if (bestMatch && bestDistance < SEARCH_MATCH_THRESHOLD) {
    return { person: bestMatch, distance: bestDistance };
  }
  return null;
}

async function reportSighting(
  personId: string,
  cameraId: string,
  confidence: number
) {
  const key = `${personId}:${cameraId}`;
  const now = Date.now();
  const lastReport = sightingDebounce.get(key);
  if (lastReport && now - lastReport < SIGHTING_DEBOUNCE_MS) return;

  sightingDebounce.set(key, now);

  try {
    await fetch(`/api/person-search/${personId}/sightings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameraId, confidence }),
    });
  } catch {
    // Silent fail — sighting reports are best-effort
  }
}

export function CameraFeed({
  cameraId,
  snapshotTick,
  className = '',
  showFaceDetection = true,
  rotateImage = false,
  onFacesDetected,
  searchDescriptors,
}: CameraFeedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [matchedNames, setMatchedNames] = useState<string[]>([]);
  const [faceApiReady, setFaceApiReady] = useState(faceApiLoaded);
  const lastTickRef = useRef(-1);
  const searchDescriptorsRef = useRef(searchDescriptors);
  searchDescriptorsRef.current = searchDescriptors;

  // Load face-api on mount
  useEffect(() => {
    if (showFaceDetection && !faceApiLoaded) {
      loadFaceApi().then(() => setFaceApiReady(true)).catch(console.error);
    }
  }, [showFaceDetection]);

  const processFrame = useCallback(async () => {
    if (!canvasRef.current || isProcessing || lastTickRef.current === snapshotTick) return;
    lastTickRef.current = snapshotTick;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsProcessing(true);

    try {
      // Load snapshot image
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load snapshot'));
        img.src = `/api/cameras/${cameraId}/snapshot?t=${snapshotTick}`;
      });

      // Set canvas size to match container
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      // Draw image (optionally rotated for IP Webcam)
      if (rotateImage) {
        ctx.save();
        ctx.translate(canvas.width, canvas.height);
        ctx.rotate(Math.PI);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }

      // Run face detection if available
      if (showFaceDetection && faceApiReady) {
        const faceapi = await loadFaceApi();

        const detections = await faceapi
          .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
          .withFaceLandmarks(true)
          .withFaceDescriptors();

        const count = detections.length;
        setFaceCount(count);
        onFacesDetected?.(count);

        const currentSearchDescs = searchDescriptorsRef.current;
        const foundNames: string[] = [];

        // Draw face rectangles
        for (const detection of detections) {
          const { x, y, width, height } = detection.detection.box;

          // Check against search descriptors first
          let isSearchMatch = false;
          let matchName = '';

          if (currentSearchDescs && currentSearchDescs.length > 0) {
            const match = findSearchMatch(detection.descriptor, currentSearchDescs);
            if (match) {
              isSearchMatch = true;
              matchName = match.person.name;
              foundNames.push(matchName);
              const confidence = 1 - match.distance;
              // Report sighting (debounced)
              void reportSighting(match.person.id, cameraId, confidence);
            }
          }

          if (isSearchMatch) {
            // RED rectangle for search match
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, width, height);

            // Name label
            const label = matchName;
            ctx.font = 'bold 14px monospace';
            const textWidth = ctx.measureText(label).width;
            const labelHeight = 22;
            const labelY = y - labelHeight - 2;

            ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
            ctx.fillRect(x, labelY > 0 ? labelY : y, textWidth + 10, labelHeight);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, x + 5, (labelY > 0 ? labelY : y) + 16);

            // Pulsing border effect
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
            ctx.lineWidth = 6;
            ctx.strokeRect(x - 3, y - 3, width + 6, height + 6);
          } else {
            // Green rectangle for regular face
            const faceId = matchOrCreateFace(detection.descriptor);

            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);

            // ID label background
            const label = `ID: ${faceId}`;
            ctx.font = 'bold 12px monospace';
            const textWidth = ctx.measureText(label).width;
            const labelHeight = 18;
            const labelY = y - labelHeight - 2;

            ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
            ctx.fillRect(x, labelY > 0 ? labelY : y, textWidth + 8, labelHeight);

            // ID text
            ctx.fillStyle = '#000000';
            ctx.fillText(label, x + 4, (labelY > 0 ? labelY : y) + 13);

            // Confidence score
            const score = `${Math.round(detection.detection.score * 100)}%`;
            ctx.font = '10px monospace';
            ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
            const scoreWidth = ctx.measureText(score).width;
            ctx.fillRect(x + width - scoreWidth - 6, y + height - 16, scoreWidth + 6, 16);
            ctx.fillStyle = '#000000';
            ctx.fillText(score, x + width - scoreWidth - 3, y + height - 4);
          }
        }

        setMatchedNames(foundNames);
      }
    } catch {
      // If image fails to load, draw fallback
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    } finally {
      setIsProcessing(false);
    }
  }, [cameraId, snapshotTick, isProcessing, showFaceDetection, faceApiReady, onFacesDetected]);

  useEffect(() => {
    processFrame();
  }, [processFrame]);

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'auto' }}
      />
      {/* Search match alert */}
      {matchedNames.length > 0 && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 z-10 animate-pulse">
          <span className="text-[10px] font-bold text-white">
            {matchedNames.join(', ')}
          </span>
        </div>
      )}
      {/* Face count overlay */}
      {showFaceDetection && faceCount > 0 && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-green-500/80 px-2 py-0.5 z-10">
          <span className="text-[10px] font-bold text-white">
            {faceCount} {faceCount === 1 ? 'лицо' : faceCount < 5 ? 'лица' : 'лиц'}
          </span>
        </div>
      )}
      {/* Loading indicator for face-api */}
      {showFaceDetection && !faceApiReady && (
        <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-yellow-500/60 px-2 py-0.5 z-10">
          <span className="text-[10px] text-white">AI загрузка...</span>
        </div>
      )}
    </div>
  );
}
