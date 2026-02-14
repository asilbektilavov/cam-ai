import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ['sharp'],
  experimental: {
    turbo: {
      unstable_exclude: ['attendance-service/venv/**', 'detection-service/venv/**'],
    },
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: securityHeaders,
    },
    {
      // Allow HLS streaming with proper headers
      source: '/api/cameras/:id/stream/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Access-Control-Allow-Origin', value: '*' },
      ],
    },
    {
      // Archive segments can be cached
      source: '/api/cameras/:id/archive/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=86400' },
        { key: 'Access-Control-Allow-Origin', value: '*' },
      ],
    },
  ],
};

export default nextConfig;
