import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rbac';
import { licenseManager } from '@/lib/services/license-manager';

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'manage_settings');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const info = licenseManager.getLicenseInfo();

  if (!info) {
    return NextResponse.json({
      valid: false,
      message: 'Лицензия не активирована',
      edition: null,
      maxCameras: 0,
      camerasUsed: 0,
      organization: null,
      expiresAt: null,
      key: null,
    });
  }

  return NextResponse.json({
    valid: !info.isExpired,
    edition: info.edition,
    maxCameras: info.maxCameras,
    camerasUsed: 0, // Will be populated when cameraCountProvider is set
    organization: info.org,
    expiresAt: info.expiresAt.toISOString(),
    key: info.key.replace(/(.{5})-(.{5})-(.{5})-(.{5})$/, 'XXXXX-XXXXX-XXXXX-$4'),
    daysRemaining: info.daysRemaining,
    instanceId: info.instanceId,
    message: info.isExpired ? 'Лицензия истекла' : 'Лицензия активна',
  });
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'manage_settings');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { key } = await request.json();
    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'Ключ лицензии обязателен' }, { status: 400 });
    }

    const result = await licenseManager.activateLicense(key);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    const info = licenseManager.getLicenseInfo();

    return NextResponse.json({
      valid: true,
      edition: info?.edition,
      maxCameras: info?.maxCameras,
      camerasUsed: 0,
      organization: info?.org,
      expiresAt: info?.expiresAt.toISOString(),
      message: result.message,
    });
  } catch {
    return NextResponse.json({ error: 'Ошибка активации' }, { status: 500 });
  }
}
