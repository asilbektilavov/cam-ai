import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/attendance/cameras — list active attendance + people_search cameras (for attendance-service auto-recovery)
export async function GET() {
  const cameras = await prisma.camera.findMany({
    where: {
      purpose: { in: ['attendance_entry', 'attendance_exit', 'people_search'] },
      isMonitoring: true,
    },
    select: {
      id: true,
      name: true,
      streamUrl: true,
      purpose: true,
      onvifHost: true,
      onvifPort: true,
      onvifUser: true,
      onvifPass: true,
    },
  });

  return NextResponse.json(
    cameras.map((c) => ({
      id: c.id,
      name: c.name,
      streamUrl: c.streamUrl,
      direction: c.purpose === 'attendance_entry' ? 'entry'
        : c.purpose === 'attendance_exit' ? 'exit'
        : 'search',
      onvifHost: c.onvifHost || '',
      onvifPort: c.onvifPort || 80,
      onvifUser: c.onvifUser || 'admin',
      onvifPass: c.onvifPass || '',
    }))
  );
}
