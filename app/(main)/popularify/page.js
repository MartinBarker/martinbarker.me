export const metadata = {
  title: 'Popularify – Spotify Discography Sorted by Popularity | Martin Barker',
  description: 'Discover an artist\'s complete Spotify catalog ordered by popularity with Popularify. Find hidden gems and popular tracks in one organized view.',
  keywords: 'Spotify, discography, popularity, music discovery, artist catalog, Spotify API, music sorting, track popularity',
  openGraph: {
    title: 'Popularify – Spotify Discography Sorted by Popularity',
    description: 'Fetch an artist\'s full Spotify catalog ordered by popularity. Discover hidden gems and popular tracks in one organized view.',
    url: 'https://martinbarker.me/popularify',
    siteName: 'Martin Barker Portfolio',    images: [
      {
        url: '/images/headshot.jpg',
        width: 800,
        height: 600,
        alt: 'Martin Barker - Popularify Project',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Popularify – Spotify Discography Sorted',
    description: 'Fetch an artist\'s full Spotify catalog ordered by popularity. Find hidden gems and popular tracks.',
    images: ['/images/headshot.jpg'],
  },
};

export default function popularify() {
  return (
    <div>
      <h1>popularify</h1>
    </div>
  );
}