export const metadata = {
  title: 'Download RenderTune - Free Desktop Video Rendering App',
  description: 'Download RenderTune for Windows, macOS, and Linux. Free desktop application for rendering videos from audio files with multiple format support.',
  keywords: ['RenderTune', 'download', 'Windows', 'macOS', 'Linux', 'desktop app', 'video rendering', 'free', 'Mac App Store', 'Microsoft Store'],
  authors: [{ name: 'Martin Barker' }],
  creator: 'Martin Barker',
  publisher: 'Martin Barker',
  robots: 'index, follow',
  canonical: 'https://martinbarker.me/rendertune/download',
  openGraph: {
    title: 'Download RenderTune - Free Desktop Video Rendering App',
    description: 'Download RenderTune for Windows, macOS, and Linux. Free desktop application for rendering videos from audio files with multiple format support.',
    url: 'https://martinbarker.me/rendertune/download',
    siteName: 'Martin Barker Portfolio',
    type: 'website',
    images: [
      {
        url: 'https://martinbarker.me/assets/martin-barker-profile.jpg',
        width: 800,
        height: 600,
        alt: 'Martin Barker - Software Developer',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Download RenderTune - Free Desktop Video Rendering App',
    description: 'Download RenderTune for Windows, macOS, and Linux. Free desktop application for rendering videos from audio files with multiple format support.',
    images: ['https://martinbarker.me/assets/martin-barker-profile.jpg'],
    creator: '@MartinBarker99',
  },
}

export default function DownloadPage() {
  return (
    <div style={{ padding: '20px', color: '#fff' }}>
      <h2>Download RenderTune</h2>
      <p>Download the latest version of RenderTune for your operating system:</p>
      <ul>
        <li><a href="https://github.com/MartinBarker/RenderTune/releases/latest">Windows</a></li>
        <li><a href="https://github.com/MartinBarker/RenderTune/releases/latest">macOS (Intel)</a></li>
        <li><a href="https://github.com/MartinBarker/RenderTune/releases/latest">macOS (Apple Silicon)</a></li>
        <li><a href="https://github.com/MartinBarker/RenderTune/releases/latest">Linux</a></li>
      </ul>
      <p>Or download from the app stores:</p>
      <ul>
        <li><a href="https://apps.apple.com/app/id123456789">Mac App Store</a></li>
        <li><a href="https://www.microsoft.com/store/apps/9NBLGGH4NNS1">Microsoft Store</a></li>
        <li><a href="https://snapcraft.io/render-tune">Snap Store</a></li>
      </ul>
    </div>
  )
}
