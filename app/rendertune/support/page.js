export const metadata = {
  title: 'Support RenderTune - Help & Donations',
  description: 'Support RenderTune development through donations, sponsorships, and community engagement. Get help with the desktop video rendering application.',
  keywords: ['RenderTune', 'support', 'donations', 'sponsorship', 'Ko-fi', 'Patreon', 'GitHub Sponsors', 'video rendering'],
  authors: [{ name: 'Martin Barker' }],
  creator: 'Martin Barker',
  publisher: 'Martin Barker',
  robots: 'index, follow',
  canonical: 'https://martinbarker.me/rendertune/support',
  openGraph: {
    title: 'Support RenderTune - Help & Donations',
    description: 'Support RenderTune development through donations, sponsorships, and community engagement. Get help with the desktop video rendering application.',
    url: 'https://martinbarker.me/rendertune/support',
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
    title: 'Support RenderTune - Help & Donations',
    description: 'Support RenderTune development through donations, sponsorships, and community engagement. Get help with the desktop video rendering application.',
    images: ['https://martinbarker.me/assets/martin-barker-profile.jpg'],
    creator: '@MartinBarker99',
  },
}

export default function SupportPage() {
  return (
    <div style={{ padding: '20px', color: '#fff' }}>
      <h2>Support RenderTune</h2>
      <p>If you need support, you can reach out to us through the following channels:</p>
      <ul>
        <li>Email: <a href="mailto:martinbarker99@gmail.com">martinbarker99@gmail.com</a></li>
        <li>GitHub Issues: <a href="https://github.com/MartinBarker/RenderTune/issues">Report an issue</a></li>
        <li>Discord: <a href="https://discord.com/invite/pEAjDjPceY">Join our Discord channel</a></li>
      </ul>
      <h3>Support Us</h3>
      <p>You can support the development of RenderTune through the following platforms:</p>
      <ul>
        <li><a href="https://ko-fi.com/martinradio">Ko-fi</a></li>
        <li><a href="https://www.patreon.com/c/martinradio">Patreon</a></li>
        <li><a href="https://github.com/sponsors/MartinBarker">GitHub Sponsors</a></li>
      </ul>
      <p>Supporters will get their names featured in the app!</p>
    </div>
  )
}
