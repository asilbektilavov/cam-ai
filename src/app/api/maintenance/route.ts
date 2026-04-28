import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

// Tiny file-based maintenance flag. Anyone can GET to know whether a
// maintenance banner should show. Only an authenticated admin can set/clear it.
const FLAG_PATH = path.join(process.cwd(), 'data', 'maintenance.json');

interface MaintenanceState {
  active: boolean;
  message: string;
  startedAt?: string;
}

async function read(): Promise<MaintenanceState> {
  try {
    const raw = await readFile(FLAG_PATH, 'utf-8');
    return JSON.parse(raw) as MaintenanceState;
  } catch {
    return { active: false, message: '' };
  }
}

async function write(state: MaintenanceState): Promise<void> {
  await mkdir(path.dirname(FLAG_PATH), { recursive: true });
  await writeFile(FLAG_PATH, JSON.stringify(state), 'utf-8');
}

export async function GET() {
  const state = await read();
  return NextResponse.json(state, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const active = !!body.active;
  const message =
    typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'Идёт техническое обслуживание — некоторые камеры могут временно не отображаться';
  const state: MaintenanceState = active
    ? { active: true, message, startedAt: new Date().toISOString() }
    : { active: false, message: '' };
  await write(state);
  return NextResponse.json(state);
}
