"use client";
import React, { useRef, useState } from 'react';
import styles from './FileDrop.module.css';

export default function FileDrop({ onFilesSelected }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected && onFilesSelected(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleClick = () => {
    inputRef.current.click();
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected && onFilesSelected(e.target.files);
    }
  };

  return (
    <div
      className={`${styles.fileDrop} ${isDragging ? styles.dragging : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      tabIndex={0}
      role="button"
      aria-label="File upload area"
    >
      <input
        type="file"
        multiple
        ref={inputRef}
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <span>Drag &amp; drop files here, or <u>click to choose</u></span>
      <div style={{ marginTop: '0.5rem', fontSize: '0.95em' }}>
        <small>Supported files: mp3, wav, aiff, flac, cue</small>
      </div>
    </div>
  );
}
