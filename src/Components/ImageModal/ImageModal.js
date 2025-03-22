import React, { useEffect } from 'react';
import styles from './ImageModal.module.css';

const ImageModal = ({ imageUrl, onClose }) => {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div className={styles.modal} onClick={onClose}>
      <button className={styles.closeModal}>&times;</button>
      <div className={styles.modalContent}>
        <img src={imageUrl} alt="Full size" className={styles.modalImage} />
      </div>
    </div>
  );
};

export default ImageModal;
