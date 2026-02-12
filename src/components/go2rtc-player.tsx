'use client';

const GO2RTC_URL = process.env.NEXT_PUBLIC_GO2RTC_URL || 'http://localhost:1984';

interface Go2rtcPlayerProps {
  streamName: string;
  className?: string;
}

/**
 * Low-latency video player powered by go2rtc.
 * Uses iframe embedding go2rtc's built-in WebRTC player.
 * Sub-500ms latency, no transcoding.
 */
export function Go2rtcPlayer({
  streamName,
  className = '',
}: Go2rtcPlayerProps) {
  return (
    <iframe
      src={`${GO2RTC_URL}/stream.html?src=${encodeURIComponent(streamName)}&mode=webrtc,mse,mp4,mjpeg`}
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
