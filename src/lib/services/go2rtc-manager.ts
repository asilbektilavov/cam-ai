/**
 * go2rtc Manager — manages camera streams in the go2rtc sidecar process.
 * go2rtc provides WebRTC/MSE/MJPEG streaming with sub-500ms latency
 * by forwarding H.264/H.265 directly without transcoding.
 */

const GO2RTC_API = process.env.GO2RTC_API_URL || 'http://localhost:1984';

class Go2rtcManager {
  private static instance: Go2rtcManager;
  private available: boolean | null = null;

  static getInstance(): Go2rtcManager {
    if (!Go2rtcManager.instance) {
      Go2rtcManager.instance = new Go2rtcManager();
    }
    return Go2rtcManager.instance;
  }

  /**
   * Check if go2rtc is running and accessible
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const res = await fetch(`${GO2RTC_API}/api`, {
        signal: AbortSignal.timeout(2000),
      });
      this.available = res.ok;
      if (this.available) {
        console.log('[go2rtc] Service available at', GO2RTC_API);
      }
      return this.available;
    } catch {
      this.available = false;
      console.log('[go2rtc] Service not available at', GO2RTC_API);
      return false;
    }
  }

  /**
   * Add a camera stream to go2rtc.
   * Stream name is the camera ID for easy lookup.
   * For RTSP: passed directly (no transcoding, native H.264/H.265 → WebRTC).
   * For HTTP MJPEG (IP Webcam, etc.): registered as direct MJPEG URL.
   *   go2rtc proxies the MJPEG stream; browser uses MJPEG mode (no transcoding needed).
   */
  async addStream(cameraId: string, streamUrl: string): Promise<boolean> {
    try {
      if (!(await this.isAvailable())) return false;

      let go2rtcSrc = streamUrl;
      // Force TCP transport for RTSP streams (more reliable, avoids UDP issues)
      if (streamUrl.toLowerCase().startsWith('rtsp://') && !streamUrl.includes('#')) {
        go2rtcSrc = streamUrl + '#transport=tcp';
      }
      if (!streamUrl.toLowerCase().startsWith('rtsp://')) {
        // Ensure we point to the MJPEG stream endpoint, not the base URL
        let mjpegUrl = streamUrl.replace(/\/$/, '');
        if (!/\/(video|mjpegfeed|videostream\.cgi|h264)/i.test(mjpegUrl)) {
          mjpegUrl += '/video';
        }
        go2rtcSrc = mjpegUrl;
        console.log(`[go2rtc] HTTP camera detected, registering MJPEG source: ${go2rtcSrc}`);
      }

      const res = await fetch(
        `${GO2RTC_API}/api/streams?name=${encodeURIComponent(cameraId)}&src=${encodeURIComponent(go2rtcSrc)}`,
        { method: 'PUT', signal: AbortSignal.timeout(5000) }
      );

      if (res.ok) {
        console.log(`[go2rtc] Stream added: ${cameraId}`);
        return true;
      }

      console.error(`[go2rtc] Failed to add stream ${cameraId}: ${res.status}`);
      return false;
    } catch (err) {
      console.error(`[go2rtc] Error adding stream ${cameraId}:`, err);
      return false;
    }
  }

  /**
   * Remove a camera stream from go2rtc.
   */
  async removeStream(cameraId: string): Promise<boolean> {
    try {
      if (!(await this.isAvailable())) return false;

      const res = await fetch(
        `${GO2RTC_API}/api/streams?name=${encodeURIComponent(cameraId)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(5000) }
      );

      if (res.ok) {
        console.log(`[go2rtc] Stream removed: ${cameraId}`);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get a JPEG snapshot from go2rtc (uses the camera's native codec, decoded by go2rtc).
   */
  async getSnapshot(cameraId: string): Promise<Buffer | null> {
    try {
      if (!(await this.isAvailable())) return null;

      const res = await fetch(
        `${GO2RTC_API}/api/frame.jpeg?src=${encodeURIComponent(cameraId)}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /**
   * List all active streams
   */
  async listStreams(): Promise<Record<string, unknown>> {
    try {
      if (!(await this.isAvailable())) return {};

      const res = await fetch(`${GO2RTC_API}/api/streams`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  /** Reset availability cache (e.g., after go2rtc restart) */
  resetCache(): void {
    this.available = null;
  }
}

const globalForGo2rtc = globalThis as unknown as {
  go2rtcManager: Go2rtcManager | undefined;
};

export const go2rtcManager =
  globalForGo2rtc.go2rtcManager ?? Go2rtcManager.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForGo2rtc.go2rtcManager = go2rtcManager;
