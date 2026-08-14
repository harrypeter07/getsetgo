/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@aws-sdk/client-s3', 'pg'],
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.workers.dev' },
      { protocol: 'https', hostname: '*.backblazeb2.com' },
    ],
  },

  eslint: {
    // Prevent ESLint warnings from failing production builds on Vercel
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: false,
  },

  compress: true,
  poweredByHeader: false,
};

export default nextConfig;
