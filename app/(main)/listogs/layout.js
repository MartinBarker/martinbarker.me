export const metadata = {
  metadataBase: new URL('https://martinbarker.me'),
  title: 'Listogs – Discogs List Generator | Martin Barker',
  description: 'Generate and manage Discogs lists easily with Listogs. Perfect for collectors, DJs, and music enthusiasts who want to organize their Discogs collections.',
  keywords: 'Discogs list, music collection, list generator, DJ tools, music organization, Discogs management',
  openGraph: {
    title: 'Listogs – Discogs List Generator',
    description: 'Generate and manage Discogs lists easily. Perfect for collectors, DJs, and music enthusiasts.',
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
    description: 'Generate and manage Discogs lists easily. Perfect for collectors and DJs.',
    images: ['https://martinbarker.me/images/listogs_previewCard.jpeg'],
  },
};

export default function ListogsLayout({ children }) {
  return children;
}
