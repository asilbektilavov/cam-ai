-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_organizationId_name_key" ON "Branch"("organizationId", "name");

-- Create default branch for each existing organization
INSERT INTO "Branch" ("id", "organizationId", "name", "updatedAt")
SELECT 'branch_' || "id", "id", 'Главный офис', CURRENT_TIMESTAMP
FROM "Organization";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Camera: add branchId (required), fill from org's default branch
CREATE TABLE "new_Camera" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "streamUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "venueType" TEXT NOT NULL DEFAULT 'retail',
    "resolution" TEXT NOT NULL DEFAULT '1920x1080',
    "fps" INTEGER NOT NULL DEFAULT 30,
    "isMonitoring" BOOLEAN NOT NULL DEFAULT false,
    "motionThreshold" REAL NOT NULL DEFAULT 5.0,
    "captureInterval" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Camera_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Camera_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Camera" ("id", "name", "location", "streamUrl", "status", "organizationId", "branchId", "venueType", "resolution", "fps", "isMonitoring", "motionThreshold", "captureInterval", "createdAt", "updatedAt")
SELECT c."id", c."name", c."location", c."streamUrl", c."status", c."organizationId",
       'branch_' || c."organizationId",
       c."venueType", c."resolution", c."fps", c."isMonitoring", c."motionThreshold", c."captureInterval", c."createdAt", c."updatedAt"
FROM "Camera" c;
DROP TABLE "Camera";
ALTER TABLE "new_Camera" RENAME TO "Camera";

-- Event: add branchId (nullable), fill from camera's branch
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cameraId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "description" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "sessionId" TEXT,
    CONSTRAINT "Event_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("id", "cameraId", "organizationId", "branchId", "type", "severity", "description", "timestamp", "metadata", "sessionId")
SELECT e."id", e."cameraId", e."organizationId",
       'branch_' || e."organizationId",
       e."type", e."severity", e."description", e."timestamp", e."metadata", e."sessionId"
FROM "Event" e;
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
