import React from 'react';
import styles from './Discogs2Playlist.module.css';

export default function Discogs2Playlist() {
    return (
        <div className={styles.page}>
            <h1 className={styles.title}>Discogs to Playlist</h1>
            <p className={styles.paragraph}>Convert your Discogs collection into a playlist.</p>
        </div>
    );
}
