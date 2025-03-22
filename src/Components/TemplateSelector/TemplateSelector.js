import React from 'react';
import styles from './TemplateSelector.module.css';

const TemplateSelector = ({ selectedTemplate, onTemplateChange }) => {
  return (
    <div className={styles.templateSelector}>
      <h2 className={styles.title}>Template:</h2>
      <select 
        value={selectedTemplate} 
        onChange={(e) => onTemplateChange(e.target.value)}
        className={styles.select}
      >
        <option value="combine">Combine audio + image into video</option>
        <option value="splitSilence">Split By Silence</option>
        <option value="custom">Custom</option>
      </select>
    </div>
  );
};

export default TemplateSelector;
