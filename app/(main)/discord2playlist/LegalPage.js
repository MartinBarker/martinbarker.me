/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import styles from './discord2playlist.module.css';

const INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=1444823985215901865&permissions=67584&integration_type=0&scope=bot+applications.commands';
const APP_ICON = '/images/discord2playlist-icons/groove-app-icon-512.png';

// Shared chrome (nav + footer) for the discord2playlist legal pages so the
// Terms and Privacy pages stay visually consistent with the landing page.
export default function LegalPage({ kicker, title, lastUpdated, children }) {
  return (
    <div className={styles.page} id="top">
      <nav className={styles.nav}>
        <div className={`${styles.wrap} ${styles.navInner}`}>
          <Link className={styles.brand} href="/discord2playlist">
            <img src={APP_ICON} alt="discord2playlist icon" />
            <span className={styles.bname}>discord2playlist</span>
          </Link>
          <div className={styles.navLinks}>
            <Link className={styles.lnk} href="/discord2playlist">Home</Link>
            <a className={`${styles.btn} ${styles.btnPrimary}`} href={INVITE_URL} target="_blank" rel="noopener noreferrer">Invite the bot</a>
          </div>
        </div>
      </nav>

      <main className={styles.legalMain}>
        <div className={styles.wrap}>
          <header className={styles.legalHead}>
            {kicker ? <p className={styles.legalKicker}>{kicker}</p> : null}
            <h1 className={styles.legalTitle}>{title}</h1>
            {lastUpdated ? <p className={styles.legalUpdated}>Last updated: {lastUpdated}</p> : null}
          </header>

          <article className={styles.legalBody}>
            {children}
          </article>

          <Link className={styles.backLink} href="/discord2playlist">← Back to discord2playlist</Link>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footInner}`}>
          <div className={styles.footBrand}>
            <img src={APP_ICON} alt="" />
            <span className={styles.bname}>discord2playlist</span>
          </div>
          <div className={styles.footMeta}>Discord → YouTube playlist bot · open source</div>
        </div>
      </footer>
    </div>
  );
}
