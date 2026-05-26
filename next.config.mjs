/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    globalNotFound: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
