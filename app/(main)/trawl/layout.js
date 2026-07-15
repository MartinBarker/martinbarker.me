// SEO + social-card metadata for the Trawl route (landing, legal, and results
// pages inherit this unless they export their own). Mirrors the pattern used by
// the riptag route. The routeInfo entry in (main)/layout.js injects a parallel
// set of tags for the in-app <head>; keep the two consistent.
// Title/description match the /trawl entry in (main)/routeInfo.js verbatim so
// the two metadata sources emit byte-identical tags instead of near-duplicates.
const TITLE = 'Trawl - Turn a Discord channel into a YouTube playlist';
const DESCRIPTION =
  'Trawl is a Discord bot that reads every music link shared in a channel and turns them into a single YouTube playlist — with one slash command.';
const OG_IMAGE = 'https://martinbarker.me/images/discord2playlist-icons/groove-app-icon-512.png';

export const metadata = {
  metadataBase: new URL('https://martinbarker.me'),
  title: TITLE,
  description: DESCRIPTION,
  keywords:
    'trawl, discord to youtube, discord playlist bot, discord music bot, youtube playlist, discord bot, music links, playlist automation',
  alternates: {
    canonical: 'https://martinbarker.me/trawl',
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://martinbarker.me/trawl',
    siteName: 'Trawl',
    images: [
      {
        url: OG_IMAGE,
        width: 512,
        height: 512,
        alt: 'Trawl — Discord to YouTube playlist bot',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function TrawlLayout({ children }) {
  return children;
}
