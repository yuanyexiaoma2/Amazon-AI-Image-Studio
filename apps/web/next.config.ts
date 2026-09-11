import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@studio/config', '@studio/contracts', '@studio/db'],
  serverExternalPackages: ['argon2', '@prisma/client', 'pino'],
};

export default nextConfig;
