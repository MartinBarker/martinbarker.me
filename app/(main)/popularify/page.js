import Head from 'next/head';

export default function popularify() {
  return (
    <>
      <Head>
        <title>Popularify – Spotify Discography Sorted by Popularity | Martin Barker</title>
        <meta name="description" content="Discover an artist's complete Spotify catalog ordered by popularity with Popularify. Find hidden gems and popular tracks in one organized view." />
        <meta name="keywords" content="Spotify, discography, popularity, music discovery, artist catalog, Spotify API, music sorting, track popularity" />
        <meta name="author" content="Martin Barker" />
        <meta property="og:title" content="Popularify – Spotify Discography Sorted by Popularity" />
        <meta property="og:description" content="Fetch an artist's full Spotify catalog ordered by popularity. Discover hidden gems and popular tracks in one organized view." />
        <meta property="og:image" content="https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg" />
        <meta property="og:url" content="https://martinbarker.me/popularify" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Martin Barker Portfolio" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Popularify – Spotify Discography Sorted" />
        <meta name="twitter:description" content="Fetch an artist's full Spotify catalog ordered by popularity. Find hidden gems and popular tracks." />
        <meta name="twitter:image" content="https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg" />
        <link rel="canonical" href="https://martinbarker.me/popularify" />
      </Head>
      <div>
        <h1>popularify</h1>
      </div>
    </>
  );
}