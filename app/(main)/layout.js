'use client'
import React from 'react';
import styles from './layout.module.css';
import { usePathname } from 'next/navigation';
import { getRouteInfo } from './routeInfo';
import SiteShell from './SiteShell/SiteShell';

export default function RootLayout({ children }) {
  const pathname = usePathname(); // get current path

  // The /trawl pages ship their own self-contained "paper" light design and
  // have no dark variant, so the global dark-mode overrides (which force white
  // text on content) make them unreadable. Opt these routes out entirely — they
  // always render their own readable styling regardless of the site theme.
  const isTrawlRoute = pathname?.startsWith('/trawl');

  // Get route info from shared module
  const { title: pageTitle, subtitle: pageSubTitle, tabTitle, icon: pageIcon, description: pageDescription, ogImage: pageOgImage, ogUrl: pageOgUrl } = getRouteInfo(pathname);
  const resolvedOgTitle = tabTitle || pageTitle || 'Martin Barker';
  const resolvedOgImage = pageOgImage ? (pageOgImage.startsWith('http') ? pageOgImage : `https://martinbarker.me${pageOgImage}`) : null;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{tabTitle || pageTitle || "Martin Barker"}</title>
        <link rel="icon" href={pageIcon} />
        <link rel="shortcut icon" href={pageIcon} />
        <meta name="google-site-verification" content="gDJG6R2M9ZdQ8t8SHYpzGW8Pq433BC0D-JlwXkvurxE" />
        {pageDescription && <meta name="description" content={pageDescription} />}
        <meta property="og:title" content={resolvedOgTitle} />
        {pageDescription && <meta property="og:description" content={pageDescription} />}
        {resolvedOgImage && <meta property="og:image" content={resolvedOgImage} />}
        {pageOgUrl && <meta property="og:url" content={pageOgUrl} />}
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content={resolvedOgImage ? "summary_large_image" : "summary"} />
        <meta name="twitter:title" content={resolvedOgTitle} />
        {pageDescription && <meta name="twitter:description" content={pageDescription} />}
        {resolvedOgImage && <meta name="twitter:image" content={resolvedOgImage} />}
      </head>
      {/* , width: 'fit-content' */}
      <body style={{ margin: '0px' }}>
        {/* The sidebar, its state and ColorContext live in SiteShell so the
            RenderTune layout can render exactly the same sidebar. */}
        <SiteShell>
          {({ sidebarActive, isMobile, darkMode, colors }) => (
            <main
              className={`${styles.content} ${sidebarActive && isMobile ? styles.pushed : ''} ${darkMode && !isTrawlRoute ? `${styles.darkContent} darkContent` : ''}`}
              style={{ background: darkMode ? colors.DarkMuted : colors.LightMuted }}
            >
              <div className={styles.contentWrapper}>
                <div className={styles.contentBody}>{children}</div>
              </div>
            </main>
          )}
        </SiteShell>
      </body>
    </html>
  );
}
