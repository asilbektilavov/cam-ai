-- Organization: add analysisMode
ALTER TABLE "Organization" ADD COLUMN "analysisMode" TEXT NOT NULL DEFAULT 'yolo_gemini_events';

-- Camera: add missing columns
ALTER TABLE "Camera" ADD COLUMN "maxPeopleCapacity" INTEGER;
ALTER TABLE "Camera" ADD COLUMN "privacyMasks" TEXT;
ALTER TABLE "Camera" ADD COLUMN "tripwireLine" TEXT;

-- AnalysisFrame: add detections column
ALTER TABLE "AnalysisFrame" ADD COLUMN IF NOT EXISTS "detections" TEXT;

-- WallLayout
CREATE TABLE IF NOT EXISTS "WallLayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grid" TEXT NOT NULL DEFAULT '2x2',
    "slots" TEXT NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WallLayout_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WallLayout" ADD CONSTRAINT "WallLayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FloorPlan
CREATE TABLE IF NOT EXISTS "FloorPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "cameras" TEXT NOT NULL DEFAULT '[]',
    "width" INTEGER NOT NULL DEFAULT 1000,
    "height" INTEGER NOT NULL DEFAULT 700,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FloorPlan" ADD CONSTRAINT "FloorPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DetectionZone
CREATE TABLE IF NOT EXISTS "DetectionZone" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" TEXT NOT NULL,
    "direction" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DetectionZone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DetectionZone_cameraId_type_idx" ON "DetectionZone"("cameraId", "type");
ALTER TABLE "DetectionZone" ADD CONSTRAINT "DetectionZone_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- LicensePlate
CREATE TABLE IF NOT EXISTS "LicensePlate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'neutral',
    "ownerName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LicensePlate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LicensePlate_organizationId_number_key" ON "LicensePlate"("organizationId", "number");
ALTER TABLE "LicensePlate" ADD CONSTRAINT "LicensePlate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PlateDetection
CREATE TABLE IF NOT EXISTS "PlateDetection" (
    "id" TEXT NOT NULL,
    "licensePlateId" TEXT,
    "cameraId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "imagePath" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlateDetection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PlateDetection_cameraId_timestamp_idx" ON "PlateDetection"("cameraId", "timestamp");
CREATE INDEX IF NOT EXISTS "PlateDetection_number_idx" ON "PlateDetection"("number");
ALTER TABLE "PlateDetection" ADD CONSTRAINT "PlateDetection_licensePlateId_fkey" FOREIGN KEY ("licensePlateId") REFERENCES "LicensePlate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlateDetection" ADD CONSTRAINT "PlateDetection_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AuditLog
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "targetType" TEXT,
    "details" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AutomationRule
CREATE TABLE IF NOT EXISTS "AutomationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actions" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
