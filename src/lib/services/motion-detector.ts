import sharp from 'sharp';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

const COMPARE_SIZE = 64;
const STREAMS_DIR = path.join(process.cwd(), 'data', 'streams');

/**
 * Compare two JPEG buffers by converting to small grayscale images
 * and computing average pixel difference percentage.
 * Returns 0-100 (percentage of change).
 */
export async function compareFrames(
  frame1: Buffer,
  frame2: Buffer
): Promise<number> {
  const [pixels1, pixels2] = await Promise.all([
    sharp(frame1)
      .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer(),
    sharp(frame2)
      .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer(),
  ]);

  let totalDiff = 0;
  const pixelCount = COMPARE_SIZE * COMPARE_SIZE;

  for (let i = 0; i < pixelCount; i++) {
    totalDiff += Math.abs(pixels1[i] - pixels2[i]);
  }

  // Normalize to 0-100 percentage
  return (totalDiff / (pixelCount * 255)) * 100;
}

function isRtsp(url: string): boolean {
  return url.toLowerCase().startsWith('rtsp://');
}

function isHls(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.endsWith('.m3u8');
  } catch {
    return false;
  }
}

function isIpWebcam(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && !u.pathname.match(/\.(jpg|jpeg|png|cgi|bmp|m3u8)$/i) && !u.pathname.includes('/onvif');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistent RTSP Frame Grabber
// One ffmpeg process per camera URL. Continuously decodes RTSP and keeps
// the latest JPEG frame in memory. No per-frame process spawn overhead.
// ---------------------------------------------------------------------------

const JPEG_SOI = Buffer.from([0xff, 0xd8]); // Start Of Image marker
const JPEG_EOI = Buffer.from([0xff, 0xd9]); // End Of Image marker

interface RtspGrabber {
  process: ChildProcess;
  frame: Buffer | null;
  updatedAt: number;
  refCount: number;
  url: string;
}

const grabbers = new Map<string, RtspGrabber>();

/**
 * Derive the MJPEG stream endpoint for IP Webcam / HTTP cameras.
 * IP Webcam app serves MJPEG at /video, snapshots at /shot.jpg.
 */
function getHttpStreamUrl(baseUrl: string): string {
  const url = baseUrl.replace(/\/$/, '');
  // Already has a stream endpoint
  if (/\/(video|mjpegfeed|videostream\.cgi)/i.test(url)) return url;
  // Looks like a snapshot endpoint — convert to stream
  if (/\/shot\.jpe?g$/i.test(url)) return url.replace(/\/shot\.jpe?g$/i, '/video');
  // Base URL — append /video (IP Webcam default)
  return url + '/video';
}

function startGrabber(streamUrl: string): RtspGrabber {
  const existing = grabbers.get(streamUrl);
  if (existing && existing.process.exitCode === null) {
    existing.refCount++;
    return existing;
  }

  // Build ffmpeg args depending on protocol
  const isRtspStream = isRtsp(streamUrl);
  const inputUrl = isRtspStream ? streamUrl : getHttpStreamUrl(streamUrl);

  const inputArgs: string[] = [];
  if (isRtspStream) {
    inputArgs.push('-rtsp_transport', 'tcp');
  } else {
    // HTTP: reconnect on failure, tell ffmpeg input is MJPEG
    inputArgs.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  }
  inputArgs.push('-i', inputUrl);

  // Persistent ffmpeg → continuous MJPEG output to stdout
  // -q:v 5: JPEG quality (1=best, 31=worst)
  // -r 10: limit to 10 fps for fresher frames with low latency
  const proc = spawn('ffmpeg', [
    ...inputArgs,
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    '-r', '10',
    '-',
  ], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  console.log(`[Grabber] Started for ${isRtspStream ? 'RTSP' : 'HTTP'}: ${inputUrl}`);

  const grabber: RtspGrabber = {
    process: proc,
    frame: null,
    updatedAt: 0,
    refCount: 1,
    url: streamUrl,
  };

  // Parse MJPEG byte stream: find JPEG SOI/EOI markers to extract frames
  let buf = Buffer.alloc(0);

  proc.stdout!.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    // Extract all complete JPEG frames from the buffer
    while (true) {
      const soiIdx = buf.indexOf(JPEG_SOI);
      if (soiIdx === -1) {
        buf = Buffer.alloc(0);
        break;
      }

      // Search for EOI after SOI
      const eoiIdx = buf.indexOf(JPEG_EOI, soiIdx + 2);
      if (eoiIdx === -1) {
        // Incomplete frame — trim buffer to SOI and wait for more data
        if (soiIdx > 0) buf = buf.subarray(soiIdx);
        break;
      }

      // Complete JPEG: SOI..EOI (inclusive, EOI is 2 bytes)
      const frame = Buffer.from(buf.subarray(soiIdx, eoiIdx + 2));
      if (frame.length > 500) {
        grabber.frame = frame;
        grabber.updatedAt = Date.now();
      }

      // Advance past this frame
      buf = buf.subarray(eoiIdx + 2);
    }

    // Prevent memory leak: if buffer grows too large, reset
    if (buf.length > 5 * 1024 * 1024) {
      buf = Buffer.alloc(0);
    }
  });

  proc.on('exit', () => {
    // Auto-cleanup on exit
    if (grabbers.get(streamUrl) === grabber) {
      grabbers.delete(streamUrl);
    }
  });

  grabbers.set(streamUrl, grabber);
  return grabber;
}

export function stopGrabber(rtspUrl: string): void {
  const grabber = grabbers.get(rtspUrl);
  if (!grabber) return;

  grabber.refCount--;
  if (grabber.refCount <= 0) {
    try { grabber.process.kill('SIGTERM'); } catch { /* ignore */ }
    grabbers.delete(rtspUrl);
  }
}

/**
 * Get a frame from the persistent RTSP grabber.
 * Starts the grabber if not already running.
 * Waits up to `timeoutMs` for the first frame.
 */
async function fetchRtspGrabberFrame(rtspUrl: string, timeoutMs = 5000): Promise<Buffer> {
  const grabber = startGrabber(rtspUrl);

  // If we already have a recent frame, return it immediately
  if (grabber.frame && (Date.now() - grabber.updatedAt) < 2000) {
    return grabber.frame;
  }

  // Wait for first frame
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (grabber.frame && grabber.updatedAt > Date.now() - 2000) {
      return grabber.frame;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error('RTSP grabber timeout — no frame received');
}

// ---------------------------------------------------------------------------
// One-shot snapshot (used for test-connection and first frame when no grabber)
// ---------------------------------------------------------------------------

async function fetchRtspSnapshotOneshot(rtspUrl: string): Promise<Buffer> {
  const { stdout } = await execFileAsync('ffmpeg', [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-vframes', '1',
    '-f', 'image2',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    'pipe:1',
  ], {
    encoding: 'buffer',
    timeout: 10000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!stdout || stdout.length === 0) {
    throw new Error('ffmpeg returned empty output');
  }

  return Buffer.from(stdout);
}

async function fetchHlsSnapshot(hlsUrl: string): Promise<Buffer> {
  const start = Date.now();
  const { stdout } = await execFileAsync('ffmpeg', [
    '-i', hlsUrl,
    '-vframes', '1',
    '-f', 'image2',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    'pipe:1',
  ], {
    encoding: 'buffer',
    timeout: 10000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!stdout || stdout.length === 0) {
    throw new Error('ffmpeg returned empty output for HLS stream');
  }

  console.log(`[Snapshot] HLS remote snapshot: ${Date.now() - start}ms, ${stdout.length} bytes`);
  return Buffer.from(stdout);
}

async function fetchLocalSegmentSnapshot(cameraId: string): Promise<Buffer> {
  const start = Date.now();
  const liveDir = path.join(STREAMS_DIR, cameraId);

  const entries = await fs.readdir(liveDir);
  const tsFiles = entries
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .reverse();

  if (tsFiles.length === 0) {
    throw new Error('No local segments available');
  }

  const segmentPath = path.join(liveDir, tsFiles[0]);

  const { stdout } = await execFileAsync('ffmpeg', [
    '-i', segmentPath,
    '-vframes', '1',
    '-f', 'image2',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    'pipe:1',
  ], {
    encoding: 'buffer',
    timeout: 5000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!stdout || stdout.length === 0) {
    throw new Error('ffmpeg returned empty frame from local segment');
  }

  console.log(`[Snapshot] Local segment ${tsFiles[0]}: ${Date.now() - start}ms, ${stdout.length} bytes`);
  return Buffer.from(stdout);
}

async function fetchHttpSnapshot(streamUrl: string): Promise<Buffer> {
  const url = isIpWebcam(streamUrl)
    ? streamUrl.replace(/\/$/, '') + '/shot.jpg'
    : streamUrl;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Camera returned ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetch a single snapshot from any camera.
 * For RTSP cameras with active monitoring, uses persistent grabber (instant).
 * For one-off requests, spawns ffmpeg per frame.
 */
export async function fetchSnapshot(streamUrl: string, cameraId?: string): Promise<Buffer> {
  // Check if a persistent grabber is running (works for RTSP AND HTTP cameras)
  const grabber = grabbers.get(streamUrl);
  if (grabber && grabber.frame) {
    return grabber.frame;
  }

  if (isRtsp(streamUrl)) {
    return fetchRtspSnapshotOneshot(streamUrl);
  }
  if (isHls(streamUrl) && cameraId) {
    try {
      return await fetchLocalSegmentSnapshot(cameraId);
    } catch {
      return fetchHlsSnapshot(streamUrl);
    }
  }
  if (isHls(streamUrl)) {
    return fetchHlsSnapshot(streamUrl);
  }
  return fetchHttpSnapshot(streamUrl);
}

/**
 * Start a persistent frame grabber for monitoring.
 * Works for both RTSP and HTTP MJPEG cameras (including Android IP Webcam).
 * Call this when monitoring starts. Frames will be instantly available
 * via fetchSnapshot() without spawning new ffmpeg processes.
 */
export function startRtspGrabber(streamUrl: string): void {
  startGrabber(streamUrl);
}

/**
 * Stop the persistent frame grabber.
 * Call when monitoring stops.
 */
export function stopRtspGrabber(streamUrl: string): void {
  stopGrabber(streamUrl);
}

/**
 * Test camera connection. Returns success status and error message.
 */
export async function testConnection(streamUrl: string): Promise<{
  success: boolean;
  error?: string;
  protocol: 'rtsp' | 'http';
}> {
  const protocol = isRtsp(streamUrl) ? 'rtsp' : 'http';

  try {
    const frame = isRtsp(streamUrl)
      ? await fetchRtspSnapshotOneshot(streamUrl)
      : await fetchHttpSnapshot(streamUrl);
    if (frame.length < 100) {
      return { success: false, error: 'Получены некорректные данные изображения', protocol };
    }
    return { success: true, protocol };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка подключения';
    // More helpful error messages for HTTP cameras
    if (protocol === 'http') {
      if (message.includes('404')) {
        return { success: false, error: 'Эндпоинт не найден (404). Для IP Webcam используйте URL: http://IP:8080/video', protocol };
      }
      if (message.includes('ECONNREFUSED')) {
        return { success: false, error: 'Подключение отклонено. Убедитесь, что приложение IP Webcam запущено на устройстве', protocol };
      }
      if (message.includes('timeout') || message.includes('abort')) {
        return { success: false, error: 'Таймаут подключения. Проверьте что устройство в той же сети', protocol };
      }
    }
    return { success: false, error: message, protocol };
  }
}
