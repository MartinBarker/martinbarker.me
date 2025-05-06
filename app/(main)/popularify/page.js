import Head from 'next/head';

export default function popularify() {
  return (
    <>
      <Head>
        <title>Popularify – Spotify Discography Sorted</title>
        <meta property="og:title" content="Popularify – Spotify Discography Sorted by Popularity" />
        <meta property="og:description" content="Fetch an artist’s full Spotify catalog ordered by popularity." />
        <meta property="og:image" content="https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg" />
        <meta property="og:url" content="https://martinbarker.me/popularify" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <div>
        <h1>popularify</h1>
      </div>
    </>
  );
}