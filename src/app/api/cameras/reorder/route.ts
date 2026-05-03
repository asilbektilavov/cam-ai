import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';

// POST /api/cameras/reorder
// Body: { order: ["camera-id-1", "camera-id-2", ...] }
// Persists drag-and-drop ordering of camera cards on the /cameras page.
export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const order = body?.order;
  if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
    return badRequest('order must be an array of camera ids');
  }

  // Update in a single transaction so the new ordering is atomic — half-
  // applied orderings would briefly show cards in confusing positions.
  await prisma.$transaction(
    order.map((id, idx) =>
      prisma.camera.updateMany({
        where: { id, organizationId: session.user.organizationId },
        data: { displayOrder: idx },
      })
    )
  );

  return NextResponse.json({ success: true, count: order.length });
}
