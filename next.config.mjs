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
      {
        // The Discord2Playlist bot was renamed to Trawl. Keep already-issued
        // magic links working: /discord2playlist/results/:id?t=… → /trawl/…
        // (Next preserves the query string, so the token survives the redirect).
        source: '/discord2playlist/:path*',
        destination: '/trawl/:path*',
        permanent: true,
      },
      {
        source: '/discord2playlist',
        destination: '/trawl',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
