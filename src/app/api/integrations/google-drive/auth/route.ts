import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import {
  getAuthUrl,
  handleCallback,
  getStatus,
  disconnect,
  saveOAuthCredentials,
  hasOAuthCredentials,
} from '@/lib/services/google-drive';

function getRedirectUri(req: NextRequest): string {
  // Auto-detect redirect URI from request
  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const host = req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}/api/integrations/google-drive/auth`;
}

/** GET — handle OAuth redirect or return auth URL. */
export async function GET(req: NextRequest) {
  // Check for OAuth callback (code in query params) — no session check needed here
  // because Google redirects back without cookies sometimes
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  if (code && state) {
    try {
      await handleCallback(state, code, getRedirectUri(req));
      return NextResponse.redirect(new URL('/integrations?gdrive=connected', req.url));
    } catch (err) {
      console.error('[GoogleDrive] OAuth callback error:', err);
      return NextResponse.redirect(new URL('/integrations?gdrive=error', req.url));
    }
  }

  // Generate auth URL — requires session
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_integrations');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  try {
    const url = await getAuthUrl(session.user.organizationId, getRedirectUri(req));
    return NextResponse.json({ url });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : 'Failed to generate auth URL');
  }
}

/** POST — get status or save OAuth credentials. */
export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_integrations');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const orgId = session.user.organizationId;

  // If clientId/clientSecret provided, save them
  if (body.clientId && body.clientSecret) {
    await saveOAuthCredentials(orgId, body.clientId, body.clientSecret);
    return NextResponse.json({ success: true });
  }

  // Otherwise return status
  const status = await getStatus(orgId);
  const configured = await hasOAuthCredentials(orgId);
  return NextResponse.json({ ...status, configured });
}

/** DELETE — disconnect Google Drive. */
export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_integrations');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  await disconnect(session.user.organizationId);
  return NextResponse.json({ success: true });
}
