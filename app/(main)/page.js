// Server component — exports `metadata` so Next.js can render the proper
// OpenGraph / Twitter card tags. The interactive content (which needs
// useContext from ColorContext) lives in the HomeContent client component.
//
// We had to split this out because (main)/layout.js is a client component
// ('use client') — client components cannot export `metadata`. By keeping
// page.js as a server component, this route now has a full SEO preview card
// just like /listogs does (whose layout.js is also a server component).
import HomeContent from './HomeContent';

const HOME_TITLE = 'Martin Barker — Software Engineer, Vinyl Archivist';
const HOME_DESCRIPTION =
  'Seattle-based full-stack engineer, vinyl archivist and open-source contributor. ' +
  'Builds music digitization tools, Discogs utilities, and web apps for preserving and sharing music.';
const HOME_IMAGE = 'https://martinbarker.me/images/headshot.jpg';

export const metadata = {
  metadataBase: new URL('https://martinbarker.me'),
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  keywords:
    'Martin Barker, software engineer, full-stack engineer, vinyl archivist, ' +
    'open source, Seattle, music software, Discogs tools, vinyl digitizer',
  alternates: {
    canonical: 'https://martinbarker.me/',
  },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: 'https://martinbarker.me/',
    siteName: 'Martin Barker Portfolio',
    images: [
      {
        url: HOME_IMAGE,
        width: 800,
        height: 800,
        alt: 'Martin Barker — headshot',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [HOME_IMAGE],
  },
};

export default function Home() {
  return <HomeContent />;
}
