import React, { useRef } from 'react';
import styles from './FileUploader.module.css';

const FileUploader = ({ onFileInput, isDragActive, handleDragOver, handleDragLeave, handleDrop }) => {
  const fileInputRef = useRef(null);

  return (
    <div 
      className={`${styles.dropzone} ${isDragActive ? styles.active : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input 
        type="file"
        ref={fileInputRef}
        onChange={(e) => onFileInput(Array.from(e.target.files))}
        className="hidden"
        multiple
        accept="audio/*,image/*"
      />
      <p>Upload files by clicking or dropping them here</p>
    </div>
  );
};

export default FileUploader;
