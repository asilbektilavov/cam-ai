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
  await prisma.$transaction([
    // Sightings & search persons
    prisma.personSighting.deleteMany({ where: { searchPerson: { organizationId: orgId } } }),
    prisma.searchPerson.deleteMany({ where: { organizationId: orgId } }),
    // Attendance
    prisma.attendanceRecord.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.employee.deleteMany({ where: { organizationId: orgId } }),
    // Events & analysis
    prisma.analysisFrame.deleteMany({ where: { session: { camera: { organizationId: orgId } } } }),
    prisma.analysisSession.deleteMany({ where: { camera: { organizationId: orgId } } }),
    prisma.event.deleteMany({ where: { organizationId: orgId } }),
    // Detections & plates
    prisma.plateDetection.deleteMany({ where: { camera: { organizationId: orgId } } }),
    prisma.licensePlate.deleteMany({ where: { organizationId: orgId } }),
    prisma.detectionZone.deleteMany({ where: { camera: { organizationId: orgId } } }),
    // Recordings
    prisma.recording.deleteMany({ where: { camera: { organizationId: orgId } } }),
    // Notifications
    prisma.notification.deleteMany({ where: { organizationId: orgId } }),
    // Automation rules
    prisma.automationRule.deleteMany({ where: { organizationId: orgId } }),
    // Smart features
    prisma.smartFeature.deleteMany({ where: { camera: { organizationId: orgId } } }),
    // Wall layouts & floor plans
    prisma.wallLayout.deleteMany({ where: { organizationId: orgId } }),
    prisma.floorPlan.deleteMany({ where: { organizationId: orgId } }),
    // Audit log
    prisma.auditLog.deleteMany({ where: { organizationId: orgId } }),
    // Sync
    prisma.syncQueue.deleteMany({}),
    prisma.remoteEvent.deleteMany({ where: { remoteCamera: { instance: { organizationId: orgId } } } }),
    prisma.remoteCamera.deleteMany({ where: { instance: { organizationId: orgId } } }),
    prisma.remoteInstance.deleteMany({ where: { organizationId: orgId } }),
    // Cameras (after all camera-dependent data)
    prisma.camera.deleteMany({ where: { organizationId: orgId } }),
    // Integrations
    prisma.integration.deleteMany({ where: { organizationId: orgId } }),
    // Branches
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

  return NextResponse.json({ success: true });
}
