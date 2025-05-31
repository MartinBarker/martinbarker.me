export const metadata = {
  title: 'RenderTune Features - Desktop Video Rendering',
  description: 'Discover RenderTune features: render videos from audio files, drag-and-drop functionality, multiple format support, batch processing, and more.',
  keywords: ['RenderTune', 'features', 'video rendering', 'audio to video', 'mp3', 'wav', 'flac', 'batch processing', 'desktop app'],
  authors: [{ name: 'Martin Barker' }],
  creator: 'Martin Barker',
  publisher: 'Martin Barker',
  robots: 'index, follow',  canonical: 'https://martinbarker.me/rendertune/features',
  openGraph: {
    title: 'RenderTune Features - Desktop Video Rendering',
    description: 'Discover RenderTune features: render videos from audio files, drag-and-drop functionality, multiple format support, batch processing, and more.',
    url: 'https://martinbarker.me/rendertune/features',
    siteName: 'Martin Barker Portfolio',
    type: 'website',    images: [
      {
        url: '/images/rendertune_previewCard.png',
        width: 800,
        height: 600,
        alt: 'RenderTune - Desktop Video Rendering App',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RenderTune Features - Desktop Video Rendering',
    description: 'Discover RenderTune features: render videos from audio files, drag-and-drop functionality, multiple format support, batch processing, and more.',
    images: ['/images/rendertune_previewCard.png'],
    creator: '@MartinBarker99',
  },
}

export default function FeaturesPage() {
  return (
    <div style={{ padding: '20px', color: '#fff' }}>
      <h2>RenderTune Features</h2>
      <ul>
        <li>Render videos from a single audio file or combine multiple audio files in a specific order.</li>
        <li>Set the output video resolution and choose your desired output location.</li>
        <li>Add black or white padding to adjust the image frame.</li>
        <li>Easily select files with intuitive drag-and-drop functionality.</li>
        <li>Process multiple videos at once with customizable settings for each render.</li>
        <li>Supports popular audio formats (mp3, wav, flac, etc.) and image formats (png, jpg, webp), output as mp4.</li>
      </ul>
    </div>
  )
}
