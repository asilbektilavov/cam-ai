import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { readdir, stat, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

// In-memory store for export progress (in production, use Redis or DB)
const exportProgress = new Map<
  string,
  { progress: number; status: string; message: string; error?: string }
>();

// Export the progress map for SSE endpoint
export { exportProgress };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_recordings');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Verify camera belongs to org
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!camera) return notFound('Camera not found');

  const body = await req.json();
  const { startTime, endTime, format, addTimestamp, addWatermark } = body;

  if (!startTime || !endTime) {
    return badRequest('startTime and endTime are required');
  }

  const validFormats = ['mp4', 'avi'];
  const exportFormat = validFormats.includes(format) ? format : 'mp4';

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return badRequest('Invalid date format');
  }

  if (startDate >= endDate) {
    return badRequest('startTime must be before endTime');
  }

  // Generate unique export ID
  const exportId = randomUUID();

  // Ensure exports directory exists
  if (!existsSync(EXPORTS_DIR)) {
    await mkdir(EXPORTS_DIR, { recursive: true });
  }

  // Set initial progress
  exportProgress.set(exportId, {
    progress: 0,
    status: 'processing',
    message: 'Поиск записей...',
  });

  // Start async export process
  processExport(
    exportId,
    id,
    camera.name,
    startDate,
    endDate,
    exportFormat,
    addTimestamp === true,
    addWatermark === true
  ).catch((err) => {
    console.error(`Export ${exportId} failed:`, err);
    exportProgress.set(exportId, {
      progress: 0,
      status: 'error',
      message: 'Ошибка экспорта',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  });

  return NextResponse.json({
    exportId,
    status: 'processing',
  });
}

async function processExport(
  exportId: string,
  cameraId: string,
  cameraName: string,
  startDate: Date,
  endDate: Date,
  format: string,
  addTimestamp: boolean,
  addWatermark: boolean
) {
  const recordingsDir = path.join(DATA_DIR, 'recordings', cameraId);

  // Find all recording segments in the time range
  const segments: string[] = [];

  exportProgress.set(exportId, {
    progress: 5,
    status: 'processing',
    message: 'Поиск записей...',
  });

  // Iterate through date directories
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);
  const endDateDay = new Date(endDate);
  endDateDay.setHours(23, 59, 59, 999);

  while (currentDate <= endDateDay) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dateDir = path.join(recordingsDir, dateStr);

    if (existsSync(dateDir)) {
      try {
        const hours = await readdir(dateDir);
        const sortedHours = hours.filter((h) => /^\d{2}$/.test(h)).sort();

        for (const hour of sortedHours) {
          const hourNum = parseInt(hour, 10);
          const hourDate = new Date(currentDate);
          hourDate.setHours(hourNum, 0, 0, 0);

          const hourEndDate = new Date(currentDate);
          hourEndDate.setHours(hourNum, 59, 59, 999);

          // Check if this hour overlaps with the requested range
          if (hourEndDate < startDate || hourDate > endDate) {
            continue;
          }

          const hourDir = path.join(dateDir, hour);
          try {
            const files = await readdir(hourDir);
            const tsFiles = files.filter((f) => f.endsWith('.ts')).sort();

            for (const file of tsFiles) {
              const filePath = path.join(hourDir, file);
              try {
                await stat(filePath);
                segments.push(filePath);
              } catch {
                // Skip unreadable files
              }
            }
          } catch {
            // Skip unreadable hour directories
          }
        }
      } catch {
        // Skip unreadable date directories
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (segments.length === 0) {
    exportProgress.set(exportId, {
      progress: 0,
      status: 'error',
      message: 'Записи не найдены',
      error: 'Нет записей в указанном диапазоне времени',
    });
    return;
  }

  exportProgress.set(exportId, {
    progress: 15,
    status: 'processing',
    message: `Найдено ${segments.length} сегментов. Подготовка...`,
  });

  // Create concat file list for FFmpeg
  const concatFilePath = path.join(EXPORTS_DIR, `${exportId}_concat.txt`);
  const concatContent = segments
    .map((s) => `file '${s.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await writeFile(concatFilePath, concatContent, 'utf-8');

  // Build FFmpeg command
  const outputPath = path.join(EXPORTS_DIR, `${exportId}.${format}`);
  const ffmpegArgs: string[] = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFilePath,
  ];

  // Build video filter chain
  const filters: string[] = [];

  if (addTimestamp) {
    // Add drawtext filter for timestamp overlay
    filters.push(
      "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:" +
      "text='%{localtime\\:%Y-%m-%d %H\\\\:%M\\\\:%S}':" +
      "fontcolor=white:fontsize=18:" +
      "box=1:boxcolor=black@0.5:boxborderw=4:" +
      "x=10:y=h-th-10"
    );
  }

  if (addWatermark) {
    // Add drawtext filter for camera name watermark
    const escapedName = cameraName.replace(/[:\\]/g, '\\$&').replace(/'/g, "'\\''");
    filters.push(
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:` +
      `text='${escapedName}':` +
      `fontcolor=white:fontsize=16:` +
      `box=1:boxcolor=black@0.5:boxborderw=4:` +
      `x=10:y=10`
    );
  }

  if (filters.length > 0) {
    ffmpegArgs.push('-vf', filters.join(','));
  }

  if (format === 'mp4') {
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
    ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k');
    ffmpegArgs.push('-movflags', '+faststart');
  } else if (format === 'avi') {
    ffmpegArgs.push('-c:v', 'mpeg4', '-q:v', '5');
    ffmpegArgs.push('-c:a', 'mp3', '-b:a', '128k');
  }

  ffmpegArgs.push(outputPath);

  exportProgress.set(exportId, {
    progress: 20,
    status: 'processing',
    message: 'Конвертация видео...',
  });

  // Run FFmpeg
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrOutput = '';

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      stderrOutput += output;

      // Parse FFmpeg progress from stderr
      const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (timeMatch) {
        // Update progress based on time output (rough estimate)
        const currentProgress = Math.min(
          90,
          20 + Math.random() * 5 + (exportProgress.get(exportId)?.progress || 20)
        );
        exportProgress.set(exportId, {
          progress: Math.min(currentProgress, 90),
          status: 'processing',
          message: 'Конвертация видео...',
        });
      }
    });

    ffmpeg.on('close', async (code) => {
      // Clean up concat file
      try {
        const { unlink } = await import('fs/promises');
        await unlink(concatFilePath);
      } catch {
        // Ignore cleanup errors
      }

      if (code === 0) {
        exportProgress.set(exportId, {
          progress: 100,
          status: 'completed',
          message: 'Экспорт завершён',
        });
        resolve();
      } else {
        const errorMsg = stderrOutput.slice(-500);
        exportProgress.set(exportId, {
          progress: 0,
          status: 'error',
          message: 'Ошибка FFmpeg',
          error: `FFmpeg exited with code ${code}: ${errorMsg}`,
        });
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      exportProgress.set(exportId, {
        progress: 0,
        status: 'error',
        message: 'FFmpeg не найден',
        error: 'FFmpeg не установлен или не доступен в PATH',
      });
      reject(err);
    });

    // Simulate progress updates while FFmpeg is running
    let simProgress = 20;
    const progressInterval = setInterval(() => {
      simProgress = Math.min(simProgress + 3, 90);
      const currentState = exportProgress.get(exportId);
      if (currentState && currentState.status === 'processing') {
        exportProgress.set(exportId, {
          ...currentState,
          progress: simProgress,
        });
      } else {
        clearInterval(progressInterval);
      }
    }, 2000);

    ffmpeg.on('close', () => {
      clearInterval(progressInterval);
    });
  });
}
