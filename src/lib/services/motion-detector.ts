import sharp from 'sharp';
import { execFile } from 'child_process';
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

/**
 * Detect if the stream URL is RTSP.
 */
function isRtsp(url: string): boolean {
  return url.toLowerCase().startsWith('rtsp://');
}

/**
 * Detect if the URL is an HLS stream (.m3u8).
 */
function isHls(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.endsWith('.m3u8');
  } catch {
    return false;
  }
}

/**
 * Detect if the URL looks like IP Webcam (Android app).
 * IP Webcam uses http://IP:8080 and serves /shot.jpg
 */
function isIpWebcam(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && !u.pathname.match(/\.(jpg|jpeg|png|cgi|bmp|m3u8)$/i) && !u.pathname.includes('/onvif');
  } catch {
    return false;
  }
}

/**
 * Fetch a single frame from an RTSP camera using ffmpeg.
 * Returns JPEG buffer.
 */
async function fetchRtspSnapshot(rtspUrl: string): Promise<Buffer> {
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
    maxBuffer: 10 * 1024 * 1024, // 10MB
  });

  if (!stdout || stdout.length === 0) {
    throw new Error('ffmpeg returned empty output');
  }

  return Buffer.from(stdout);
}

/**
 * Fetch a single frame from an HLS stream using ffmpeg (remote).
 * Slow (~2-5s) — only used as fallback.
 */
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

/**
 * Extract a frame from the latest local .ts segment on disk.
 * Much faster (~100-300ms) than spawning ffmpeg against a remote HLS URL
 * because the segment is already downloaded by StreamManager.
 */
async function fetchLocalSegmentSnapshot(cameraId: string): Promise<Buffer> {
  const start = Date.now();
  const liveDir = path.join(STREAMS_DIR, cameraId);

  // Find the newest .ts segment
  const entries = await fs.readdir(liveDir);
  const tsFiles = entries
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .reverse(); // newest first (seg_NNN.ts — higher number = newer)

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

/**
 * Fetch a single snapshot from an HTTP camera (IP Webcam or direct URL).
 */
async function fetchHttpSnapshot(streamUrl: string): Promise<Buffer> {
  // For IP Webcam style URLs, append /shot.jpg
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
 * Auto-detects protocol (RTSP vs HTTP/HLS).
 * For HLS cameras with active streaming, uses local segments (fast).
 */
export async function fetchSnapshot(streamUrl: string, cameraId?: string): Promise<Buffer> {
  if (isRtsp(streamUrl)) {
    return fetchRtspSnapshot(streamUrl);
  }
  // For HLS streams, try local segments first (much faster)
  if (isHls(streamUrl) && cameraId) {
    try {
      return await fetchLocalSegmentSnapshot(cameraId);
    } catch {
      // Fall back to remote HLS
      return fetchHlsSnapshot(streamUrl);
    }
  }
  if (isHls(streamUrl)) {
    return fetchHlsSnapshot(streamUrl);
  }
  return fetchHttpSnapshot(streamUrl);
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
    const frame = await fetchSnapshot(streamUrl);
    if (frame.length < 100) {
      return { success: false, error: 'Received invalid image data', protocol };
    }
    return { success: true, protocol };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return { success: false, error: message, protocol };
  }
}
