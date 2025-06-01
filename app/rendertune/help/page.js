export const metadata = {
  title: 'Help & Support - RenderTune',
  description: 'Get help with RenderTune, contact support, and find answers to your questions about the desktop video rendering application.',
  keywords: ['RenderTune', 'help', 'support', 'contact', 'questions', 'video rendering', 'desktop app'],
  authors: [{ name: 'Martin Barker' }],
  creator: 'Martin Barker',
  publisher: 'Martin Barker',
  robots: 'index, follow',
  canonical: 'https://martinbarker.me/rendertune/help',
  openGraph: {
    title: 'Help & Support - RenderTune',
    description: 'Get help with RenderTune, contact support, and find answers to your questions about the desktop video rendering application.',
    url: 'https://martinbarker.me/rendertune/help',
    siteName: 'Martin Barker Portfolio',
    type: 'website',
    images: [
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
    title: 'Help & Support - RenderTune',
    description: 'Get help with RenderTune, contact support, and find answers to your questions about the desktop video rendering application.',
    images: ['/images/rendertune_previewCard.png'],
    creator: '@MartinBarker99',
  },
}

export default function HelpPage() {
  return (
    <div style={{ padding: '20px', color: '#fff' }}>
      <h2>Help and Contact</h2>
      <p>If you need help or have any questions, you can contact us through the following channels:</p>
      <ul>
        <li>Email: <a href="mailto:martinbarker99@gmail.com">martinbarker99@gmail.com</a></li>
        <li>GitHub Issues: <a href="https://github.com/MartinBarker/RenderTune/issues">Report an issue</a></li>
        <li>Discord: <a href="https://discord.com/invite/pEAjDjPceY">Join our Discord channel</a></li>
      </ul>
      <p>Feel free to ping or message me directly on Discord for any urgent issues.</p>
    </div>
  )
}
