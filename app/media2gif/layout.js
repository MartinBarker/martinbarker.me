export const metadata = {
  title: 'Media2Gif — Turn any film into a wall of perfectly tagged GIFs',
  icons: {
    icon: [
      { url: '/ico/media2gif.ico' },
      { url: '/ico/media2gif_icon.png', type: 'image/png' },
    ],
    shortcut: '/ico/media2gif.ico',
  },
};

export default function Media2GifLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
