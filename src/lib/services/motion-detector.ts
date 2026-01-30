import sharp from 'sharp';

const COMPARE_SIZE = 64;

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
 * Fetch a single snapshot from an IP Webcam camera.
 */
export async function fetchSnapshot(streamUrl: string): Promise<Buffer> {
  const snapshotUrl = streamUrl.replace(/\/$/, '') + '/shot.jpg';
  const response = await fetch(snapshotUrl, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Camera returned ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
