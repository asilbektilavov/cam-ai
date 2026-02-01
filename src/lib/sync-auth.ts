import { NextRequest, NextResponse } from 'next/server';

export function verifySyncKey(req: NextRequest): NextResponse | null {
  if (process.env.INSTANCE_ROLE !== 'central') {
    return NextResponse.json(
      { error: 'This instance is not configured as central' },
      { status: 400 }
    );
  }

  const syncKey = req.headers.get('x-sync-key');
  if (!syncKey || syncKey !== process.env.SYNC_KEY) {
    return NextResponse.json(
      { error: 'Invalid sync key' },
      { status: 401 }
    );
  }

  return null;
}
