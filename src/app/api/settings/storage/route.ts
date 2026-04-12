import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface DiskInfo {
  mountpoint: string;
  total: number;
  used: number;
  free: number;
  percent: number;
  device: string;
}

/** List mounted disks/partitions available for storage. */
function listDisks(): DiskInfo[] {
  try {
    // POSIX format works on both GNU coreutils and BusyBox (Alpine)
    // Columns: Filesystem 1024-blocks Used Available Capacity Mounted-on
    const output = execSync('df -P -k', {
      encoding: 'utf8',
      timeout: 5000,
    });

    const lines = output.trim().split('\n').slice(1);
    const disks: DiskInfo[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;

      const [device, totalStr, usedStr, freeStr, percentStr, mountpoint] = parts;

      // Only allow /mnt/* mountpoints (external disks) — skip container bind mounts
      if (!mountpoint.startsWith('/mnt/')) continue;
      // Deduplicate same mountpoint
      if (seen.has(mountpoint)) continue;
      // Skip small partitions (boot, efi) — values are in KB (1024 blocks)
      const totalKB = parseInt(totalStr, 10);
      if (totalKB < 1_000_000) continue; // < 1GB

      seen.add(mountpoint);
      disks.push({
        device,
        mountpoint,
        total: totalKB * 1024,
        used: parseInt(usedStr, 10) * 1024,
        free: parseInt(freeStr, 10) * 1024,
        percent: parseInt(percentStr, 10),
      });
    }

    return disks;
  } catch {
    return [];
  }
}

/** Validate that a path is writable. */
function isWritable(dirPath: string): boolean {
  try {
    const testDir = path.join(dirPath, '.dss-write-test');
    fs.mkdirSync(testDir, { recursive: true });
    fs.rmdirSync(testDir);
    return true;
  } catch {
    return false;
  }
}

// GET — current storage config + available disks
export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_settings');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId },
    select: { storagePath: true, retentionDays: true },
  });

  const defaultPath = path.join(process.cwd(), 'data', 'recordings');
  const disks = listDisks();

  return NextResponse.json({
    currentPath: org?.storagePath || null,
    defaultPath,
    disks,
    retentionDays: org?.retentionDays ?? null,
  });
}

// PATCH — update storage path
export async function PATCH(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_settings');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await request.json();
  const { storagePath, retentionDays } = body;

  // Handle retention-only update (without changing storage path)
  if (retentionDays !== undefined && storagePath === undefined) {
    if (retentionDays !== null && (typeof retentionDays !== 'number' || retentionDays < 1 || retentionDays > 3650)) {
      return NextResponse.json(
        { error: 'retentionDays должен быть числом от 1 до 3650 или null' },
        { status: 400 }
      );
    }
    await prisma.organization.update({
      where: { id: session.user.organizationId },
      data: { retentionDays },
    });
    return NextResponse.json({ success: true, retentionDays });
  }

  // null = reset to default
  if (storagePath === null) {
    await prisma.organization.update({
      where: { id: session.user.organizationId },
      data: { storagePath: null },
    });
    return NextResponse.json({ success: true, storagePath: null });
  }

  // Validate path
  if (typeof storagePath !== 'string' || !path.isAbsolute(storagePath)) {
    return NextResponse.json(
      { error: 'Путь должен быть абсолютным (начинаться с /)' },
      { status: 400 }
    );
  }

  // Security: block dangerous paths
  const blocked = ['/', '/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/sbin', '/sys', '/usr', '/var/run'];
  if (blocked.includes(storagePath) || blocked.some((b) => storagePath.startsWith(b + '/'))) {
    return NextResponse.json(
      { error: 'Этот путь запрещён для хранения записей' },
      { status: 400 }
    );
  }

  // Check writable
  if (!isWritable(storagePath)) {
    return NextResponse.json(
      { error: 'Нет доступа на запись в указанную директорию' },
      { status: 400 }
    );
  }

  // Create recordings subdirectory
  const recordingsPath = path.join(storagePath, 'recordings');
  try {
    fs.mkdirSync(recordingsPath, { recursive: true });
  } catch {
    return NextResponse.json(
      { error: 'Не удалось создать директорию для записей' },
      { status: 500 }
    );
  }

  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: { storagePath: recordingsPath },
  });

  return NextResponse.json({ success: true, storagePath: recordingsPath });
}
