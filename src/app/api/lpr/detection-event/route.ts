import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

  return NextResponse.json({ id: detection.id, linked: !!existingPlate });
}
