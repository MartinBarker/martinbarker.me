'use client'

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link'; // <-- Import Link
import styles from './rendertune.module.css';
const logo = '/ico/rendertune.ico';
const githubIcon = '/svg/icons8-github.svg';
const discordIcon = '/svg/discord-icon.svg';
const appleIcon = '/svg/apple-icon.svg';
const linuxIcon = '/svg/linux-icon.svg';
const windowsIcon = '/svg/windows-icon.svg';


export default function RenderTuneLayout({ children }) {

  const [menuActive, setMenuActive] = useState(false);
  const router = useRouter();

  const toggleMenu = () => {
    setMenuActive((prev) => !prev);
  };

  // This function might still be useful if you need programmatic navigation elsewhere,
  // but for simple links, <Link> is preferred.
  // const navigateHome = () => {
  //   router.push('/rendertune');
  // };


  return (
    <html lang="en">
      <head>
        <title>RenderTune</title>
        <link rel="icon" href={logo} />
      </head>
      <body style={{ margin: '0px', 'background-color': '#1c1c1c' }}>
        <div className={styles.wrapper}>
          <header className={styles.header}>
            {/* Make the entire logo container link to /rendertune */}
            <Link href="/rendertune" className={styles.logoContainer}>
                <img src={logo} alt="RenderTune Logo" className={styles.logo} />
              <div className={styles.headerTitle}>
                <h1 className={styles.mainTitle}>RenderTune</h1>
                <p className={styles.subTitle}>Video Rendering App</p>
              </div>
            </Link>

            {/* Mobile Menu Toggle */}
            <button className={styles.menuToggle} onClick={toggleMenu}>
              <span></span>
              <span></span>
              <span></span>
            </button>

            {/* Navigation Menu */}
            <nav className={`${styles.nav} ${menuActive ? styles.show : ''}`}>
              <ul className={styles.menu}>
                {/* External links still use <a> */}
                <li>
                  <div className={styles.iconContainer}>
                    <a href="https://github.com/MartinBarker/RenderTune" target="_blank" rel="noopener noreferrer">
                      <img src={githubIcon} alt="GitHub" className={styles.icon} />
                    </a>
                    <span className={styles.iconText}>GitHub Repo</span>
                  </div>
                </li>
                <li>
                  <div className={styles.iconContainer}>
                    <a href="https://discord.com/invite/pEAjDjPceY" target="_blank" rel="noopener noreferrer">
                      <img src={discordIcon} alt="Discord" className={styles.icon} />
                    </a>
                    <span className={styles.iconText}>Discord Channel</span>
                  </div>
                </li>
                {/* Internal links use <Link> */}
                <li><Link href="/rendertune/">Home</Link></li>
                <li><Link href="/rendertune/download">Download</Link></li>
                <li><Link href="/rendertune/features">Features</Link></li>
                <li><Link href="/rendertune/contribute">Contribute</Link></li>
                <li><Link href="/rendertune/support">Support</Link></li>
                <li><Link href="/rendertune/help">Help</Link></li>
                <li><Link href="/">Return</Link></li> {/* Link back to main site root */}
              </ul>
            </nav>
          </header>

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
      </body>
    </html>
  );
}