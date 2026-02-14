/**
 * Plate Service Manager — auto-starts plate-service as a child process
 * when an LPR camera begins monitoring.
 *
 * Uses process-level singleton to survive Turbopack HMR.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const PLATE_SERVICE_URL = process.env.PLATE_SERVICE_URL || 'http://localhost:8003';
const PLATE_SERVICE_DIR = path.join(process.cwd(), 'plate-service');
const VENV_PYTHON = path.join(PLATE_SERVICE_DIR, 'venv', 'bin', 'python');

const SINGLETON_KEY = '__plateServiceManager_v1';

class PlateServiceManager {
  private process: ChildProcess | null = null;
  private starting = false;
  private ready = false;

  /**
   * Ensure plate-service is running. Starts it if not.
   * Returns true if service is ready, false if failed.
   */
  async ensureRunning(): Promise<boolean> {
    // Already running?
    if (await this.healthCheck()) {
      this.ready = true;
      return true;
    }

    // Already starting?
    if (this.starting) {
      return this.waitForReady(15000);
    }

    // Check prerequisites
    if (!fs.existsSync(VENV_PYTHON)) {
      console.error(
        '[plate-service] venv not found. Run: cd plate-service && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt'
      );
      return false;
    }

    if (!fs.existsSync(path.join(PLATE_SERVICE_DIR, 'main.py'))) {
      console.error('[plate-service] main.py not found in', PLATE_SERVICE_DIR);
      return false;
    }

    // Start the service
    this.starting = true;
    this.ready = false;

    try {
      console.log('[plate-service] Starting...');

      this.process = spawn(VENV_PYTHON, ['main.py'], {
        cwd: PLATE_SERVICE_DIR,
        env: {
          ...process.env,
          CAM_AI_API_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Log stdout/stderr
      this.process.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log('[plate-service]', line);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log('[plate-service:err]', line);
      });

      this.process.on('exit', (code) => {
        console.log('[plate-service] Exited with code', code);
        this.process = null;
        this.ready = false;
        this.starting = false;
      });

      this.process.on('error', (err) => {
        console.error('[plate-service] Process error:', err.message);
        this.process = null;
        this.ready = false;
        this.starting = false;
      });

      // Wait for health check to pass
      const ok = await this.waitForReady(20000);
      this.starting = false;
      return ok;
    } catch (e) {
      console.error('[plate-service] Failed to start:', e);
      this.starting = false;
      return false;
    }
  }

  private async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${PLATE_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.healthCheck()) {
        this.ready = true;
        console.log('[plate-service] Ready');
        return true;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error('[plate-service] Timeout waiting for service to start');
    return false;
  }

  /**
   * Stop the plate-service if running.
   */
  stop() {
    if (this.process) {
      console.log('[plate-service] Stopping...');
      this.process.kill('SIGTERM');
      this.process = null;
      this.ready = false;
    }
  }
}

// Singleton via process object (survives Turbopack HMR)
function getManager(): PlateServiceManager {
  const p = process as unknown as Record<string, PlateServiceManager>;
  if (!p[SINGLETON_KEY]) {
    p[SINGLETON_KEY] = new PlateServiceManager();
  }
  return p[SINGLETON_KEY];
}

export const plateServiceManager = getManager();
