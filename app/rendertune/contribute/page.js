export const metadata = {
  title: 'Contribute to RenderTune - Open Source Development',
  description: 'Contribute to RenderTune open source project. Learn how to fork, clone, and submit pull requests for the desktop video rendering application.',
  keywords: ['RenderTune', 'contribute', 'open source', 'GitHub', 'pull request', 'fork', 'development', 'video rendering'],
  authors: [{ name: 'Martin Barker' }],
  creator: 'Martin Barker',
  publisher: 'Martin Barker',
  robots: 'index, follow',
  canonical: 'https://martinbarker.me/rendertune/contribute',
  openGraph: {
    title: 'Contribute to RenderTune - Open Source Development',
    description: 'Contribute to RenderTune open source project. Learn how to fork, clone, and submit pull requests for the desktop video rendering application.',
    url: 'https://martinbarker.me/rendertune/contribute',
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
    title: 'Contribute to RenderTune - Open Source Development',
    description: 'Contribute to RenderTune open source project. Learn how to fork, clone, and submit pull requests for the desktop video rendering application.',
    images: ['https://martinbarker.me/assets/martin-barker-profile.jpg'],
    creator: '@MartinBarker99',
  },
}

export default function ContributePage() {
  return (
    <div style={{ padding: '20px', color: '#fff' }}>
      <h2>Contribute to RenderTune</h2>
      <p>We welcome contributions from the community! Here&apos;s how you can contribute:</p>
      <ol>
        <li>Fork the repository on GitHub.</li>
        <li>Clone your forked repository to your local machine.</li>
        <li>Make your changes and commit them with clear commit messages.</li>
        <li>Push your changes to your forked repository.</li>
        <li>Open a pull request on the main repository.</li>
      </ol>
      <p>Don&apos;t miss your chance to contribute!</p>
      <p>For detailed instructions, please refer to the <a href="https://github.com/MartinBarker/RenderTune">GitHub repository</a>.</p>
    </div>
  )
}
