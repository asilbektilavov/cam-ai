import { auth } from './auth';
import { NextResponse } from 'next/server';

export async function getAuthSession() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return session;
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function parseRemoteBranchId(branchId: string | null): {
  isRemote: boolean;
  localBranchId: string | null;
  remoteInstanceId: string | null;
} {
  if (!branchId) return { isRemote: false, localBranchId: null, remoteInstanceId: null };
  if (branchId.startsWith('remote:')) {
    return { isRemote: true, localBranchId: null, remoteInstanceId: branchId.slice(7) };
  }
  return { isRemote: false, localBranchId: branchId, remoteInstanceId: null };
}
