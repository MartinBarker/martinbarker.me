'use client';
import { useCallback, useState } from 'react';
import styles from './YouTubeAuthPanel.module.css';
import YouTubeIcon from './YouTubeIcon';
import LegalModal from '../legal/LegalModal';

const GOOGLE_PERMISSIONS = 'https://security.google.com/settings/security/permissions';

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
      d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      d="m8.8 12 2.2 2.2 4.2-4.4" />
  </svg>
);

const DocIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
      d="M6 3h8l4 4v14H6z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      d="M14 3v4h4M9 12h6M9 16h6" />
  </svg>
);

// The one YouTube sign-in box used by Listogs, RipTag (steps 1 and 5) and the
// Trawl results page, so all three look and behave the same. It is purely
// presentational: the caller owns the auth state and passes handlers in —
// martinbarker.me pages via <YouTubeAuth compact>, Trawl via the bot's API.
//
// status: 'signedIn' | 'signedOut' | 'checking' | 'invalid'
export default function YouTubeAuthPanel({
  status,
  accountName,
  hint,
  invalidTitle = 'Your YouTube sign-in is no longer valid',
  invalidDetail,
  onSignIn,
  signInLoading = false,
  signInDisabled = false,
  onSignOut,
  signOutBusy = false,
  signOutDisabled = false,
  extraActions,
  error,
  darkMode = false,
  children,
}) {
  const [legalDoc, setLegalDoc] = useState(null);
  const closeLegal = useCallback(() => setLegalDoc(null), []);

  const signedIn = status === 'signedIn';
  const statusText = {
    signedIn: accountName ? `Signed in as ${accountName}` : 'Signed in to YouTube',
    checking: 'Checking your YouTube sign-in…',
    invalid: invalidTitle,
    signedOut: 'Not signed in to YouTube',
  }[status] || 'Not signed in to YouTube';

  return (
    <div className={styles.panel} data-theme={darkMode ? 'dark' : 'light'}>
      <div className={styles.head}>
        <div className={styles.brand}>
          <YouTubeIcon height={18} />
          <span className={styles.brandText}>YouTube account</span>
        </div>
        <div className={styles.legal}>
          <button type="button" className={styles.legalBtn} onClick={() => setLegalDoc('privacy')}>
            <ShieldIcon />
            <span>Privacy Policy</span>
          </button>
          <button type="button" className={styles.legalBtn} onClick={() => setLegalDoc('terms')}>
            <DocIcon />
            <span>Terms of Service</span>
          </button>
        </div>
      </div>

      {hint && <p className={styles.hint}>{hint}</p>}

      <div className={styles.status} data-status={status}>
        <span className={styles.dot} aria-hidden="true" />
        <span>{statusText}</span>
      </div>
      {status === 'invalid' && invalidDetail && <p className={styles.detail}>{invalidDetail}</p>}

      <div className={styles.actions}>
        {!signedIn && status !== 'checking' && (
          <button type="button" className={styles.signIn} onClick={onSignIn}
            disabled={signInDisabled || signInLoading}>
            {signInLoading ? 'Loading…' : status === 'invalid' ? 'Sign in again' : 'Sign in with YouTube'}
          </button>
        )}
        {extraActions}
        {(signedIn || status === 'invalid') && onSignOut && (
          <button type="button" className={styles.signOut} onClick={onSignOut}
            disabled={signOutBusy || signOutDisabled}
            title="Sign out: revokes this app's access at Google and clears the stored sign-in">
            {signOutBusy ? 'Signing out…' : 'Sign out & reset'}
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.note}>
        Uses YouTube API Services. Requests one permission, to manage your YouTube videos and playlists.
        Revoke it any time in your{' '}
        <a href={GOOGLE_PERMISSIONS} target="_blank" rel="noopener noreferrer">Google Account settings</a>.
      </p>

      {children}

      {legalDoc && <LegalModal doc={legalDoc} onClose={closeLegal} />}
    </div>
  );
}
