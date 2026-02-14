import { NextResponse } from 'next/server';

export async function GET() {
  const google = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const github = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const oidc = !!(
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET &&
    process.env.OIDC_ISSUER
  );
  const oidcName = oidc
    ? process.env.OIDC_PROVIDER_NAME || 'Corporate SSO'
    : undefined;

  return NextResponse.json({
    google,
    github,
    oidc,
    oidcName,
  });
}
