'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './LegalModal.module.css';
import PrivacyPolicyContent, { PRIVACY_LAST_UPDATED } from './PrivacyPolicyContent';
import TermsOfServiceContent, { TERMS_LAST_UPDATED } from './TermsOfServiceContent';

const DOCS = {
  privacy: {
    title: 'Privacy Policy',
    href: '/trawl/privacypolicy',
    updated: PRIVACY_LAST_UPDATED,
    Content: PrivacyPolicyContent,
  },
  terms: {
    title: 'Terms of Service',
    href: '/trawl/termsofservice',
    updated: TERMS_LAST_UPDATED,
    Content: TermsOfServiceContent,
  },
};

// Shows the Privacy Policy or Terms of Service (the same text as the full
// pages) over the current page. Closes on the ×, Escape, or a click anywhere
// outside the dialog. Portaled to <body> so it escapes the page's stacking
// contexts and the dark-mode content overrides.
export default function LegalModal({ doc, onClose }) {
  const closeRef = useRef(null);
  const entry = DOCS[doc];

  useEffect(() => {
    if (!entry) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [entry, onClose]);

  if (!entry || typeof document === 'undefined') return null;
  const { title, href, updated, Content } = entry;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="legal-modal-title">
        <header className={styles.head}>
          <div>
            <h2 id="legal-modal-title" className={styles.title}>{title}</h2>
            <p className={styles.meta}>
              Last updated {updated} ·{' '}
              <a href={href} target="_blank" rel="noopener noreferrer">Open full page ↗</a>
            </p>
          </div>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className={styles.body}>
          <Content />
        </div>
      </div>
    </div>,
    document.body
  );
}
