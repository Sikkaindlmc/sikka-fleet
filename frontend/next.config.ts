import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: 'export' }),
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  ...(process.env.VERCEL
    ? {
        async headers() {
          return [
            {
              source: '/:path*',
              headers: [
                {
                  key: 'X-Content-Type-Options',
                  value: 'nosniff',
                },
                {
                  key: 'X-Frame-Options',
                  value: 'SAMEORIGIN',
                },
                {
                  key: 'Referrer-Policy',
                  value: 'strict-origin-when-cross-origin',
                },
                {
                  key: 'Permissions-Policy',
                  value: 'camera=(), microphone=(), geolocation=(self)',
                },
              ],
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;

