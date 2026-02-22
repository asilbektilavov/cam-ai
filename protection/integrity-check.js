/**
 * Integrity Check — проверка целостности файлов при запуске.
 *
 * Расшифровывает манифест (integrity-manifest.enc) ключом,
 * вшитым сюда при сборке, и сверяет SHA-256 каждого файла.
 *
 * Ключ ниже заменяется integrity-build.js при сборке,
 * а потом весь этот файл обфусцируется (Layer 2).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// This key is injected by integrity-build.js at build time
const MANIFEST_KEY = 'PLACEHOLDER_KEY_WILL_BE_REPLACED_AT_BUILD_TIME';

const APP_DIR = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'integrity-manifest.enc');

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function decrypt(data, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = data.subarray(0, 16);
  const tag = data.subarray(16, 32);
  const ciphertext = data.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
}

function main() {
  console.log('[INTEGRITY-CHECK] Verifying file integrity...');

  if (MANIFEST_KEY === 'PLACEHOLDER_KEY_WILL_BE_REPLACED_AT_BUILD_TIME') {
    console.error('[INTEGRITY-CHECK] ERROR: Manifest key not injected. Build error.');
    process.exit(1);
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('[INTEGRITY-CHECK] ERROR: Integrity manifest not found.');
    process.exit(1);
  }

  let manifest;
  try {
    const encrypted = fs.readFileSync(MANIFEST_PATH);
    const decrypted = decrypt(encrypted, MANIFEST_KEY);
    manifest = JSON.parse(decrypted);
  } catch (err) {
    console.error('[INTEGRITY-CHECK] ERROR: Cannot decrypt manifest. Files may be tampered.');
    process.exit(1);
  }

  const files = Object.keys(manifest);
  let violations = 0;

  for (const relPath of files) {
    const fullPath = path.join(APP_DIR, relPath);

    if (!fs.existsSync(fullPath)) {
      console.error(`[INTEGRITY-CHECK] MISSING: ${relPath}`);
      violations++;
      continue;
    }

    const currentHash = hashFile(fullPath);
    if (currentHash !== manifest[relPath]) {
      console.error(`[INTEGRITY-CHECK] TAMPERED: ${relPath}`);
      violations++;
    }
  }

  if (violations > 0) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════╗');
    console.error('║            INTEGRITY VIOLATION DETECTED                 ║');
    console.error('╠══════════════════════════════════════════════════════════╣');
    console.error(`║  ${violations} file(s) have been modified or removed.${' '.repeat(Math.max(0, 17 - String(violations).length))}║`);
    console.error('║  The application cannot start with tampered files.      ║');
    console.error('║                                                         ║');
    console.error('║  Reinstall the application from the original image.     ║');
    console.error('╚══════════════════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
  }

  console.log(`[INTEGRITY-CHECK] OK — ${files.length} files verified.`);
}

main();
