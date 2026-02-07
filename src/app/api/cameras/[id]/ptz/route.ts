import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { move, getPresets, gotoPreset, type PtzDirection } from '@/lib/services/ptz-controller';

const VALID_DIRECTIONS: PtzDirection[] = [
  'up', 'down', 'left', 'right', 'zoomIn', 'zoomOut', 'stop',
];

/**
 * GET /api/cameras/[id]/ptz — List PTZ presets for the camera.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'use_ptz');
  } catch (err) {
    if (err instanceof RBACError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!camera) return notFound('Камера не найдена');

  if (!camera.hasPtz || !camera.onvifHost || !camera.onvifPort || !camera.onvifUser || !camera.onvifPass) {
    return badRequest('Камера не поддерживает PTZ или не настроены ONVIF-параметры');
  }

  try {
    const presets = await getPresets(
      camera.onvifHost,
      camera.onvifPort,
      camera.onvifUser,
      camera.onvifPass
    );
    return NextResponse.json({ presets });
  } catch (error) {
    console.error(`[PTZ] Failed to get presets for camera ${id}:`, error);
    return NextResponse.json(
      { error: 'Не удалось получить список пресетов' },
      { status: 502 }
    );
  }
}

/**
 * POST /api/cameras/[id]/ptz — Execute a PTZ action.
 *
 * Move:   { action: "move", direction: "up"|"down"|"left"|"right"|"zoomIn"|"zoomOut"|"stop", speed?: number }
 * Preset: { action: "preset", presetToken: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'use_ptz');
  } catch (err) {
    if (err instanceof RBACError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!camera) return notFound('Камера не найдена');

  if (!camera.hasPtz || !camera.onvifHost || !camera.onvifPort || !camera.onvifUser || !camera.onvifPass) {
    return badRequest('Камера не поддерживает PTZ или не настроены ONVIF-параметры');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Неверный формат JSON');
  }

  const { action } = body;

  if (action === 'move') {
    const direction = body.direction as string | undefined;
    const speed = typeof body.speed === 'number' ? body.speed : 0.5;

    if (!direction || !VALID_DIRECTIONS.includes(direction as PtzDirection)) {
      return badRequest(
        `Неверное направление. Допустимые значения: ${VALID_DIRECTIONS.join(', ')}`
      );
    }

    try {
      await move(
        camera.onvifHost,
        camera.onvifPort,
        camera.onvifUser,
        camera.onvifPass,
        direction as PtzDirection,
        speed
      );
      return NextResponse.json({ success: true, action: 'move', direction });
    } catch (error) {
      console.error(`[PTZ] Move failed for camera ${id}:`, error);
      return NextResponse.json(
        { error: 'Не удалось выполнить движение камеры' },
        { status: 502 }
      );
    }
  }

  if (action === 'preset') {
    const presetToken = body.presetToken as string | undefined;
    if (!presetToken) {
      return badRequest('Не указан presetToken');
    }

    try {
      await gotoPreset(
        camera.onvifHost,
        camera.onvifPort,
        camera.onvifUser,
        camera.onvifPass,
        presetToken
      );
      return NextResponse.json({ success: true, action: 'preset', presetToken });
    } catch (error) {
      console.error(`[PTZ] Goto preset failed for camera ${id}:`, error);
      return NextResponse.json(
        { error: 'Не удалось перейти к пресету' },
        { status: 502 }
      );
    }
  }

  return badRequest('Неизвестное действие. Допустимые: "move", "preset"');
}
