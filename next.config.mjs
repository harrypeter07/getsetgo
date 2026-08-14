/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // External packages that should not be bundled (AWS SDK uses native modules)
    serverComponentsExternalPackages: ['@aws-sdk/client-s3', 'pg'],
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.workers.dev' },
      { protocol: 'https', hostname: '*.backblazeb2.com' },
    ],
  },

  compress: true,
  poweredByHeader: false,
};

export default nextConfig;
