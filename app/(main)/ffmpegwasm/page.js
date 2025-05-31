export const metadata = {
  title: 'FFmpeg WASM – Browser-Based Video Processing | Martin Barker',
  description: 'Process videos directly in your browser with FFmpeg WASM. No uploads required - all processing happens locally for privacy and speed.',
  keywords: 'FFmpeg, WASM, WebAssembly, video processing, browser video editor, client-side video, video conversion, multimedia tools',
  openGraph: {
    title: 'FFmpeg WASM – Browser-Based Video Processing',
    description: 'Process videos directly in your browser with FFmpeg WASM. No uploads required - all processing happens locally.',
    url: 'https://martinbarker.me/ffmpegwasm',
    siteName: 'Martin Barker Portfolio',
    images: [
      {
        url: 'https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg',
        width: 800,
        height: 600,
        alt: 'Martin Barker - FFmpeg WASM Project',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FFmpeg WASM – Browser Video Processing',
    description: 'Process videos directly in your browser with FFmpeg WASM. No uploads required - all processing happens locally.',
    images: ['https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg'],
  },
};

export default function ffmpegwasm() {
    return (
        <div>
          <h1>ffmpegwasm</h1>
        </div>
    );
}