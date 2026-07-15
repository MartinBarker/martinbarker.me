// This page is a heavy 'use client' editor (FFmpeg-wasm, IndexedDB,
// drag-drop, lots of refs/state) and doesn't benefit from SSR HTML. We had a
// production crash where the SWC minifier failed to rename certain useState
// bindings (`allAudioFiles`, `audioDurations`) in a handful of closure
// references inside recently-added helpers — the declaration's setter was
// renamed, but the getter references in those spots stayed as the original
// identifier, which then resolved to nothing at runtime
// (`ReferenceError: allAudioFiles is not defined`). The state bindings were
// renamed in source to sidestep the minifier's per-identifier tracking bug
// (now `droppedAudioFiles` / `audioDurationMap`). Keeping `force-dynamic`
// also means the failing build-time prerender pass is skipped — but the
// underlying bundle is now correct for runtime SSR too.
export const dynamic = 'force-dynamic';

export const metadata = {
  metadataBase: new URL('https://riptag.app'),
  title: 'RipTag – Record Audio Splitter | riptag.app',
  description: 'RipTag (riptag.app) splits your record recordings into individual tracks, tags them with Discogs metadata, and exports tagged audio files — all in your browser.',
  keywords: 'riptag, riptag.app, record splitter, audio splitter, track splitter, Discogs tags, record rip, music digitization, audio tagging',
  alternates: {
    canonical: 'https://riptag.app',
  },
  openGraph: {
    title: 'RipTag – Record Audio Splitter | riptag.app',
    description: 'RipTag (riptag.app) splits your record recordings into individual tracks, tags them with Discogs metadata, and exports tagged audio files — all in your browser.',
    url: 'https://riptag.app',
    siteName: 'RipTag',
    images: [
      {
        url: 'https://martinbarker.me/images/vinyldigitizer_previewCard.jpg',
        width: 800,
        height: 600,
        alt: 'RipTag – Record Audio Splitter (riptag.app)',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RipTag – Record Audio Splitter | riptag.app',
    description: 'RipTag (riptag.app) splits your record recordings into individual tracks, tags them with Discogs metadata, and exports tagged audio files — all in your browser.',
    images: ['https://martinbarker.me/images/vinyldigitizer_previewCard.jpg'],
  },
};

export default function RipTagLayout({ children }) {
  return children;
}
