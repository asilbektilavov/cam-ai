import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-utils';
import { shelfMonitor } from '@/lib/services/shelf-monitor';

const YOLO_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:8001';

export async function GET(request: NextRequest) {
  const cameraId = request.nextUrl.searchParams.get('cameraId');

  if (!cameraId) {
    return NextResponse.json({ error: 'cameraId is required' }, { status: 400 });
  }

  const readings = shelfMonitor.getShelfHistory(cameraId, 24);
  const latest = shelfMonitor.getShelfStatus(cameraId);

  const history = readings.slice(-24).map((r) => ({
    timestamp: new Date(r.timestamp).toISOString(),
    fullness: r.fullnessPercent,
  }));

  return NextResponse.json({
    cameraId,
    cameraName: `Камера ${cameraId.slice(-4)}`,
    fullness: latest?.fullnessPercent ?? 0,
    status: latest?.status ?? 'empty',
    lastUpdated: latest ? new Date(latest.timestamp).toISOString() : null,
    alertThreshold: 30,
    history,
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;
    if (!image) return NextResponse.json({ error: 'No image' }, { status: 400 });
    const proxyForm = new FormData();
    proxyForm.append('image', image);
    proxyForm.append('roi_x', (formData.get('roi_x') || '0.0') as string);
    proxyForm.append('roi_y', (formData.get('roi_y') || '0.0') as string);
    proxyForm.append('roi_w', (formData.get('roi_w') || '1.0') as string);
    proxyForm.append('roi_h', (formData.get('roi_h') || '1.0') as string);
    const resp = await fetch(`${YOLO_URL}/detect-shelf-fullness`, { method: 'POST', body: proxyForm });
    return NextResponse.json(await resp.json());
  } catch {
    return NextResponse.json({ error: 'Shelf analysis failed' }, { status: 500 });
  }
}
