'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const GO2RTC_URL = process.env.NEXT_PUBLIC_GO2RTC_URL || 'http://localhost:1984';

interface Go2rtcPlayerProps {
  streamName: string;
  className?: string;
  /** Camera stream protocol. RTSP → WebRTC (sub-500ms), HTTP → MJPEG proxy. */
  protocol?: 'rtsp' | 'http';
}

/**
 * Low-latency video player powered by go2rtc.
 * Checks stream availability before showing the iframe.
 * Shows a "Connecting..." overlay while the stream is not ready.
 */
export function Go2rtcPlayer({
  streamName,
  className = '',
  protocol = 'rtsp',
}: Go2rtcPlayerProps) {
  const [streamReady, setStreamReady] = useState(false);
  const [go2rtcDown, setGo2rtcDown] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const checkStream = useCallback(async () => {
    try {
      const res = await fetch(`${GO2RTC_URL}/api/streams?src=${encodeURIComponent(streamName)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await res.json();
        // With ?src= go2rtc returns the stream object directly: { producers: [...] }
        if (data && data.producers) {
          setStreamReady(true);
          setGo2rtcDown(false);
          return;
        }
      }
      // Stream not registered yet — retry
      setStreamReady(false);
      setGo2rtcDown(false);
      retryRef.current = setTimeout(checkStream, 2000);
    } catch {
      if (!mountedRef.current) return;
      setStreamReady(false);
      setGo2rtcDown(true);
      retryRef.current = setTimeout(checkStream, 3000);
    }
  }, [streamName]);

  useEffect(() => {
    mountedRef.current = true;
    setStreamReady(false);
    setGo2rtcDown(false);
    checkStream();
    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [checkStream]);

  // RTSP: full codec negotiation chain (webrtc → mse → mp4 → mjpeg)
  // HTTP: MJPEG only (go2rtc proxies the MJPEG stream, no transcoding)
  const mode = protocol === 'http' ? 'mjpeg' : 'webrtc,mse,mp4,mjpeg';

  if (!streamReady) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 24,
              height: 24,
              border: '2px solid rgba(255,255,255,0.2)',
              borderTopColor: 'rgba(255,255,255,0.8)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 8px',
            }}
          />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
            {go2rtcDown ? 'go2rtc недоступен...' : 'Подключение к камере...'}
          </span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={`${GO2RTC_URL}/stream.html?src=${encodeURIComponent(streamName)}&mode=${mode}`}
      className={className}
      style={{
        border: 'none',
        outline: 'none',
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
      }}
      allow="autoplay"
      title="Camera Stream"
    />
  );
}
