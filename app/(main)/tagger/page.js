import Head from 'next/head';

export default function tagger() {
  return (
    <>
      <Head>
        <title>tagger.site – Timestamped Tracklists</title>
        <meta property="og:title" content="tagger.site – Generate Timestamped Tracklists" />
        <meta property="og:description" content="Automatically generate timestamped tracklists from audio files." />
        <meta property="og:image" content="https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg" />
        <meta property="og:url" content="https://martinbarker.me/tagger" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <div>
        <h1>tagger page contents</h1>
      </div>
    </>
  );
}