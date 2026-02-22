/**
 * Integrity Build — генерация манифеста целостности при сборке Docker-образа.
 *
 * Считает SHA-256 всех критичных файлов, шифрует манифест
 * случайным ключом и записывает результат в protection/integrity-manifest.enc.
 * Ключ вшивается в integrity-check.js (который потом обфусцируется).
 *
 * Запуск: node protection/integrity-build.js (в Dockerfile)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DIR = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'integrity-manifest.enc');
const CHECK_SCRIPT = path.join(__dirname, 'integrity-check.js');

// Files and patterns to protect
const CRITICAL_PATTERNS = [
  'server.js',
  'protection/hardware-guard.js',
];

// Also include all server chunks and API routes
const CRITICAL_DIRS = [
  '.next/server/chunks',
  '.next/server/app/api',
];

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function findFiles(dir, results = []) {
  const fullDir = path.join(APP_DIR, dir);
  if (!fs.existsSync(fullDir)) return results;

  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    const relPath = path.relative(APP_DIR, fullPath);
    if (entry.isDirectory()) {
      findFiles(relPath, results);
    } else if (entry.name.endsWith('.js')) {
      results.push(relPath);
    }
  }
  return results;
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function main() {
  console.log('[INTEGRITY-BUILD] Generating integrity manifest...');

  // Collect all critical files
  const files = [...CRITICAL_PATTERNS];
  for (const dir of CRITICAL_DIRS) {
    findFiles(dir, files);
  }

  // Calculate hashes
  const manifest = {};
  let count = 0;
  for (const relPath of files) {
    const fullPath = path.join(APP_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      manifest[relPath] = hashFile(fullPath);
      count++;
    }
  }

  console.log(`[INTEGRITY-BUILD] Hashed ${count} files.`);

  // Generate random encryption key
  const key = crypto.randomBytes(32);
  const keyHex = key.toString('hex');

  // Encrypt manifest
  const plaintext = JSON.stringify(manifest);
  const encrypted = encrypt(plaintext, key);
  fs.writeFileSync(MANIFEST_PATH, encrypted);

  // Inject key into integrity-check.js
  let checkScript = fs.readFileSync(CHECK_SCRIPT, 'utf8');
  checkScript = checkScript.replace(
    /const MANIFEST_KEY = '[^']*';/,
    `const MANIFEST_KEY = '${keyHex}';`
  );
  fs.writeFileSync(CHECK_SCRIPT, checkScript);

  console.log(`[INTEGRITY-BUILD] Manifest encrypted. Key injected into integrity-check.js.`);
  console.log('[INTEGRITY-BUILD] Done.');
}

main();
