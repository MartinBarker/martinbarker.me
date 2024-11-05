// MainLayout.js
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styles from './Sidebar.module.css';
import colorImage from '../images/aesthetic-images/images/large_4f15609cf6b3e30bd781c1e19d377164.jpg';

const MainLayout = ({ children, pageTitle }) => {
  const [sidebarActive, setSidebarActive] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [colors, setColors] = useState({
    Vibrant: '#f98c59',
    LightVibrant: '#e9a493',
    DarkVibrant: '#7f2b04',
    Muted: '#5d7eb2',
    LightMuted: '#c2c99e',
    DarkMuted: '#453a38'
  });

  const toggleSidebar = () => {
    setSidebarActive(!sidebarActive);
  };

  const refreshColors = async () => {
    try {
      const response = await fetch('/getColors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'varValue' }),
      });
      const data = await response.json();
      setColors(data.colors);
    } catch (error) {
      console.error('Error refreshing colors:', error);
    }
  };

  return (
    <div className={styles.wrapper}>
      {/* Sidebar */}
      <nav className={`${styles.sidebar} ${sidebarActive ? styles.active : ''}`}
           style={{ background: colors.LightVibrant }}>
        <div className={styles.sidebarHeader} style={{ background: colors.DarkMuted }}>
          <h3 className={styles.sidebarHeaderText}>
            <strong>Martin Barker</strong>
          </h3>
          <button className={styles.sidebarCollapse} onClick={toggleSidebar}>
            <img src="https://img.icons8.com/ios-filled/24/000000/menu.png" alt="menu" />
          </button>
        </div>

        <ul className={styles.sidebarMenu} style={{ background: colors.DarkVibrant }}>
          <li>
            <Link to="/" className={styles.navbarItem}>About</Link>
          </li>
          <li>
            <details className={styles.submenu}>
              <summary>Projects</summary>
              <ul>
                <li><Link to="/tagger">tagger.site</Link></li>
                <li><Link to="/RenderTune">RenderTune</Link></li>
                <li>
                  <a href="https://github.com/MartinBarker/vinyl2digital" 
                     target="_blank" 
                     rel="noopener noreferrer">
                    Vinyl2Digital
                  </a>
                </li>
                <li><Link to="/popularify">Popularify</Link></li>
              </ul>
            </details>
          </li>
          <li>
            <details className={styles.submenu}>
              <summary>Blog</summary>
              <ul>
                <li><Link to="/posts/1">Sample Post</Link></li>
              </ul>
            </details>
          </li>
          <li>
            <details className={styles.submenu}>
              <summary>Contact</summary>
              <ul>
                <li><a href="mailto:martinbarker99@gmail.com">Email</a></li>
                <li>
                  <a href="https://github.com/MartinBarker" 
                     target="_blank" 
                     rel="noopener noreferrer">
                    Github
                  </a>
                </li>
                <li>
                  <a href="https://www.linkedin.com/in/martinbarker99" 
                     target="_blank" 
                     rel="noopener noreferrer">
                    LinkedIn
                  </a>
                </li>
                <li>
                  <a href="/static/assets/pdf/Martin Barker Resume.pdf" 
                     target="_blank" 
                     rel="noopener noreferrer">
                    Resume
                  </a>
                </li>
              </ul>
            </details>
          </li>
        </ul>

        <div className={styles.sidebarFooter}>
          <button onClick={refreshColors} className={styles.refreshButton}>
            Refresh Colors
          </button>
          <img
            src={colorImage}
            alt="color palette"
            className={styles.colorImage}
            onClick={() => setImageModalOpen(true)}
          />
          <div className={styles.colorBoxes}>
            {Object.entries(colors).map(([name, color]) => (
              <div
                key={name}
                className={styles.colorBox}
                style={{ background: color }}
                title={`${name}: ${color}`}
              />
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className={styles.content} style={{ background: colors.LightMuted }}>
        <div className={styles.contentWrapper}>
          <div className={styles.titleCard} style={{ background: colors.Muted }}>
            <h1 className={styles.pageTitle}><strong>{pageTitle}</strong></h1>
            <div className={styles.links}>
              <a
                href="https://github.com/MartinBarker/example-repo"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.hoverUrl}
              >
                Github Code
              </a>
              <a
                href="https://github.com/MartinBarker/page-repo"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.hoverUrl}
              >
                View code for this page
              </a>
            </div>
          </div>
          <div className={styles.contentBody}>
            {children}
          </div>
        </div>
      </main>

      {/* Image Modal */}
      {imageModalOpen && (
        <div className={styles.modal} onClick={() => setImageModalOpen(false)}>
          <span className={styles.closeModal}>&times;</span>
          <div className={styles.modalContent}>
            <a
              href="/static/assets/aesthetic-images/FZya5H7XEAAJmMx.png"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.modalLink}
            >
              Source Image
            </a>
            <img
              src="/static/assets/aesthetic-images/FZya5H7XEAAJmMx.png"
              alt="modal"
              className={styles.modalImage}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default MainLayout;