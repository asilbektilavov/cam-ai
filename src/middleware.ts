export { auth as middleware } from '@/lib/auth';

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/cameras/:path*',
    '/analytics/:path*',
    '/integrations/:path*',
    '/settings/:path*',
    '/select-venue/:path*',
  ],
};
