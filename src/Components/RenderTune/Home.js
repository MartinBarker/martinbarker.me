import React, { useState, useEffect } from 'react';
import styles from './Frame.module.css';
import screenshot from '../../images/RenderTune_Windows.PNG';
import macAppStoreBadge from '../../svg/mac-app-store-badge.svg';
import msStoreBadge from '../../svg/ms-store-badge.svg';
import snapStoreBadge from '../../svg/snap-store-black.svg';
import appleIcon from '../../svg/apple-icon.svg'; // Import Apple icon
import linuxIcon from '../../svg/linux-icon.svg'; // Import Linux icon
import windowsIcon from '../../svg/windows-icon.svg'; // Import Windows icon

const Home = () => {
  const [latestVersion, setLatestVersion] = useState('');
  const [showMacOptions, setShowMacOptions] = useState(false);

  useEffect(() => {
    // Fetch the latest release version from GitHub
    fetch('https://api.github.com/repos/MartinBarker/RenderTune/releases/latest')
      .then(response => response.json())
      .then(data => setLatestVersion(data.tag_name))
      .catch(error => console.error('Error fetching latest release:', error));
  }, []);

  const handleMacClick = () => {
    setShowMacOptions(true);
  };

  return (
    <>
      <title>RenderTune - Professional Video Rendering</title>
      <meta name="description" content="Combine audio and images into professional videos with RenderTune. Download the latest version for Windows, macOS, and Linux." />
      <meta name="keywords" content="RenderTune, video rendering, audio to video, professional videos, macOS, Windows, Linux" />
      <meta property="og:title" content="RenderTune - Professional Video Rendering" />
      <meta property="og:description" content="Combine audio and images into professional videos with RenderTune. Download the latest version for Windows, macOS, and Linux." />
      <meta property="og:image" content={screenshot} />
      <meta property="og:url" content="https://jermasearch.com/rendertune" />
      <meta name="twitter:card" content="summary_large_image" />

      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h2>Combine Audio &amp; Images into Professional Videos</h2>
          <div className={styles.downloadSection}>
            <h3>Download Latest Release</h3>
            <div className={styles.downloadButtons}>
              <a href={`https://github.com/MartinBarker/RenderTune/releases/download/${latestVersion}/RenderTune-win-x64.exe`} className={styles.downloadBtn}>
                <img src={windowsIcon} alt="Windows" className={styles.osIcon} />
                Windows
              </a>
              {showMacOptions ? (
                <>
                  <a href={`https://github.com/MartinBarker/RenderTune/releases/download/${latestVersion}/RenderTune-mac-arm64.dmg`} className={styles.downloadBtn}>
                    <img src={appleIcon} alt="Apple" className={styles.osIcon} />
                    macOS (Apple Silicon)
                  </a>
                  <a href={`https://github.com/MartinBarker/RenderTune/releases/download/${latestVersion}/RenderTune-mac-x64.dmg`} className={styles.downloadBtn}>
                    <img src={appleIcon} alt="Apple" className={styles.osIcon} />
                    macOS (Intel)
                  </a>
                </>
              ) : (
                <a href="#" className={styles.downloadBtn} onClick={handleMacClick}>
                  <img src={appleIcon} alt="Apple" className={styles.osIcon} />
                  macOS
                </a>
              )}
              <a href={`https://github.com/MartinBarker/RenderTune/releases/download/${latestVersion}/RenderTune-linux-x86_64.AppImage`} className={styles.downloadBtn}>
                <img src={linuxIcon} alt="Linux" className={styles.osIcon} />
                Linux
              </a>
            </div>
            <h3>Download from App Stores</h3>
            <div className={styles.appStoreButtons}>
              <a href="https://apps.apple.com/us/app/rendertune/id1552674375" target="_blank" rel="noopener noreferrer">
                <img src={macAppStoreBadge} alt="Download on the Mac App Store" className={`${styles.storeBadge} ${styles.macAppStoreBadge}`} />
              </a>
              <a href="https://apps.microsoft.com/detail/9n5710msppf1" target="_blank" rel="noopener noreferrer">
                <img src={msStoreBadge} alt="Download from Microsoft Store" className={`${styles.storeBadge} ${styles.msStoreBadge}`} />
              </a>
              <a href="https://snapcraft.io/rendertune" target="_blank" rel="noopener noreferrer">
                <img src={snapStoreBadge} alt="Download from Snap Store" className={`${styles.storeBadge} ${styles.snapStoreBadge}`} />
              </a>
            </div>
          </div>
        </div>
        <div className={styles.heroImage}>
          <img src={screenshot} alt="RenderTune Screenshot" />
        </div>
      </section>

      <section className={styles.features}>
        <h2>Features</h2>
        <div className={styles.featuresGrid}>
          <div className={styles.featureItem}>
            <h3>Render Videos</h3>
            <p>Render videos from a single audio file or combine multiple audio files in a specific order.</p>
          </div>
          <div className={styles.featureItem}>
            <h3>Customizable Resolution</h3>
            <p>Set the output video resolution and choose your desired output location.</p>
          </div>
          <div className={styles.featureItem}>
            <h3>Padding Options</h3>
            <p>Add black or white padding to adjust the image frame.</p>
          </div>
          <div className={styles.featureItem}>
            <h3>Drag-and-Drop Support</h3>
            <p>Easily select files with intuitive drag-and-drop functionality.</p>
          </div>
          <div className={styles.featureItem}>
            <h3>Batch Rendering</h3>
            <p>Process multiple videos at once with customizable settings for each render.</p>
          </div>
          <div className={styles.featureItem}>
            <h3>Format Support</h3>
            <p>Supports popular audio formats (mp3, wav, flac, etc.) and image formats (png, jpg, webp), output as mp4.</p>
          </div>
        </div>
      </section>
    </>
  );
};

export default Home;
