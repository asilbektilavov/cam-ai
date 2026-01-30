import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'frames');

/**
 * Save a JPEG frame to disk under org/camera directory structure.
 * Returns the relative path to the saved file.
 */
export async function saveFrame(
  orgId: string,
  cameraId: string,
  frame: Buffer
): Promise<string> {
  const dir = path.join(DATA_DIR, orgId, cameraId);
  await mkdir(dir, { recursive: true });

  const timestamp = Date.now();
  const filename = `${timestamp}.jpg`;
  const filePath = path.join(dir, filename);

  await writeFile(filePath, frame);

  // Return relative path for DB storage
  return `${orgId}/${cameraId}/${filename}`;
}

/**
 * Get absolute path from a relative frame path.
 */
export function getFrameAbsolutePath(relativePath: string): string {
  return path.join(DATA_DIR, relativePath);
}
