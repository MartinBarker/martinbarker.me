'use client';
import Link from 'next/link';
import styles from './SiteFooter.module.css';
import YouTubeIcon from '../YouTubeAuth/YouTubeIcon';

// Site-wide footer: legal links plus the YouTube API Services notice. YouTube's
// audit asks for the homepage to show where the Privacy Policy link is, with
// YouTube branding visible — this is that spot on every page.
export default function SiteFooter({ darkMode = false }) {
  return (
    <footer className={styles.footer} data-theme={darkMode ? 'dark' : 'light'}>
      <div className={styles.youtube}>
        <a href="https://www.youtube.com" target="_blank" rel="noopener noreferrer" className={styles.ytLink}>
          <YouTubeIcon height={18} />
        </a>
        <span>
          <Link href="/listogs">Listogs</Link>, <Link href="/riptag">RipTag</Link> and{' '}
          <Link href="/trawl">Trawl</Link> use YouTube API Services. Not affiliated with or endorsed by YouTube or Google.
        </span>
      </div>
      <nav className={styles.links} aria-label="Legal">
        <Link href="/trawl/privacypolicy">Privacy Policy</Link>
        <span aria-hidden="true">·</span>
        <Link href="/trawl/termsofservice">Terms of Service</Link>
        <span aria-hidden="true">·</span>
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>
        <span aria-hidden="true">·</span>
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>
      </nav>
      <p className={styles.copy}>© {new Date().getFullYear()} Martin Barker</p>
    </footer>
  );
}
