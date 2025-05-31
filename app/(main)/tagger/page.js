export const metadata = {
  title: 'tagger.site – Timestamped Tracklists Generator | Martin Barker',
  description: 'Automatically generate timestamped tracklists from audio files with tagger.site. Perfect for DJs, podcasters, and music enthusiasts who need precise track timing.',
  keywords: 'timestamped tracklist, audio analysis, track detection, DJ tools, podcast timestamps, music tagging, audio processing',
  openGraph: {
    title: 'tagger.site – Generate Timestamped Tracklists',
    description: 'Automatically generate timestamped tracklists from audio files. Perfect for DJs, podcasters, and music enthusiasts.',
    url: 'https://martinbarker.me/tagger',
    siteName: 'Martin Barker Portfolio',
    images: [
      {
        url: 'https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg',
        width: 800,
        height: 600,
        alt: 'Martin Barker - tagger.site Project',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'tagger.site – Timestamped Tracklists Generator',
    description: 'Automatically generate timestamped tracklists from audio files. Perfect for DJs and podcasters.',
    images: ['https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg'],
  },
};

export default function tagger() {
  return (
    <div>
      <h1>tagger page contents</h1>
    </div>
  );
}