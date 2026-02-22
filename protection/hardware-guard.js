/**
 * Hardware Guard — привязка софта к железу.
 *
 * Собирает hardware ID из:
 *   - /etc/machine-id
 *   - /sys/class/dmi/id/product_uuid (x86)
 *   - /proc/cpuinfo Serial (ARM / Orange Pi)
 *
 * Первый запуск: хеширует → шифрует AES-256-GCM ключом,
 * производным от самого hardware ID → сохраняет data/.hwprint.
 *
 * Последующие запуски: пересчитывает hardware ID → пытается
 * расшифровать .hwprint → если не получается → exit(1).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HWPRINT_PATH = path.join(__dirname, '..', 'data', '.hwprint');
const SALT = 'camai-hw-bind-v1';

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function getCpuSerial() {
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const match = cpuinfo.match(/^Serial\s*:\s*(\S+)/m);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function collectHardwareId() {
  const machineId = readFileSafe('/etc/machine-id');
  const productUuid = readFileSafe('/sys/class/dmi/id/product_uuid');
  const cpuSerial = getCpuSerial();

  const parts = [machineId, productUuid, cpuSerial].filter(Boolean);

  if (parts.length === 0) {
    console.error('[HARDWARE-GUARD] FATAL: Cannot read any hardware identifiers.');
    console.error('  Ensure /etc/machine-id or /sys/class/dmi/id/product_uuid is accessible.');
    process.exit(1);
  }

  return parts.join('|');
}

function deriveKey(hardwareId) {
  return crypto.createHmac('sha256', SALT).update(hardwareId).digest();
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(16) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data, key) {
  const iv = data.subarray(0, 16);
  const tag = data.subarray(16, 32);
  const ciphertext = data.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
}

function main() {
  console.log('[HARDWARE-GUARD] Checking hardware binding...');

  const hardwareId = collectHardwareId();
  const hwHash = crypto.createHash('sha256').update(hardwareId).digest('hex');
  const key = deriveKey(hardwareId);

  if (!fs.existsSync(HWPRINT_PATH)) {
    // First run — create hwprint
    console.log('[HARDWARE-GUARD] First run detected. Binding to this hardware...');

    const payload = JSON.stringify({
      hash: hwHash,
      bound_at: new Date().toISOString(),
      version: 1,
    });

    const encrypted = encrypt(payload, key);

    // Ensure data directory exists
    const dataDir = path.dirname(HWPRINT_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(HWPRINT_PATH, encrypted);
    console.log('[HARDWARE-GUARD] OK — Hardware fingerprint saved.');
    return;
  }

  // Subsequent run — verify
  try {
    const encrypted = fs.readFileSync(HWPRINT_PATH);
    const decrypted = decrypt(encrypted, key);
    const payload = JSON.parse(decrypted);

    if (payload.hash !== hwHash) {
      throw new Error('Hash mismatch');
    }

    console.log('[HARDWARE-GUARD] OK — Hardware matches.');
  } catch (err) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════╗');
    console.error('║              HARDWARE MISMATCH DETECTED                 ║');
    console.error('╠══════════════════════════════════════════════════════════╣');
    console.error('║  This software is bound to specific hardware.           ║');
    console.error('║  It cannot be copied to a different server.             ║');
    console.error('║                                                         ║');
    console.error('║  Contact support if you need to migrate.                ║');
    console.error('╚══════════════════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
  }
}

main();
