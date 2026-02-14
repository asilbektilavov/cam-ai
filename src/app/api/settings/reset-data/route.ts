import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { checkPermission, RBACError } from '@/lib/rbac';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  // Only admin can reset data
  try {
    checkPermission(session, 'manage_settings');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await request.json();
  const { password } = body;

  if (!password) return badRequest('Введите пароль');

  // Verify password
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) return unauthorized();

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return badRequest('Неверный пароль');

  const orgId = session.user.organizationId;

  // Delete all org data in correct order (respecting foreign keys)
  // Each table must be deleted BEFORE the tables it references via FK
  await prisma.$transaction([
    // 1. Leaf tables first (no other table references these)
    prisma.analysisFrame.deleteMany({ where: { session: { camera: { organizationId: orgId } } } }),
    prisma.personSighting.deleteMany({ where: { searchPerson: { organizationId: orgId } } }),
    prisma.remoteEvent.deleteMany({ where: { remoteInstance: { organizationId: orgId } } }),
    prisma.syncQueue.deleteMany({}),
    prisma.auditLog.deleteMany({ where: { organizationId: orgId } }),
    prisma.wallLayout.deleteMany({ where: { organizationId: orgId } }),
    prisma.floorPlan.deleteMany({ where: { organizationId: orgId } }),
    prisma.automationRule.deleteMany({ where: { organizationId: orgId } }),

    // 2. Tables referencing Camera, Employee, Integration, LicensePlate, etc.
    prisma.analysisSession.deleteMany({ where: { camera: { organizationId: orgId } } }),
    prisma.attendanceRecord.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.plateDetection.deleteMany({ where: { camera: { organizationId: orgId } } }),
    prisma.detectionZone.deleteMany({ where: { camera: { organizationId: orgId } } }),
    prisma.recording.deleteMany({ where: { camera: { organizationId: orgId } } }),
    prisma.event.deleteMany({ where: { organizationId: orgId } }),
    prisma.notification.deleteMany({ where: { organizationId: orgId } }),
    prisma.smartFeature.deleteMany({ where: { camera: { organizationId: orgId } } }),
    prisma.searchPerson.deleteMany({ where: { organizationId: orgId } }),
    prisma.remoteCamera.deleteMany({ where: { remoteInstance: { organizationId: orgId } } }),

    // 3. Mid-level tables
    prisma.employee.deleteMany({ where: { organizationId: orgId } }),
    prisma.licensePlate.deleteMany({ where: { organizationId: orgId } }),
    prisma.remoteInstance.deleteMany({ where: { organizationId: orgId } }),
    prisma.camera.deleteMany({ where: { organizationId: orgId } }),

    // 4. Tables referenced by Camera and others
    prisma.integration.deleteMany({ where: { organizationId: orgId } }),
    prisma.branch.deleteMany({ where: { organizationId: orgId } }),
  ]);

  // Clean up sighting screenshots
  try {
    const sightingsDir = path.join(process.cwd(), 'public', 'uploads', 'sightings');
    if (fs.existsSync(sightingsDir)) {
      fs.rmSync(sightingsDir, { recursive: true, force: true });
    }
  } catch {
    // ignore cleanup errors
  }

  // Clean up plate screenshots
  try {
    const platesDir = path.join(process.cwd(), 'public', 'uploads', 'plates');
    if (fs.existsSync(platesDir)) {
      fs.rmSync(platesDir, { recursive: true, force: true });
    }
  } catch {
    // ignore cleanup errors
  }

  // Clean up face events cache
  try {
    const cacheDir = '/tmp/camai-face-events';
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  // Clean up plate events cache
  try {
    const plateCacheDir = '/tmp/camai-plate-events';
    if (fs.existsSync(plateCacheDir)) {
      fs.rmSync(plateCacheDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  // Sync attendance-service: clear employees and search persons
  try {
    await Promise.allSettled([
      fetch('http://localhost:8002/employees/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      }),
      fetch('http://localhost:8002/search-persons/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      }),
    ]);
  } catch {
    // attendance-service may not be running
  }

  return NextResponse.json({ success: true });
}
