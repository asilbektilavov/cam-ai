'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { VideoPlayer } from '@/components/video-player';
import { DetectionOverlay, Detection } from '@/components/detection-overlay';
import { useEventStream } from '@/hooks/use-event-stream';

interface DetectionVideoPlayerProps {
  src: string;
  cameraId: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  onError?: (error: string) => void;
  controls?: boolean;
  live?: boolean;
  playbackRate?: number;
  showDetections?: boolean;
}

const DETECTION_TTL_MS = 3_000; // detections disappear after 3s (stay fresh)

export function DetectionVideoPlayer({
  src,
  cameraId,
  poster,
  autoPlay = true,
  muted = true,
  className,
  onError,
  controls = true,
  live = false,
  playbackRate = 1,
  showDetections: initialShow = true,
}: DetectionVideoPlayerProps) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [visible, setVisible] = useState(initialShow);
  const [showLegend, setShowLegend] = useState(false);
  const [detFps, setDetFps] = useState(0);
  const lastUpdateRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fpsCountRef = useRef(0);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // FPS counter — updates every second
  useEffect(() => {
    fpsTimerRef.current = setInterval(() => {
      setDetFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);
    return () => {
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
    };
  }, []);

  // SSE subscription for live detections
  useEventStream(
    useCallback(
      (event) => {
        if (
          event.type === 'frame_analyzed' &&
          event.cameraId === cameraId &&
          Array.isArray(event.data.detections)
        ) {
          const newDetections = event.data.detections as Detection[];
          fpsCountRef.current++;

          // Only update boxes when we have actual detections.
          // Empty detections are handled by TTL expiry (avoids flickering).
          if (newDetections.length > 0) {
            setDetections(newDetections);
            lastUpdateRef.current = Date.now();

            // Reset TTL — boxes disappear after DETECTION_TTL_MS of no new detections
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              setDetections([]);
            }, DETECTION_TTL_MS);
          }
        }
      },
      [cameraId]
    )
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const objectCount = detections.length;
  const personCount = detections.filter((d) => d.type === 'person').length;

  // Unique detection types for legend
  const detectionTypes = [...new Map(
    detections.map((d) => [d.type, { label: d.label, color: d.color }])
  ).values()];

  return (
    <div className={cn('relative', className)}>
      {/* Video Player — DetectionOverlay is passed as child so it renders
          INSIDE the video wrapper (same stacking context as the HW-accelerated video) */}
      <VideoPlayer
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        muted={muted}
        controls={controls}
        live={live}
        playbackRate={playbackRate}
        className="h-full w-full"
        onError={onError}
      >
        <DetectionOverlay detections={detections} visible={visible} />
      </VideoPlayer>

      {/* AI status indicator — bottom left */}
      {visible && detFps > 0 && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className="bg-black/60 text-green-400 border-0 text-[10px] px-1.5 py-0.5 gap-1"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
            </span>
            AI {detFps} fps
          </Badge>
        </div>
      )}

      {/* Detection count + toggle — top right */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {objectCount > 0 && visible && (
          <Badge
            variant="secondary"
            className="bg-black/60 text-white border-0 text-[10px] px-1.5 py-0.5"
          >
            {personCount > 0 && `${personCount} чел.`}
            {personCount > 0 && objectCount > personCount && ' / '}
            {objectCount > personCount && `${objectCount - personCount} объект.`}
            {objectCount === 0 && personCount === 0 && '0'}
          </Badge>
        )}
        <div
          className="relative"
          onMouseEnter={() => setShowLegend(true)}
          onMouseLeave={() => setShowLegend(false)}
        >
          <button
            onClick={() => setVisible((v) => !v)}
            className={cn(
              'flex items-center justify-center h-7 w-7 rounded-full transition-colors',
              visible
                ? 'bg-blue-500/80 text-white hover:bg-blue-500'
                : 'bg-black/50 text-gray-300 hover:bg-black/70'
            )}
          >
            {visible ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Legend popup */}
          {showLegend && detectionTypes.length > 0 && (
            <div className="absolute top-full right-0 mt-1 bg-black/80 rounded-lg p-2 min-w-[140px] backdrop-blur-sm">
              <p className="text-[10px] text-gray-400 mb-1.5">Детекция</p>
              {detectionTypes.map((dt) => (
                <div
                  key={dt.label}
                  className="flex items-center gap-2 py-0.5"
                >
                  <div
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: dt.color }}
                  />
                  <span className="text-[11px] text-white">{dt.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
