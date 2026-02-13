import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/api-utils';
import fs from 'fs/promises';
import path from 'path';

// GET /api/attendance/[id]/photo — serve employee photo (no auth for attendance-service)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { photoPath: true },
  });

  if (!employee || !employee.photoPath) return notFound('Photo not found');

  const filePath = path.join(process.cwd(), employee.photoPath);

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch {
    return notFound('Photo file not found');
  }

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
