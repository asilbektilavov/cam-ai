import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/attendance/cameras — list active attendance cameras (for attendance-service auto-recovery)
export async function GET() {
  const cameras = await prisma.camera.findMany({
    where: {
      purpose: { startsWith: 'attendance_' },
      isMonitoring: true,
    },
    select: {
      id: true,
      name: true,
      streamUrl: true,
      purpose: true,
    },
  });

  return NextResponse.json(
    cameras.map((c) => ({
      id: c.id,
      name: c.name,
      streamUrl: c.streamUrl,
      direction: c.purpose === 'attendance_entry' ? 'entry' : 'exit',
    }))
  );
}
