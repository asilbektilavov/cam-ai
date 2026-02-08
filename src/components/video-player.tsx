'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { CameraOff, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  onError?: (error: string) => void;
  controls?: boolean;
  live?: boolean;
  playbackRate?: number;
  children?: React.ReactNode;
}

export function VideoPlayer({
  src,
  poster,
  autoPlay = true,
  muted = true,
  className,
  onError,
  controls = true,
  live = false,
  playbackRate = 1,
  children,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isBuffering, setIsBuffering] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const MAX_RETRIES = 5;
  const RETRY_DELAY = 3000;

  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const handleError = useCallback(
    (message: string) => {
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1;
        retryTimeoutRef.current = setTimeout(() => {
          initPlayer();
        }, RETRY_DELAY);
      } else {
        setHasError(true);
        setErrorMessage(message);
        setIsBuffering(false);
        onError?.(message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onError]
  );

  const initPlayer = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    cleanup();
    setHasError(false);
    setErrorMessage('');
    setIsBuffering(true);

    // Prefer hls.js when supported (Chrome/Firefox/Edge on all platforms)
    // Only fall back to native HLS for Safari/iOS where hls.js isn't supported
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: live,
        backBufferLength: live ? 0 : 30,
        xhrSetup: (xhr: XMLHttpRequest) => {
          xhr.withCredentials = true;
        },
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) {
          video.play().catch(() => {
            // Autoplay may be blocked by browser policy
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              handleError('Ошибка сети. Проверьте подключение.');
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              handleError('Не удалось воспроизвести поток.');
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS fallback (Safari / iOS)
      video.src = src;
      if (autoPlay) {
        video.play().catch(() => {});
      }
    } else {
      setHasError(true);
      setErrorMessage('HLS не поддерживается в этом браузере.');
      setIsBuffering(false);
      onError?.('HLS не поддерживается в этом браузере.');
    }
  }, [src, autoPlay, live, cleanup, handleError, onError]);

  useEffect(() => {
    retryCountRef.current = 0;
    initPlayer();
    return cleanup;
  }, [initPlayer, cleanup]);

  // Buffering state listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onVideoError = () => {
      handleError('Ошибка воспроизведения видео.');
    };

    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onVideoError);

    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onVideoError);
    };
  }, [handleError]);

  // Apply playback rate
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  // For live mode, always seek to the live edge
  useEffect(() => {
    if (!live) return;
    const video = videoRef.current;
    if (!video) return;

    const seekToLive = () => {
      if (video.duration && isFinite(video.duration)) {
        video.currentTime = video.duration;
      }
    };

    video.addEventListener('loadedmetadata', seekToLive);
    return () => video.removeEventListener('loadedmetadata', seekToLive);
  }, [live]);

  if (hasError) {
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-lg bg-gradient-to-br from-gray-800 to-gray-900',
          className
        )}
      >
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-center p-4">
          <CameraOff className="h-12 w-12 text-gray-500" />
          <p className="text-sm text-gray-400">{errorMessage || 'Камера недоступна'}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg bg-black',
        className
      )}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        poster={poster}
        muted={muted}
        controls={controls && !live}
        playsInline
        className="h-full w-full object-cover"
        style={live ? { pointerEvents: 'none' } : undefined}
      />

      {/* Overlay children (detection bounding boxes, etc.) — must be inside
          the video wrapper to render above the hardware-accelerated video layer */}
      {children}

      {/* Loading spinner */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      )}

      {/* LIVE badge */}
      {live && (
        <div className="absolute top-3 left-3 z-20">
          <Badge className="bg-red-600 text-white border-0 gap-1.5 px-2.5 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            LIVE
          </Badge>
        </div>
      )}

      {/* Dark gradient overlay at bottom for controls visibility */}
      {controls && (
        <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-black/60 to-transparent pointer-events-none z-10" />
      )}
    </div>
  );
}
