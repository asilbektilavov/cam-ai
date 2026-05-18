// One-camera test for the "1 RTSP session per camera" architecture.
//
// Visitor-counter cameras normally hold two go2rtc producers — `<id>` on the
// substream for browser preview and `<id>-main` on the main channel for the
// face detector. That's two open RTSP sessions against a camera whose
// substream pool only fits two clients total, so any third consumer (snapshot
// API, recorder retry, etc.) tips the camera into 454 lockup.
//
// When a camera ID is listed in `MAIN_STREAM_PRIMARY_IDS`, we drop the
// substream registration entirely and serve EVERYTHING (preview, attendance,
// recorder) off a single producer that holds the camera's main channel.
// One RTSP session, no contention.
const ENV = (process.env.MAIN_STREAM_PRIMARY_IDS || '').trim();
const IDS = new Set(
  ENV.split(',').map((s) => s.trim()).filter(Boolean)
);

export function isMainStreamPrimary(cameraId: string): boolean {
  return IDS.has(cameraId);
}

export function getMainStreamPrimaryIds(): string[] {
  return Array.from(IDS);
}
