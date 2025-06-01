export const metadata = {
  title: 'tagger.site – Timestamped Tracklists Generator | Martin Barker',
  description: 'Automatically generate timestamped tracklists from audio files with tagger.site. Perfect for DJs, podcasters, and music enthusiasts who need precise track timing.',
  keywords: 'timestamped tracklist, audio analysis, track detection, DJ tools, podcast timestamps, music tagging, audio processing',  openGraph: {
    title: 'tagger.site – Generate Timestamped Tracklists',
    description: 'Automatically generate timestamped tracklists from audio files. Perfect for DJs, podcasters, and music enthusiasts.',
    url: 'https://martinbarker.me/tagger',    siteName: 'Martin Barker Portfolio',
    images: [
      {
        url: 'https://martinbarker.me/images/taggerDotSite_previewCard.jpeg',
        width: 800,
        height: 600,
        alt: 'tagger.site - Timestamped Tracklist Generator',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'tagger.site – Timestamped Tracklists Generator',
    description: 'Automatically generate timestamped tracklists from audio files. Perfect for DJs and podcasters.',
    images: ['https://martinbarker.me/images/taggerDotSite_previewCard.jpeg'],
  },
};

export default function tagger() {
  return (
    <div>
      <h1>tagger page contents</h1>
    </div>
  );
}