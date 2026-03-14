'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import styles from './color-review.module.css';

// ---- Filename helpers (mirrors layout.js) ----
function sanitizeFilename(filename) {
  return filename
    .replace(/['"]/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w\-_.]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
function getThumbnailPath(filename) {
  const noExt = filename.replace(/\.[^/.]+$/, '');
  return `/images/aesthetic-images/thumbnails/${sanitizeFilename(noExt)}-thumbnail.jpg`;
}
function getImagePath(filename) {
  return `/images/aesthetic-images/images/${filename}`;
}

// ---- Color contrast helper ----
function textColor(hex) {
  if (!hex) return '#000';
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 125 ? '#000' : '#fff';
}

const COLOR_KEYS = ['Vibrant', 'LightVibrant', 'DarkVibrant', 'Muted', 'LightMuted', 'DarkMuted'];
const COLOR_LABELS = {
  Vibrant: 'Vibrant (sidebar bg)',
  LightVibrant: 'Light Vibrant',
  DarkVibrant: 'Dark Vibrant (menu bg)',
  Muted: 'Muted',
  LightMuted: 'Light Muted (content bg)',
  DarkMuted: 'Dark Muted (header bg)',
};

export default function ColorReviewPage() {
  const [images, setImages] = useState([]);        // full list
  const [filtered, setFiltered] = useState([]);    // after filter
  const [filterMode, setFilterMode] = useState('all');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentColors, setCurrentColors] = useState(null);
  const [originalColors, setOriginalColors] = useState(null);
  const [darkSwapped, setDarkSwapped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [jumpTo, setJumpTo] = useState('');
  const [status, setStatus] = useState('');
  const [imgError, setImgError] = useState(false);
  const jumpRef = useRef(null);

  // Load colors.json once
  useEffect(() => {
    fetch('/images/aesthetic-images/colors.json')
      .then(r => r.json())
      .then(data => {
        const list = Object.entries(data).map(([filename, val]) => ({
          filename,
          colors: { ...val.colors },
          reviewed: val.reviewed || false,
          mode: val.mode || 'light',
        }));
        setImages(list);
      })
      .catch(err => setStatus('Failed to load colors.json: ' + err.message));
  }, []);

  // Apply filter
  useEffect(() => {
    let f;
    if (filterMode === 'unreviewed') f = images.filter(i => !i.reviewed);
    else if (filterMode === 'reviewed') f = images.filter(i => i.reviewed);
    else f = images;
    setFiltered(f);
    setCurrentIdx(prev => Math.min(prev, Math.max(0, f.length - 1)));
  }, [images, filterMode]);

  const current = filtered[currentIdx];

  // Reset working colors when navigating
  useEffect(() => {
    if (!current) return;
    const c = { ...current.colors };
    setCurrentColors(c);
    setOriginalColors(c);
    setDarkSwapped(false);
    setImgError(false);
    setStatus('');
  }, [currentIdx, filtered]);

  const reviewedCount = images.filter(i => i.reviewed).length;

  // Update local images state after save
  const patchLocalImages = (filename, patch) => {
    setImages(prev => prev.map(img =>
      img.filename === filename ? { ...img, ...patch } : img
    ));
  };

  // API call helper
  const apiPatch = async (body) => {
    const res = await fetch('/api/colors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
  };

  // ---- Actions ----
  const saveColors = async (alsoReview = false) => {
    if (!current) return;
    setSaving(true);
    try {
      await apiPatch({
        filename: current.filename,
        colors: currentColors,
        ...(alsoReview ? { reviewed: true } : {}),
      });
      patchLocalImages(current.filename, {
        colors: { ...currentColors },
        ...(alsoReview ? { reviewed: true } : {}),
      });
      setOriginalColors({ ...currentColors });
      setStatus(alsoReview ? '✅ Saved & marked reviewed' : '✅ Colors saved');
      if (alsoReview) setTimeout(goNext, 500);
    } catch (err) {
      setStatus('❌ ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const markReviewed = async (reviewed = true) => {
    if (!current) return;
    setSaving(true);
    try {
      await apiPatch({ filename: current.filename, reviewed });
      patchLocalImages(current.filename, { reviewed });
      setStatus(reviewed ? '✅ Marked as reviewed' : '↩ Unmarked');
      if (reviewed) setTimeout(goNext, 300);
    } catch (err) {
      setStatus('❌ ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const rerollColors = async () => {
    if (!current || rerolling) return;
    setRerolling(true);
    setStatus('🎲 Extracting colors from image…');
    try {
      // Dynamic import of browser-compatible Vibrant
      const mod = await import('node-vibrant/browser');
      const VibrantClass = mod.default?.Vibrant || mod.Vibrant || mod.default;
      const v = new VibrantClass(getImagePath(current.filename));
      const palette = await v.getPalette();
      const newColors = {
        Vibrant: palette.Vibrant?.hex || currentColors.Vibrant,
        LightVibrant: palette.LightVibrant?.hex || currentColors.LightVibrant,
        DarkVibrant: palette.DarkVibrant?.hex || currentColors.DarkVibrant,
        Muted: palette.Muted?.hex || currentColors.Muted,
        LightMuted: palette.LightMuted?.hex || currentColors.LightMuted,
        DarkMuted: palette.DarkMuted?.hex || currentColors.DarkMuted,
      };
      setCurrentColors(newColors);
      setDarkSwapped(false);
      setStatus('🎲 Colors re-extracted!');
    } catch (err) {
      setStatus('❌ Reroll failed: ' + err.message);
    } finally {
      setRerolling(false);
    }
  };

  const swapDarkLight = () => {
    setCurrentColors(prev => ({
      ...prev,
      LightVibrant: prev.DarkVibrant,
      DarkVibrant: prev.LightVibrant,
      LightMuted: prev.DarkMuted,
      DarkMuted: prev.LightMuted,
    }));
    setDarkSwapped(d => !d);
    setStatus(darkSwapped ? '☀️ Switched to light mode preview' : '🌙 Switched to dark mode preview');
  };

  const resetColors = () => {
    setCurrentColors({ ...originalColors });
    setDarkSwapped(false);
    setStatus('↩ Reset to saved colors');
  };

  // ---- Navigation ----
  const goNext = useCallback(() => setCurrentIdx(i => Math.min(i + 1, filtered.length - 1)), [filtered.length]);
  const goPrev = useCallback(() => setCurrentIdx(i => Math.max(0, i - 1)), []);

  const doJump = () => {
    const n = parseInt(jumpTo) - 1;
    if (!isNaN(n) && n >= 0 && n < filtered.length) {
      setCurrentIdx(n);
      setJumpTo('');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      // Don't fire if typing in an input (except jump field)
      if (e.target.tagName === 'INPUT' && e.target !== jumpRef.current) return;
      if (e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); goNext(); break;
        case 'ArrowLeft': e.preventDefault(); goPrev(); break;
        case 'r': case 'R': if (!e.ctrlKey && !e.metaKey) markReviewed(true); break;
        case 's': case 'S': if (!e.ctrlKey && !e.metaKey) saveColors(false); break;
        case 'd': case 'D': if (!e.ctrlKey && !e.metaKey) swapDarkLight(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, current, currentColors]);

  if (images.length === 0) {
    return <div className={styles.loading}>Loading {images.length > 0 ? filtered.length : '…'} images…</div>;
  }

  if (!current || !currentColors) {
    return <div className={styles.loading}>No images match this filter.</div>;
  }

  const isDirty = JSON.stringify(currentColors) !== JSON.stringify(originalColors);

  return (
    <div className={styles.page}>

      {/* ---- Header ---- */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>🎨 Color Review</h1>
          <p className={styles.shortcuts}>Keys: ← → navigate · R mark reviewed · S save · D dark/light swap</p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.progressWrap}>
            <span className={styles.progressLabel}>{reviewedCount} / {images.length} reviewed</span>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${(reviewedCount / images.length) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ---- Filter + Nav row ---- */}
      <div className={styles.controlRow}>
        {/* Filter buttons */}
        <div className={styles.filterGroup}>
          {[
            { key: 'all', label: `All (${images.length})` },
            { key: 'unreviewed', label: `Unreviewed (${images.filter(i => !i.reviewed).length})` },
            { key: 'reviewed', label: `Reviewed (${reviewedCount})` },
          ].map(({ key, label }) => (
            <button key={key}
              className={`${styles.filterBtn} ${filterMode === key ? styles.filterActive : ''}`}
              onClick={() => { setFilterMode(key); setCurrentIdx(0); }}>
              {label}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className={styles.navGroup}>
          <button className={styles.navBtn} onClick={goPrev} disabled={currentIdx === 0}>←</button>
          <span className={styles.navCount}>{currentIdx + 1} / {filtered.length}</span>
          <button className={styles.navBtn} onClick={goNext} disabled={currentIdx >= filtered.length - 1}>→</button>
          <input
            ref={jumpRef}
            className={styles.jumpInput}
            value={jumpTo}
            onChange={e => setJumpTo(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doJump()}
            placeholder="Jump #"
          />
          <button className={styles.navBtn} onClick={doJump}>Go</button>
        </div>

        {/* Status */}
        <div className={styles.statusArea}>
          {current.reviewed && <span className={styles.reviewedBadge}>✓ Reviewed</span>}
          {isDirty && <span className={styles.dirtyBadge}>● Unsaved</span>}
          {status && <span className={styles.statusMsg}>{status}</span>}
        </div>
      </div>

      {/* ---- Filename ---- */}
      <div className={styles.filenameRow}>
        <span className={styles.filenameText}>{current.filename}</span>
      </div>

      {/* ---- Main 3-column grid ---- */}
      <div className={styles.mainGrid}>

        {/* LEFT: Image */}
        <div className={styles.imagePanel}>
          <div className={styles.imageWrap}>
            <img
              key={current.filename}
              src={imgError ? getThumbnailPath(current.filename) : getImagePath(current.filename)}
              alt={current.filename}
              className={styles.fullImage}
              onError={() => setImgError(true)}
            />
          </div>
          <div className={styles.imageInfo}>
            <span className={styles.imgInfoLabel}>Index: {images.indexOf(current) + 1} of {images.length}</span>
            {current.reviewed && <span className={styles.imgInfoReviewed}>✓ Reviewed</span>}
          </div>
        </div>

        {/* CENTER: Color pickers */}
        <div className={styles.colorPanel}>
          <h3 className={styles.panelTitle}>Colors</h3>
          <div className={styles.colorList}>
            {COLOR_KEYS.map(key => (
              <div key={key} className={styles.colorRow}>
                <div className={styles.colorSwatch} style={{ background: currentColors[key] }} title={currentColors[key]} />
                <div className={styles.colorMeta}>
                  <span className={styles.colorKey}>{key}</span>
                  <span className={styles.colorRole}>{COLOR_LABELS[key]}</span>
                </div>
                <input
                  type="color"
                  value={currentColors[key]}
                  onChange={e => setCurrentColors(prev => ({ ...prev, [key]: e.target.value }))}
                  className={styles.colorPicker}
                  title={`Pick ${key}`}
                />
                <input
                  type="text"
                  value={currentColors[key]}
                  onChange={e => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) setCurrentColors(prev => ({ ...prev, [key]: v }));
                  }}
                  className={styles.hexInput}
                  maxLength={7}
                  spellCheck={false}
                />
              </div>
            ))}
          </div>

          <div className={styles.colorTools}>
            <button className={`${styles.toolBtn} ${styles.swapBtn}`} onClick={swapDarkLight}>
              {darkSwapped ? '☀️ Swap to Light' : '🌙 Swap to Dark'}
            </button>
            <button className={`${styles.toolBtn} ${styles.rerollBtn}`} onClick={rerollColors} disabled={rerolling}>
              {rerolling ? '⏳ Extracting…' : '🎲 Re-extract Colors'}
            </button>
            <button className={`${styles.toolBtn} ${styles.resetBtn}`} onClick={resetColors} disabled={!isDirty}>
              ↩ Reset
            </button>
          </div>
        </div>

        {/* RIGHT: Live preview */}
        <div className={styles.previewPanel}>
          <h3 className={styles.panelTitle}>Preview</h3>

          <div className={styles.previewApp}>
            {/* Mini sidebar */}
            <div className={styles.previewSidebar} style={{ background: currentColors.Vibrant }}>
              <div className={styles.previewHeader} style={{ background: currentColors.DarkMuted }}>
                <span style={{ color: textColor(currentColors.DarkMuted), fontSize: '9px', fontWeight: 700 }}>Martin Barker</span>
              </div>
              <div className={styles.previewMenu} style={{ background: currentColors.DarkVibrant }}>
                {['Home', 'Listogs', 'Tagger', 'Vinyl2Digital', 'FFMPEG'].map(item => (
                  <div key={item} className={styles.previewMenuItem} style={{ color: textColor(currentColors.DarkVibrant) }}>
                    <span className={styles.previewMenuDot}>●</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className={styles.previewFooter} style={{ background: currentColors.Vibrant }}>
                <div className={styles.previewColorBoxes}>
                  {Object.values(currentColors).map((c, i) => (
                    <div key={i} className={styles.previewColorBox} style={{ background: c }} />
                  ))}
                </div>
                <div className={styles.previewThumb} style={{ background: currentColors.DarkVibrant }}>
                  <img src={getThumbnailPath(current.filename)} alt="" className={styles.previewThumbImg} />
                </div>
              </div>
            </div>

            {/* Mini content */}
            <div className={styles.previewContent} style={{ background: currentColors.LightMuted }}>
              <div className={styles.previewCard}>
                <div className={styles.previewCardAccent} style={{ background: currentColors.Vibrant }} />
                <div className={styles.previewCardBody}>
                  <div className={styles.previewCardTitle}>Listogs</div>
                  <div className={styles.previewBar} style={{ background: currentColors.Vibrant }} />
                  <div className={styles.previewBar} style={{ background: currentColors.LightVibrant, opacity: 0.7 }} />
                  <div className={styles.previewBar} style={{ background: currentColors.Muted, opacity: 0.5 }} />
                </div>
              </div>
              <div className={styles.previewCard}>
                <div className={styles.previewCardAccent} style={{ background: currentColors.DarkVibrant }} />
                <div className={styles.previewCardBody}>
                  <div className={styles.previewCardTitle}>Auto-Splitter</div>
                  <div className={styles.previewBar} style={{ background: currentColors.DarkMuted }} />
                  <div className={styles.previewBar} style={{ background: currentColors.Muted, opacity: 0.6 }} />
                </div>
              </div>
            </div>
          </div>

          {/* Color swatches summary */}
          <div className={styles.swatchRow}>
            {COLOR_KEYS.map(key => (
              <div key={key} className={styles.swatchItem} title={`${key}: ${currentColors[key]}`}>
                <div className={styles.swatchCircle} style={{ background: currentColors[key] }} />
                <span className={styles.swatchHex}>{currentColors[key]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Action bar ---- */}
      <div className={styles.actionBar}>
        {current.reviewed ? (
          <button className={styles.unreviewBtn} onClick={() => markReviewed(false)} disabled={saving}>
            ✗ Unmark Reviewed
          </button>
        ) : (
          <button className={styles.reviewBtn} onClick={() => markReviewed(true)} disabled={saving}>
            ✓ Mark Reviewed → Next
          </button>
        )}
        <button className={styles.saveBtn} onClick={() => saveColors(false)} disabled={saving || !isDirty}>
          {saving ? 'Saving…' : '💾 Save Colors'}
        </button>
        <button className={styles.saveReviewBtn} onClick={() => saveColors(true)} disabled={saving}>
          {saving ? 'Saving…' : '💾 ✓ Save & Mark Reviewed'}
        </button>
        <div className={styles.actionRight}>
          <span className={styles.actionHint}>← → navigate · R = review · S = save · D = dark/light</span>
        </div>
      </div>
    </div>
  );
}
