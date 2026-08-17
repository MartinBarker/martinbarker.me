/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useState } from 'react';
import styles from './ImageModal.module.css';

/**
 * Full-size image viewer.
 *
 * `imageUrl` is the original, which can be several MB. `placeholderUrl` is the
 * already-cached sidebar thumbnail — it paints instantly so the modal is never
 * blank, then the full-resolution image replaces it once decoded.
 */
const ImageModal = ({ imageUrl, placeholderUrl, onClose }) => {
  const [fullLoaded, setFullLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Reset when the modal is reused for a different image.
  useEffect(() => { setFullLoaded(false); setFailed(false); }, [imageUrl]);

  const showPlaceholder = !!placeholderUrl && !fullLoaded && !failed;

  return (
    <div className={styles.modal} onClick={onClose}>
      <button className={styles.closeModal} aria-label="Close">&times;</button>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.imageStack}>
          {showPlaceholder && (
            <img
              src={placeholderUrl}
              alt=""
              aria-hidden="true"
              className={`${styles.modalImage} ${styles.placeholderImage}`}
            />
          )}
          <img
            src={imageUrl}
            alt="Full size"
            className={styles.modalImage}
            style={{ opacity: fullLoaded || failed ? 1 : 0 }}
            onLoad={() => setFullLoaded(true)}
            // If the original is missing, fall back to the placeholder rather
            // than leaving an empty modal.
            onError={(e) => {
              if (placeholderUrl && e.target.src !== placeholderUrl) {
                e.target.src = placeholderUrl;
              }
              setFailed(true);
            }}
          />
        </div>
        {showPlaceholder && <span className={styles.loadingNote}>Loading full size…</span>}
      </div>
    </div>
  );
};

export default ImageModal;
