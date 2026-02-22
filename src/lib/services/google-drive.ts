import { google, drive_v3 } from 'googleapis';
import { prisma } from '@/lib/prisma';
import { readdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), 'data');
const ROOT_FOLDER_NAME = 'DSS';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Drive cleanup thresholds
const DRIVE_CLEANUP_THRESHOLD = 90; // start deleting at 90%
const DRIVE_CLEANUP_TARGET = 85; // stop deleting at 85%

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GDriveConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  email?: string;
}

/** Check if OAuth credentials (clientId/clientSecret) are configured. */
export async function hasOAuthCredentials(orgId: string): Promise<boolean> {
  const config = await getStoredConfig(orgId);
  const clientId = config.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

/** Get stored config for an org's Google Drive integration. */
async function getStoredConfig(orgId: string): Promise<GDriveConfig> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'google_drive' } },
  });
  if (!integration) return {};
  return JSON.parse(integration.config) as GDriveConfig;
}

/** Build OAuth2 client from stored clientId/clientSecret + a redirect URI. */
function buildOAuth2Client(config: GDriveConfig, redirectUri: string) {
  const clientId = config.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth не настроен. Введите Client ID и Client Secret.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ---------------------------------------------------------------------------
// GoogleDriveService
// ---------------------------------------------------------------------------

/**
 * Save Google OAuth Client ID + Client Secret for an org.
 * Called from UI before the first OAuth connect.
 */
export async function saveOAuthCredentials(
  orgId: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const existing = await getStoredConfig(orgId);
  const config: GDriveConfig = { ...existing, clientId, clientSecret };

  await prisma.integration.upsert({
    where: { organizationId_type: { organizationId: orgId, type: 'google_drive' } },
    update: { config: JSON.stringify(config) },
    create: {
      organizationId: orgId,
      type: 'google_drive',
      name: 'Google Drive',
      enabled: false,
      config: JSON.stringify(config),
    },
  });
}

/** Generate the Google OAuth consent URL. redirectUri is auto-detected from the request. */
export async function getAuthUrl(orgId: string, redirectUri: string): Promise<string> {
  const config = await getStoredConfig(orgId);
  const oauth2 = buildOAuth2Client(config, redirectUri);

  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: orgId,
  });
}

/** Exchange authorization code for tokens and save to Integration.config. */
export async function handleCallback(orgId: string, code: string, redirectUri: string): Promise<void> {
  const config = await getStoredConfig(orgId);
  const oauth2 = buildOAuth2Client(config, redirectUri);
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('No refresh token received. Please revoke access and try again.');
  }

  // Get user email for display
  oauth2.setCredentials(tokens);
  const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
  const userInfo = await oauth2Api.userinfo.get();
  const email = userInfo.data.email || '';

  const newConfig: GDriveConfig = {
    ...config,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || '',
    email,
  };

  await prisma.integration.upsert({
    where: { organizationId_type: { organizationId: orgId, type: 'google_drive' } },
    update: {
      enabled: true,
      config: JSON.stringify(newConfig),
    },
    create: {
      organizationId: orgId,
      type: 'google_drive',
      name: 'Google Drive',
      enabled: true,
      config: JSON.stringify(newConfig),
    },
  });

  console.log(`[GoogleDrive] Connected for org ${orgId} (${email})`);
}

/** Get authenticated Drive client for an organization. Returns null if not connected. */
async function getDriveClient(orgId: string): Promise<drive_v3.Drive | null> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'google_drive' } },
  });

  if (!integration?.enabled) return null;

  const config = JSON.parse(integration.config) as GDriveConfig;

  if (!config.refreshToken) return null;

  try {
    // Redirect URI not needed for API calls with refresh token, use placeholder
    const oauth2 = buildOAuth2Client(config, 'https://localhost');
    oauth2.setCredentials({
      refresh_token: config.refreshToken,
      access_token: config.accessToken,
    });

    return google.drive({ version: 'v3', auth: oauth2 });
  } catch {
    return null;
  }
}

/** Check if Google Drive is connected for an org. */
export async function isConnected(orgId: string): Promise<boolean> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'google_drive' } },
  });

  if (!integration?.enabled) return false;

  const config = JSON.parse(integration.config);
  return !!config.refreshToken;
}

/** Get connection status (email + connected). */
export async function getStatus(orgId: string): Promise<{ connected: boolean; email: string }> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'google_drive' } },
  });

  if (!integration?.enabled) return { connected: false, email: '' };

  const config = JSON.parse(integration.config);
  return {
    connected: !!config.refreshToken,
    email: config.email || '',
  };
}

/** Disconnect Google Drive (remove tokens). */
export async function disconnect(orgId: string): Promise<void> {
  await prisma.integration.updateMany({
    where: { organizationId: orgId, type: 'google_drive' },
    data: { enabled: false, config: '{}' },
  });
  console.log(`[GoogleDrive] Disconnected for org ${orgId}`);
}

/** Test connection by calling drive.about.get. */
export async function testConnection(orgId: string): Promise<{ success: boolean; email?: string; storage?: string }> {
  const drive = await getDriveClient(orgId);
  if (!drive) return { success: false };

  try {
    const about = await drive.about.get({ fields: 'user,storageQuota' });
    const email = about.data.user?.emailAddress || '';
    const quota = about.data.storageQuota;
    const usedGB = quota?.usage ? (Number(quota.usage) / 1e9).toFixed(1) : '?';
    const totalGB = quota?.limit ? (Number(quota.limit) / 1e9).toFixed(1) : 'unlimited';

    return { success: true, email, storage: `${usedGB} / ${totalGB} GB` };
  } catch (err) {
    console.error('[GoogleDrive] Test connection failed:', err);
    return { success: false };
  }
}

// ---------------------------------------------------------------------------
// Folder management
// ---------------------------------------------------------------------------

/** Find or create a folder under parentId. */
async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string | null,
  name: string
): Promise<string> {
  // Search for existing folder
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;

  const res = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });

  return folder.data.id!;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a single recording's segment files to Google Drive.
 * Structure: DSS/{cameraName}/{date}/{hour}/file.ts
 */
export async function uploadRecording(orgId: string, recordingId: string): Promise<number> {
  const drive = await getDriveClient(orgId);
  if (!drive) throw new Error('Google Drive не подключён');

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: { camera: { select: { name: true } } },
  });

  if (!recording) throw new Error('Запись не найдена');

  const segmentPath = path.join(DATA_DIR, recording.segmentDir);

  // Read segment files
  let files: string[];
  try {
    files = await readdir(segmentPath);
  } catch {
    console.warn(`[GoogleDrive] Segment dir not found: ${segmentPath}`);
    return 0;
  }

  if (files.length === 0) return 0;

  // Build folder path: DSS / CameraName / 2026-02-22 / 10
  const parts = recording.segmentDir.split('/'); // recordings/camId/date/hour
  const date = parts[2] || 'unknown-date';
  const hour = parts[3] || '00';

  const rootId = await ensureFolder(drive, null, ROOT_FOLDER_NAME);
  const cameraFolderId = await ensureFolder(drive, rootId, recording.camera.name);
  const dateFolderId = await ensureFolder(drive, cameraFolderId, date);
  const hourFolderId = await ensureFolder(drive, dateFolderId, hour);

  let uploadedCount = 0;

  for (const file of files) {
    const filePath = path.join(segmentPath, file);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) continue;

    try {
      await drive.files.create({
        requestBody: {
          name: file,
          parents: [hourFolderId],
        },
        media: {
          mimeType: file.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream',
          body: createReadStream(filePath),
        },
        fields: 'id',
      });
      uploadedCount++;
    } catch (err) {
      console.error(`[GoogleDrive] Failed to upload ${file}:`, err);
      throw err; // Stop on first failure
    }
  }

  console.log(
    `[GoogleDrive] Uploaded ${uploadedCount} file(s) for recording ${recordingId} → DSS/${recording.camera.name}/${date}/${hour}`
  );

  return uploadedCount;
}

// ---------------------------------------------------------------------------
// Drive cleanup (auto-delete when Drive fills up)
// ---------------------------------------------------------------------------

/**
 * Delete oldest files from DSS folder when Drive usage >= threshold.
 * Uses hysteresis: starts at 90%, stops at 85%.
 */
export async function cleanupDriveByUsage(orgId: string): Promise<number> {
  const drive = await getDriveClient(orgId);
  if (!drive) return 0;

  try {
    const about = await drive.about.get({ fields: 'storageQuota' });
    const quota = about.data.storageQuota;

    if (!quota?.usage || !quota?.limit) return 0;

    const usage = Number(quota.usage);
    const limit = Number(quota.limit);
    const percent = (usage / limit) * 100;

    if (percent < DRIVE_CLEANUP_THRESHOLD) return 0;

    console.log(
      `[GoogleDrive] Drive usage ${percent.toFixed(1)}% >= ${DRIVE_CLEANUP_THRESHOLD}%. Starting cleanup...`
    );

    // Find DSS root folder
    const rootRes = await drive.files.list({
      q: `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
    });

    if (!rootRes.data.files?.length) return 0;

    const rootId = rootRes.data.files[0].id!;
    let deletedCount = 0;
    const bytesToFree = usage - (limit * DRIVE_CLEANUP_TARGET) / 100;
    let freedBytes = 0;

    // List all files in DSS tree, oldest first
    let pageToken: string | undefined;
    const filesToDelete: { id: string; size: number }[] = [];

    do {
      const listRes = await drive.files.list({
        q: `'${rootId}' in parents or mimeType!='application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, size, createdTime, mimeType, parents)',
        orderBy: 'createdTime asc',
        pageSize: 100,
        pageToken,
      });

      // Collect non-folder files
      for (const file of listRes.data.files || []) {
        if (file.mimeType !== 'application/vnd.google-apps.folder') {
          filesToDelete.push({ id: file.id!, size: Number(file.size || 0) });
        }
      }

      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken && filesToDelete.length < 500);

    // Delete oldest files until we've freed enough
    for (const file of filesToDelete) {
      if (freedBytes >= bytesToFree) break;

      try {
        await drive.files.delete({ fileId: file.id });
        freedBytes += file.size;
        deletedCount++;
      } catch (err) {
        console.error(`[GoogleDrive] Failed to delete file ${file.id}:`, err);
      }
    }

    if (deletedCount > 0) {
      console.log(
        `[GoogleDrive] Drive cleanup done: deleted ${deletedCount} file(s), freed ~${(freedBytes / 1e6).toFixed(0)} MB`
      );
    }

    return deletedCount;
  } catch (err) {
    console.error('[GoogleDrive] Drive cleanup error:', err);
    return 0;
  }
}

/**
 * Run Drive cleanup for all organizations that have Google Drive connected.
 */
export async function cleanupAllDrives(): Promise<void> {
  const integrations = await prisma.integration.findMany({
    where: { type: 'google_drive', enabled: true },
    select: { organizationId: true },
  });

  for (const { organizationId } of integrations) {
    try {
      await cleanupDriveByUsage(organizationId);
    } catch (err) {
      console.error(`[GoogleDrive] Cleanup error for org ${organizationId}:`, err);
    }
  }
}
