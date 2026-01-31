import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { testConnection } from '@/lib/services/motion-detector';

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const { streamUrl } = body;

  if (!streamUrl) {
    return badRequest('streamUrl is required');
  }

  const result = await testConnection(streamUrl);

  return NextResponse.json(result);
}
