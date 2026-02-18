'use client'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { gifUrls } from './giphy_urls';
import styles from './giphy-gallery.module.css';

const BATCH_SIZE = 10;

// Extract filename from URL for searching
const getFilename = (url) => {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    return pathParts[pathParts.length - 1] || url;
  } catch {
    return url;
  }
};

export default function GiphyGallery() {
  const [searchQuery, setSearchQuery] = useState('');
  const [loadedGifs, setLoadedGifs] = useState([]);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: BATCH_SIZE });
  const [visibleImages, setVisibleImages] = useState(new Set());
  const [selectedGif, setSelectedGif] = useState(null);
  const sentinelRef = useRef(null);
  const imageObserverRef = useRef(null);
  const sentinelObserverRef = useRef(null);

  // Filter gifs based on search query
  const filteredGifUrls = useMemo(() => {
    if (!searchQuery.trim()) {
      return gifUrls;
    }
    const query = searchQuery.toLowerCase();
    return gifUrls.filter((url) => {
      const filename = getFilename(url);
      return filename.toLowerCase().includes(query) || url.toLowerCase().includes(query);
    });
  }, [searchQuery]);

  // Reset and initialize with first batch when search query or filtered results change
  useEffect(() => {
    const initialBatch = filteredGifUrls.slice(0, BATCH_SIZE);
    setLoadedGifs(initialBatch);
    setVisibleRange({ start: 0, end: Math.min(BATCH_SIZE, filteredGifUrls.length) });
    setVisibleImages(new Set());
  }, [searchQuery, filteredGifUrls]);

  // Intersection Observer for infinite scroll (load more batches)
  useEffect(() => {
    if (!sentinelRef.current) return;

    sentinelObserverRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setVisibleRange((prev) => {
            const newEnd = Math.min(prev.end + BATCH_SIZE, filteredGifUrls.length);
            if (newEnd > prev.end) {
              const newBatch = filteredGifUrls.slice(prev.end, newEnd);
              setLoadedGifs((prevGifs) => [...prevGifs, ...newBatch]);
              return { start: prev.start, end: newEnd };
            }
            return prev;
          });
        }
      },
      { rootMargin: '200px' }
    );

    sentinelObserverRef.current.observe(sentinelRef.current);

    return () => {
      if (sentinelObserverRef.current && sentinelRef.current) {
        sentinelObserverRef.current.unobserve(sentinelRef.current);
      }
    };
  }, [filteredGifUrls]);

  // Intersection Observer for individual images (unload when out of view)
  useEffect(() => {
    imageObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const imgId = entry.target.dataset.gifId;
          if (!imgId) return;

          if (!entry.isIntersecting) {
            // Unload image when out of view
            setVisibleImages((prev) => {
              const newSet = new Set(prev);
              newSet.delete(imgId);
              return newSet;
            });
          } else {
            // Load image when in view
            setVisibleImages((prev) => {
              const newSet = new Set(prev);
              newSet.add(imgId);
              return newSet;
            });
          }
        });
      },
      { rootMargin: '200px' }
    );

    return () => {
      if (imageObserverRef.current) {
        imageObserverRef.current.disconnect();
      }
    };
  }, []);

  // Load images by default when they're added to loadedGifs
  useEffect(() => {
    setVisibleImages((prev) => {
      const newSet = new Set(prev);
      loadedGifs.forEach((gifUrl, index) => {
        const gifId = `${gifUrl}-${index}`;
        newSet.add(gifId);
      });
      return newSet;
    });
  }, [loadedGifs.length]);

  // Ref callback for image containers
  const setImageRef = useCallback((id, ref) => {
    if (ref && imageObserverRef.current) {
      imageObserverRef.current.observe(ref);
    }
  }, []);

  // Handle GIF click to open modal
  const handleGifClick = (gifUrl) => {
    setSelectedGif(gifUrl);
  };

  // Close modal
  const closeModal = () => {
    setSelectedGif(null);
  };

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && selectedGif) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [selectedGif]);

  return (
    <div className={styles.container}>
      <div className={styles.searchContainer}>
        <input
          type="text"
          placeholder="Search gifs by filename..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
      </div>
      <div className={styles.gallery}>
        {loadedGifs.map((gifUrl, index) => {
          const gifId = `${gifUrl}-${index}`;
          const isVisible = visibleImages.has(gifId);

          return (
            <div
              key={gifId}
              className={styles.gifItem}
              data-gif-id={gifId}
              ref={(ref) => setImageRef(gifId, ref)}
              onClick={() => handleGifClick(gifUrl)}
            >
              {isVisible ? (
                <img
                  src={gifUrl}
                  alt={`GIF ${index + 1}`}
                  className={styles.gifImage}
                  loading="lazy"
                />
              ) : (
                <div className={styles.gifPlaceholder} />
              )}
            </div>
          );
        })}
      </div>
      {visibleRange.end < filteredGifUrls.length && (
        <div ref={sentinelRef} className={styles.sentinel} />
      )}
      
      {/* Modal */}
      {selectedGif && (
        <div className={styles.modal} onClick={closeModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.closeButton} onClick={closeModal}>&times;</button>
            <img
              src={selectedGif}
              alt="GIF preview"
              className={styles.modalGif}
            />
            <div className={styles.modalInfo}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Filename:</span>
                <span className={styles.infoValue}>{getFilename(selectedGif)}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>URL:</span>
                <a
                  href={selectedGif}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.infoLink}
                  onClick={(e) => e.stopPropagation()}
                >
                  {selectedGif}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
