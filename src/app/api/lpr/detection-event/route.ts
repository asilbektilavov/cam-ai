import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';
import '@/lib/services/notification-dispatcher'; // ensure listener is active
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  // Validate internal service call
  const syncHeader = req.headers.get('x-plate-sync');
  if (!syncHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { cameraId, plateNumber, confidence, snapshot } = body;

  if (!cameraId || !plateNumber) {
    return NextResponse.json({ error: 'cameraId and plateNumber required' }, { status: 400 });
  }

  // Verify camera exists and get orgId
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { id: true, organizationId: true },
  });
  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  const normalizedNumber = plateNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Skip low-confidence detections — only record ≥85%
  const MIN_RECORD_CONFIDENCE = 0.85;
  if ((confidence || 0) < MIN_RECORD_CONFIDENCE) {
    return NextResponse.json({ id: null, linked: false, skipped: true });
  }

  // Try to link to existing LicensePlate in this org
  const existingPlate = await prisma.licensePlate.findUnique({
    where: {
      organizationId_number: {
        organizationId: camera.organizationId,
        number: normalizedNumber,
      },
    },
  });

  // Save snapshot if provided
  let imagePath: string | null = null;
  if (snapshot) {
    try {
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'plates');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const filename = `${cameraId}_${Date.now()}.jpg`;
      const filePath = path.join(uploadsDir, filename);
      const buffer = Buffer.from(snapshot, 'base64');
      fs.writeFileSync(filePath, buffer);
      imagePath = `/uploads/plates/${filename}`;
    } catch (e) {
      console.warn('[LPR] Failed to save snapshot:', e);
    }
  }

  // Create PlateDetection record
  const detection = await prisma.plateDetection.create({
    data: {
      cameraId,
      number: normalizedNumber,
      confidence: confidence || 0,
      imagePath,
      licensePlateId: existingPlate?.id || null,
    },
  });

  // Get camera details for notifications
  const cameraFull = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { id: true, name: true, location: true, organizationId: true, branchId: true },
  });

  if (cameraFull) {
    const isKnown = !!existingPlate;
    const ownerName = existingPlate
      ? (await prisma.licensePlate.findUnique({ where: { id: existingPlate.id }, select: { ownerName: true } }))?.ownerName
      : null;

    // Create Event record for history
    await prisma.event.create({
      data: {
        cameraId,
        organizationId: cameraFull.organizationId,
        branchId: cameraFull.branchId,
        type: 'plate_detected',
        severity: isKnown ? 'info' : 'warning',
        description: isKnown
          ? `Распознан номер: ${normalizedNumber}${ownerName ? ` (${ownerName})` : ''}`
          : `Неизвестный номер: ${normalizedNumber}`,
        metadata: JSON.stringify({
          plateNumber: normalizedNumber,
          confidence,
          isKnown,
          ownerName: ownerName || null,
          imagePath,
        }),
      },
    });

    // Emit camera-event for AutomationEngine
    const cameraEvent: CameraEvent = {
      type: 'plate_detected',
      cameraId,
      organizationId: cameraFull.organizationId,
      branchId: cameraFull.branchId || '',
      data: {
        plateNumber: normalizedNumber,
        confidence,
        isKnown,
        ownerName: ownerName || null,
      },
    };
    appEvents.emit('camera-event', cameraEvent);

    // Emit smart-alert for NotificationDispatcher (Telegram)
    appEvents.emit('smart-alert', {
      featureType: 'lpr_detection',
      cameraId,
      cameraName: cameraFull.name,
      cameraLocation: cameraFull.location,
      organizationId: cameraFull.organizationId,
      branchId: cameraFull.branchId || '',
      integrationId: null,
      severity: isKnown ? 'info' : 'warning',
      message: isKnown
        ? `Распознан номер: ${normalizedNumber}${ownerName ? ` (${ownerName})` : ''}`
        : `Неизвестный номер: ${normalizedNumber}`,
      metadata: { plateNumber: normalizedNumber, confidence, isKnown },
    });
  }

  return NextResponse.json({ id: detection.id, linked: !!existingPlate });
}
