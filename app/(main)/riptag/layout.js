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
  metadataBase: new URL('https://martinbarker.me'),
  title: 'RipTag – Record Audio Splitter | Martin Barker',
  description: 'Split vinyl recordings into individual tracks, tag them with Discogs metadata, and export as tagged audio files — all in your browser.',
  keywords: 'riptag, vinyl digitizer, record splitter, vinyl to digital, audio splitter, Discogs tags, vinyl rip, music digitization, vinyl recording',
  openGraph: {
    title: 'RipTag – Record Audio Splitter',
    description: 'Split vinyl recordings into individual tracks, tag them with Discogs metadata, and export as tagged audio files — all in your browser.',
    url: 'https://martinbarker.me/riptag',
    siteName: 'Martin Barker Portfolio',
    images: [
      {
        url: 'https://martinbarker.me/images/vinyldigitizer_previewCard.jpg',
        width: 800,
        height: 600,
        alt: 'RipTag - Record Audio Splitter',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RipTag – Record Audio Splitter',
    description: 'Split vinyl recordings into individual tracks, tag them with Discogs metadata, and export as tagged audio files — all in your browser.',
    images: ['https://martinbarker.me/images/vinyldigitizer_previewCard.jpg'],
  },
};

export default function RipTagLayout({ children }) {
  return children;
}
