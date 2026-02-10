/**
 * Singleton service for on-premise licensing.
 * Generates, validates, and activates license keys.
 * License data is persisted to data/license.json.
 *
 * License key format: CAMAI-XXXXX-XXXXX-XXXXX-XXXXX (base36 encoded segments).
 * Editions: "starter" (max 20 cameras), "professional" (max 100), "enterprise" (unlimited).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const LICENSE_FILE = path.join(process.cwd(), 'data', 'license.json');

export type LicenseEdition = 'starter' | 'professional' | 'enterprise';

const EDITION_LIMITS: Record<LicenseEdition, number> = {
  starter: 20,
  professional: 100,
  enterprise: Infinity,
};

export interface LicenseData {
  key: string;
  org: string;
  maxCameras: number;
  edition: LicenseEdition;
  expiresAt: string; // ISO date
  createdAt: string; // ISO date
  activatedAt: string | null; // ISO date
  instanceId: string | null; // Unique ID for the activated instance
  checksum: string; // HMAC to verify integrity
}

export interface LicenseValidationResult {
  valid: boolean;
  reason?: string;
  org?: string;
  maxCameras?: number;
  edition?: LicenseEdition;
  expiresAt?: Date;
  camerasUsed?: number;
}

export interface LicenseInfo {
  key: string;
  org: string;
  maxCameras: number;
  edition: LicenseEdition;
  expiresAt: Date;
  activatedAt: Date | null;
  instanceId: string | null;
  isExpired: boolean;
  daysRemaining: number;
}

// Secret used for HMAC checksum (in production, use an env var)
const LICENSE_SECRET = process.env.LICENSE_SECRET || 'camai-license-secret-2026';

class LicenseManager {
  private static instance: LicenseManager;

  /** In-memory cache of all known licenses (loaded from file). */
  private licenses = new Map<string, LicenseData>();

  /** The currently active license key for this instance. */
  private activeLicenseKey: string | null = null;

  /** Current camera count callback (set externally). */
  private cameraCountFn: (() => Promise<number>) | null = null;

  private constructor() {
    this.loadFromDisk();
  }

  static getInstance(): LicenseManager {
    if (!LicenseManager.instance) {
      LicenseManager.instance = new LicenseManager();
    }
    return LicenseManager.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Generate a new license key.
   */
  generateLicenseKey(
    org: string,
    maxCameras: number,
    edition: string,
    expiresAt: Date
  ): string {
    const editionTyped = this.parseEdition(edition);
    const effectiveMax = Math.min(maxCameras, EDITION_LIMITS[editionTyped]);

    const key = this.createKey();
    const now = new Date();

    const license: LicenseData = {
      key,
      org,
      maxCameras: effectiveMax,
      edition: editionTyped,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      activatedAt: null,
      instanceId: null,
      checksum: '', // Will be computed below
    };

    license.checksum = this.computeChecksum(license);
    this.licenses.set(key, license);
    this.saveToDisk();

    console.log(
      `[LicenseManager] Generated license: ${key} | org=${org} edition=${editionTyped} cameras=${effectiveMax} expires=${expiresAt.toISOString()}`
    );

    return key;
  }

  /**
   * Validate a license key.
   * Returns detailed validation info including current camera usage.
   */
  async validateLicense(key: string): Promise<LicenseValidationResult> {
    const license = this.licenses.get(key);
    if (!license) {
      return { valid: false, reason: 'License key not found' };
    }

    // Verify checksum integrity
    const expectedChecksum = this.computeChecksum(license);
    if (license.checksum !== expectedChecksum) {
      return { valid: false, reason: 'License integrity check failed' };
    }

    // Check expiration
    const expiresAt = new Date(license.expiresAt);
    if (expiresAt < new Date()) {
      return {
        valid: false,
        reason: 'License has expired',
        org: license.org,
        maxCameras: license.maxCameras,
        edition: license.edition,
        expiresAt,
      };
    }

    // Get current camera count
    let camerasUsed = 0;
    if (this.cameraCountFn) {
      try {
        camerasUsed = await this.cameraCountFn();
      } catch {
        // If we can't count cameras, still report the license as valid
      }
    }

    return {
      valid: true,
      org: license.org,
      maxCameras: license.maxCameras,
      edition: license.edition,
      expiresAt,
      camerasUsed,
    };
  }

  /**
   * Activate a license for this instance.
   * Only one license can be active at a time.
   */
  async activateLicense(key: string): Promise<{ success: boolean; message: string }> {
    const validation = await this.validateLicense(key);
    if (!validation.valid) {
      return { success: false, message: validation.reason || 'Invalid license' };
    }

    const license = this.licenses.get(key)!;

    // Generate a unique instance ID if not already activated
    const instanceId = license.instanceId || this.generateInstanceId();

    license.activatedAt = new Date().toISOString();
    license.instanceId = instanceId;
    license.checksum = this.computeChecksum(license);

    this.activeLicenseKey = key;
    this.saveToDisk();

    console.log(
      `[LicenseManager] Activated license ${key} for instance ${instanceId}`
    );

    return {
      success: true,
      message: `License activated for ${license.org} (${license.edition}, max ${license.maxCameras} cameras)`,
    };
  }

  /**
   * Get information about the currently active license.
   */
  getLicenseInfo(): LicenseInfo | null {
    if (!this.activeLicenseKey) return null;

    const license = this.licenses.get(this.activeLicenseKey);
    if (!license) return null;

    const expiresAt = new Date(license.expiresAt);
    const now = new Date();
    const isExpired = expiresAt < now;
    const daysRemaining = isExpired
      ? 0
      : Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    return {
      key: license.key,
      org: license.org,
      maxCameras: license.maxCameras,
      edition: license.edition,
      expiresAt,
      activatedAt: license.activatedAt ? new Date(license.activatedAt) : null,
      instanceId: license.instanceId,
      isExpired,
      daysRemaining,
    };
  }

  /**
   * Check if the current active license allows adding more cameras.
   * Returns true if under the camera limit, false otherwise.
   */
  async checkCameraLimit(): Promise<boolean> {
    if (!this.activeLicenseKey) {
      // No license active — deny by default
      return false;
    }

    const license = this.licenses.get(this.activeLicenseKey);
    if (!license) return false;

    // Check expiration
    if (new Date(license.expiresAt) < new Date()) return false;

    // Enterprise edition has no limit
    if (license.edition === 'enterprise') return true;

    // Count current cameras
    if (!this.cameraCountFn) return true; // Can't check, allow by default

    try {
      const count = await this.cameraCountFn();
      return count < license.maxCameras;
    } catch {
      return true; // On error, allow gracefully
    }
  }

  /**
   * Register a function that returns the current camera count.
   * This allows the license manager to check limits without importing Prisma directly.
   */
  setCameraCountProvider(fn: () => Promise<number>): void {
    this.cameraCountFn = fn;
  }

  /**
   * Deactivate the current license.
   */
  deactivateLicense(): void {
    if (this.activeLicenseKey) {
      console.log(`[LicenseManager] Deactivated license ${this.activeLicenseKey}`);
      this.activeLicenseKey = null;
      this.saveToDisk();
    }
  }

  /**
   * List all known licenses.
   */
  listLicenses(): LicenseData[] {
    return Array.from(this.licenses.values());
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Generate a license key in format: CAMAI-XXXXX-XXXXX-XXXXX-XXXXX
   * Each segment is 5 chars of base36 (0-9, A-Z).
   */
  private createKey(): string {
    const segments: string[] = [];
    for (let i = 0; i < 4; i++) {
      const bytes = crypto.randomBytes(4);
      const num = bytes.readUInt32BE(0);
      // Convert to base36 and pad to 5 chars
      const segment = num.toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
      segments.push(segment);
    }
    return `CAMAI-${segments.join('-')}`;
  }

  private generateInstanceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private parseEdition(edition: string): LicenseEdition {
    const lower = edition.toLowerCase();
    if (lower === 'starter' || lower === 'professional' || lower === 'enterprise') {
      return lower as LicenseEdition;
    }
    return 'starter'; // Default fallback
  }

  /**
   * Compute HMAC-SHA256 checksum for license integrity verification.
   */
  private computeChecksum(license: LicenseData): string {
    const payload = `${license.key}|${license.org}|${license.maxCameras}|${license.edition}|${license.expiresAt}|${license.createdAt}|${license.activatedAt || ''}|${license.instanceId || ''}`;
    return crypto
      .createHmac('sha256', LICENSE_SECRET)
      .update(payload)
      .digest('hex');
  }

  /**
   * Load licenses from data/license.json.
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(LICENSE_FILE)) return;

      const raw = fs.readFileSync(LICENSE_FILE, 'utf-8');
      const data = JSON.parse(raw) as {
        licenses: LicenseData[];
        activeLicenseKey: string | null;
      };

      if (Array.isArray(data.licenses)) {
        for (const license of data.licenses) {
          this.licenses.set(license.key, license);
        }
      }

      this.activeLicenseKey = data.activeLicenseKey || null;

      console.log(
        `[LicenseManager] Loaded ${this.licenses.size} license(s) from disk` +
          (this.activeLicenseKey ? ` (active: ${this.activeLicenseKey})` : '')
      );
    } catch (error) {
      console.warn('[LicenseManager] Failed to load license file:', (error as Error).message);
    }
  }

  /**
   * Persist licenses to data/license.json.
   */
  private saveToDisk(): void {
    try {
      const dir = path.dirname(LICENSE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        licenses: Array.from(this.licenses.values()),
        activeLicenseKey: this.activeLicenseKey,
      };

      fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.warn('[LicenseManager] Failed to save license file:', (error as Error).message);
    }
  }
}

const globalForLicense = globalThis as unknown as {
  licenseManager: LicenseManager | undefined;
};

export const licenseManager =
  globalForLicense.licenseManager ?? LicenseManager.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForLicense.licenseManager = licenseManager;
