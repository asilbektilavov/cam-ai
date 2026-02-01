-- CreateTable
CREATE TABLE "RemoteInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "address" TEXT,
    "lastSyncAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RemoteEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "remoteInstanceId" TEXT NOT NULL,
    "originalId" TEXT NOT NULL,
    "cameraName" TEXT NOT NULL,
    "cameraLocation" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "description" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "metadata" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RemoteEvent_remoteInstanceId_fkey" FOREIGN KEY ("remoteInstanceId") REFERENCES "RemoteInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RemoteCamera" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "remoteInstanceId" TEXT NOT NULL,
    "originalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "isMonitoring" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RemoteCamera_remoteInstanceId_fkey" FOREIGN KEY ("remoteInstanceId") REFERENCES "RemoteInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Branch" ("address", "createdAt", "id", "name", "organizationId", "updatedAt") SELECT "address", "createdAt", "id", "name", "organizationId", "updatedAt" FROM "Branch";
DROP TABLE "Branch";
ALTER TABLE "new_Branch" RENAME TO "Branch";
CREATE UNIQUE INDEX "Branch_organizationId_name_key" ON "Branch"("organizationId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RemoteInstance_instanceId_key" ON "RemoteInstance"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteEvent_remoteInstanceId_originalId_key" ON "RemoteEvent"("remoteInstanceId", "originalId");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteCamera_remoteInstanceId_originalId_key" ON "RemoteCamera"("remoteInstanceId", "originalId");
