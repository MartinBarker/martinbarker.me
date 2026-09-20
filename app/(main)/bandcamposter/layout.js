// force-dynamic for the same reason as /riptag: the page is a heavy
// 'use client' renderer (FFmpeg-wasm, canvas, object URLs) that gains nothing
// from a prerender pass.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Bandcamp Poster - Bandcamp track to vertical video',
  description:
    'Turn a Bandcamp track into a 1080x1920 video: cover art over a blurred or '
    + 'flat backdrop, rendered in your browser with FFmpeg.wasm.',
  alternates: { canonical: 'https://martinbarker.me/bandcamposter' },
  openGraph: {
    title: 'Bandcamp Poster - Bandcamp track to vertical video',
    description:
      'Turn a Bandcamp track into a 1080x1920 video, rendered in your browser.',
    url: 'https://martinbarker.me/bandcamposter',
    type: 'website',
  },
};

export default function BandcamposterLayout({ children }) {
  return children;
}
