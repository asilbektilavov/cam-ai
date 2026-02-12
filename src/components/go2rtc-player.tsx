'use client';

const GO2RTC_URL = process.env.NEXT_PUBLIC_GO2RTC_URL || 'http://localhost:1984';

interface Go2rtcPlayerProps {
  streamName: string;
  className?: string;
  /** Camera stream protocol. RTSP → WebRTC (sub-500ms), HTTP → MJPEG proxy. */
  protocol?: 'rtsp' | 'http';
}

/**
 * Low-latency video player powered by go2rtc.
 * RTSP cameras: WebRTC/MSE (sub-500ms latency, no transcoding).
 * HTTP cameras: MJPEG proxy (avoids ffmpeg transcoding issues).
 */
export function Go2rtcPlayer({
  streamName,
  className = '',
  protocol = 'rtsp',
}: Go2rtcPlayerProps) {
  // RTSP: full codec negotiation chain (webrtc → mse → mp4 → mjpeg)
  // HTTP: MJPEG only (go2rtc proxies the MJPEG stream, no transcoding)
  const mode = protocol === 'http' ? 'mjpeg' : 'webrtc,mse,mp4,mjpeg';

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
