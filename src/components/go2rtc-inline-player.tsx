'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const GO2RTC_URL = process.env.NEXT_PUBLIC_GO2RTC_URL || 'http://localhost:1984';

interface Go2rtcInlinePlayerProps {
  streamName: string;
  className?: string;
  protocol?: 'rtsp' | 'http';
  /** Callback to expose the inner HTMLVideoElement for frame capture */
  onVideoRef?: (video: HTMLVideoElement | null) => void;
}

interface VideoRtcElement extends HTMLElement {
  src: string;
  mode: string;
  background: boolean;
  video: HTMLVideoElement | null;
  wsURL?: string;
  wsState?: number;
}

/**
 * Inline go2rtc player using <video-rtc> custom element directly in the page.
 * Unlike the iframe-based Go2rtcPlayer, this gives direct access to video pixels
 * for browser-side AI detection.
 */
export function Go2rtcInlinePlayer({
  streamName,
  className = '',
  protocol = 'rtsp',
  onVideoRef,
}: Go2rtcInlinePlayerProps) {
  const [streamReady, setStreamReady] = useState(false);
  const [go2rtcDown, setGo2rtcDown] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(
    typeof window !== 'undefined' && !!(window as Record<string, unknown>).__videoRtcReady
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRtcRef = useRef<VideoRtcElement | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onVideoRefRef = useRef(onVideoRef);
  onVideoRefRef.current = onVideoRef;

  // Load video-rtc.js script once
  useEffect(() => {
    if ((window as Record<string, unknown>).__videoRtcReady) {
      setScriptLoaded(true);
      return;
    }

    const id = 'video-rtc-script';
    if (!document.getElementById(id)) {
      const script = document.createElement('script');
      script.id = id;
      script.type = 'module';
      script.textContent = `
        import { VideoRTC } from '/video-rtc.js';
        if (!customElements.get('video-rtc')) {
          customElements.define('video-rtc', VideoRTC);
        }
        window.__videoRtcReady = true;
        window.dispatchEvent(new Event('video-rtc-ready'));
      `;
      document.head.appendChild(script);
    }

    const onReady = () => setScriptLoaded(true);
    window.addEventListener('video-rtc-ready', onReady, { once: true });

    return () => {
      window.removeEventListener('video-rtc-ready', onReady);
    };
  }, []);

  // Check stream availability
  const checkStream = useCallback(async () => {
    try {
      const res = await fetch(
        `${GO2RTC_URL}/api/streams?src=${encodeURIComponent(streamName)}`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (data && data.producers) {
          setStreamReady(true);
          setGo2rtcDown(false);
          return;
        }
      }
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

  // Create and manage <video-rtc> element
  useEffect(() => {
    if (!streamReady || !scriptLoaded || !containerRef.current) return;

    const container = containerRef.current;
    const mode = protocol === 'http' ? 'mjpeg' : 'webrtc,mse,mp4,mjpeg';
    const wsUrl = `${GO2RTC_URL}/api/ws?src=${encodeURIComponent(streamName)}&mode=${mode}`;

    // Clear any leftover elements
    container.innerHTML = '';

    // Create <video-rtc> element
    const el = document.createElement('video-rtc') as VideoRtcElement;
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.display = 'block';
    el.background = false;

    // Append to DOM first (triggers connectedCallback → oninit → creates video)
    container.appendChild(el);
    videoRtcRef.current = el;

    // Set mode AFTER appendChild (overrides constructor default after upgrade)
    el.mode = mode;

    // Set src (triggers WebSocket connection)
    el.src = wsUrl;

    // Poll for video element creation and expose it
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      pollCount++;
      if (el.video) {
        clearInterval(pollInterval);
        el.video.style.objectFit = 'contain';
        el.video.controls = false;
        onVideoRefRef.current?.(el.video);
      }
      if (pollCount > 50) {
        clearInterval(pollInterval);
        console.warn('[Go2rtcInline] Video element not found after 5s');
      }
    }, 100);

    // Health check: if ws dies and doesn't reconnect, re-set src
    const healthInterval = setInterval(() => {
      if (!el.isConnected) return;
      // wsState 3 = CLOSED, and no wsURL means it never connected
      if (el.wsState === 3 && !el.wsURL) {
        el.mode = mode;
        el.src = wsUrl;
      }
    }, 5000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(healthInterval);
      onVideoRefRef.current?.(null);
      if (videoRtcRef.current && videoRtcRef.current.isConnected) {
        container.removeChild(videoRtcRef.current);
      }
      videoRtcRef.current = null;
    };
  }, [streamReady, scriptLoaded, streamName, protocol]);

  if (!streamReady || !scriptLoaded) {
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
    <div
      ref={containerRef}
      className={className}
      style={{
        backgroundColor: '#000',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
}
