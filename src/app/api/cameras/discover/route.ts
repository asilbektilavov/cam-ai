import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { discoverCameras } from '@/lib/services/network-scanner';
import { checkPermission, RBACError } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  try {
    const cameras = await discoverCameras();
    return NextResponse.json(cameras);
  } catch (error) {
    console.error('Camera discovery error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
