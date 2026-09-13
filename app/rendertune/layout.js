'use client'

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Download, Sparkles, HeartHandshake, LifeBuoy, HelpCircle, Github } from 'lucide-react';
import styles from './rendertune.module.css';
import SiteShell from '../(main)/SiteShell/SiteShell';
const logo = '/ico/rendertune.ico';

// RenderTune's pages, shown in a static bar at the top of every RenderTune
// route. When the bar is too narrow for the labels they are dropped and only
// the icons remain; the icons are never hidden (they wrap instead).
const NAV_LINKS = [
  { href: '/rendertune', label: 'Home', icon: Home },
  { href: '/rendertune/download', label: 'Download', icon: Download },
  { href: '/rendertune/features', label: 'Features', icon: Sparkles },
  { href: '/rendertune/contribute', label: 'Contribute', icon: HeartHandshake },
  { href: '/rendertune/support', label: 'Support', icon: LifeBuoy },
  { href: '/rendertune/help', label: 'Help', icon: HelpCircle },
  { href: 'https://github.com/MartinBarker/RenderTune', label: 'GitHub Repo', icon: Github, external: true },
];

function RenderTuneNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.rtNav} aria-label="RenderTune">
      <ul className={styles.rtNavList}>
        {NAV_LINKS.map(({ href, label, icon: Icon, external }) => {
          const active = !external && (pathname === href || pathname === `${href}/`);
          const className = `${styles.rtNavLink} ${active ? styles.rtNavActive : ''}`;
          // title + aria-label keep each icon identifiable once its label is hidden.
          const content = (
            <>
              <Icon className={styles.rtNavIcon} size={18} aria-hidden="true" />
              <span className={styles.rtNavLabel}>{label}</span>
            </>
          );
          return (
            <li key={href}>
              {external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={label} aria-label={label}>
                  {content}
                </a>
              ) : (
                <Link href={href} className={className} title={label} aria-label={label} aria-current={active ? 'page' : undefined}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function RenderTuneLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>RenderTune</title>
        <link rel="icon" href={logo} />
      </head>
      <body style={{ margin: '0px', backgroundColor: '#1c1c1c' }}>
        {/* The same sidebar as the rest of the site, with RenderTune's own
            pages in a static bar at the top of the content. */}
        <SiteShell>
          {() => (
            <div className={styles.shellContent}>
              <div className={styles.wrapper}>
                <RenderTuneNav />
                {children}

                <footer className={styles.footer}>
                  <p>© 2025 RenderTune. All rights reserved.</p>
                  <div className={styles.footerLinks}>
                    {/* External links remain <a> tags */}
                    <a href="https://github.com/MartinBarker/RenderTune/releases" target="_blank" rel="noopener noreferrer">
                      <img src="https://img.shields.io/github/v/release/MartinBarker/RenderTune" alt="GitHub Release Version" />
                    </a>
                    <a href="https://github.com/MartinBarker/RenderTune" target="_blank" rel="noopener noreferrer">
                      <img src="https://img.shields.io/github/followers/MartinBarker?style=social" alt="GitHub Followers" />
                    </a>
                    <a href="https://ko-fi.com/martinradio" target="_blank" rel="noopener noreferrer">
                      Ko-fi
                    </a>
                    <a href="https://www.patreon.com/c/martinradio" target="_blank" rel="noopener noreferrer">
                      Patreon
                    </a>
                    <a href="https://github.com/sponsors/MartinBarker" target="_blank" rel="noopener noreferrer">
                      GitHub Sponsors
                    </a>
                  </div>
                </footer>
              </div>
            </div>
          )}
        </SiteShell>
      </body>
    </html>
  );
}
