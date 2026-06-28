/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    globalNotFound: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      {
        // The Vinyl Digitizer tool was renamed to RipTag. Preserve the old
        // route (and any existing bookmarks/links) with a permanent redirect.
        source: '/vinyl-digitizer',
        destination: '/riptag',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
