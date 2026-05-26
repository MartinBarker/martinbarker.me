// Opt this route out of build-time static prerendering. The page is a heavy
// 'use client' editor (FFmpeg-wasm, IndexedDB, drag-drop, lots of refs/state)
// that doesn't benefit from SSR HTML — and Next.js's prerender pass was
// throwing `ReferenceError: allAudioFiles is not defined` from the server
// bundle (the production minifier appears to hoist a closure helper out of
// the React component scope during prerender, breaking access to useState
// variables). Marking the layout dynamic skips that failing build-time pass;
// the page still renders correctly at request time / on the client.
export const dynamic = 'force-dynamic';

export const metadata = {
  metadataBase: new URL('https://martinbarker.me'),
  title: 'Vinyl Digitizer – Record Audio Splitter | Martin Barker',
  description: 'Split vinyl recordings into individual tracks, tag them with Discogs metadata, and export as tagged audio files — all in your browser.',
  keywords: 'vinyl digitizer, record splitter, vinyl to digital, audio splitter, Discogs tags, vinyl rip, music digitization, vinyl recording',
  openGraph: {
    title: 'Vinyl Digitizer – Record Audio Splitter',
    description: 'Split vinyl recordings into individual tracks, tag them with Discogs metadata, and export as tagged audio files — all in your browser.',
    url: 'https://martinbarker.me/vinyl-digitizer',
    siteName: 'Martin Barker Portfolio',
    images: [
      {
        url: 'https://martinbarker.me/images/vinyldigitizer_previewCard.jpg',
        width: 800,
        height: 600,
        alt: 'Vinyl Digitizer - Record Audio Splitter',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vinyl Digitizer – Record Audio Splitter',
    description: 'Split vinyl recordings into individual tracks, tag them with Discogs metadata, and export as tagged audio files — all in your browser.',
    images: ['https://martinbarker.me/images/vinyldigitizer_previewCard.jpg'],
  },
};

export default function VinylDigitizerLayout({ children }) {
  return children;
}
