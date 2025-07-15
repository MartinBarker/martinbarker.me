export const metadata = {
  metadataBase: new URL('https://martinbarker.me'),
  title: 'Listogs – Discogs List Generator | Martin Barker',
  description: 'Extract every YouTube video from a Discogs artist, label, release, or List URL, with multiple output format options 💥💥💥',
  keywords: 'Discogs list, music collection, list generator, DJ tools, music organization, Discogs management',
  openGraph: {
    title: 'Listogs – Discogs List Generator',
    description: 'Extract every YouTube video from a Discogs artist, label, release, or List URL, with multiple output format options 💥💥💥',
    url: 'https://martinbarker.me/listogs',
    siteName: 'Martin Barker Portfolio',
    images: [
      {
        url: 'https://martinbarker.me/images/listogs_previewCard.jpeg',
        width: 800,
        height: 600,
        alt: 'Listogs - Discogs List Generator',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Listogs – Discogs List Generator',
    description: 'Extract every YouTube video from a Discogs artist, label, release, or List URL, with multiple output format options 💥💥💥',
    images: ['https://martinbarker.me/images/listogs_previewCard.jpeg'],
  },
};

export default function ListogsLayout({ children }) {
  return children;
}
