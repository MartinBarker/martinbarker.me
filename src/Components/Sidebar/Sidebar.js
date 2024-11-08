import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styles from './Sidebar.module.css';
import colorImage from '../../images/aesthetic-images/images/20200825_160610.jpg';
import { 
  Tag, 
  Music, 
  FileMusicIcon, 
  BarChart, 
  Mail, 
  Github, 
  Linkedin, 
  Menu,
  ChevronRight,
  Contact,
  FileText as ResumeIcon
} from 'lucide-react';

const MainLayout = ({ children, pageTitle }) => {
  const [sidebarActive, setSidebarActive] = useState(true);
  const [contactExpanded, setContactExpanded] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [colors, setColors] = useState({
    Vibrant: '#f98c59',
    LightVibrant: '#e9a493',
    DarkVibrant: '#7f2b04',
    Muted: '#5d7eb2',
    LightMuted: '#c2c99e',
    DarkMuted: '#453a38'
  });

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarActive(false);
      } else {
        setSidebarActive(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => {
    if (sidebarActive) {
      setContactExpanded(false);
    }
    setSidebarActive(!sidebarActive);
  };

  const handleContactClick = () => {
    if (!sidebarActive) {
      setSidebarActive(true);
    }
    setContactExpanded(!contactExpanded);
  };

  // Helper function to generate a random hex color
  const getRandomHexColor = () => {
    return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
  };

  // Update refreshColors to generate random colors
  const refreshColors = () => {
    setColors({
      Vibrant: getRandomHexColor(),
      LightVibrant: getRandomHexColor(),
      DarkVibrant: getRandomHexColor(),
      Muted: getRandomHexColor(),
      LightMuted: getRandomHexColor(),
      DarkMuted: getRandomHexColor()
    });
  };

  return (
    <div className={`${styles.wrapper} ${isMobile ? styles.mobile : ''}`}>
      <div className={`${styles.sidebarOverlay} ${sidebarActive && isMobile ? styles.active : ''}`} 
           onClick={() => isMobile && setSidebarActive(false)} />
      <nav className={`${styles.sidebar} ${sidebarActive ? styles.active : styles.collapsed}`}
           style={{ background: colors.LightVibrant }}>
        <div className={styles.sidebarHeader} style={{ background: colors.DarkMuted }}>
          <button id="sidebarToggle" className={styles.sidebarCollapse} onClick={toggleSidebar}>
            {sidebarActive ? <ChevronRight size={24} /> : <Menu size={24} />}
          </button>
          <h3 className={`${styles.sidebarHeaderText} ${!sidebarActive && styles.hidden}`}>
            <strong>Martin Barker</strong>
          </h3>
        </div>
        <ul className={styles.sidebarMenu} style={{ background: colors.DarkVibrant }}>
          <li>
            <Link to="/" className={styles.navbarItem}>
              <div className={styles.iconContainer}>
                <FileMusicIcon size={20} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>About</span>
            </Link>
          </li>
          <li>
            <Link to="/tagger" className={styles.navbarItem}>
              <div className={styles.iconContainer}>
                <Tag size={20} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>tagger.site</span>
            </Link>
          </li>
          <li>
            <Link to="/RenderTune" className={styles.navbarItem}>
              <div className={styles.iconContainer}>
                <Music size={20} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>RenderTune</span>
            </Link>
          </li>
          <li>
            <a href="https://github.com/MartinBarker/vinyl2digital" 
               target="_blank" 
               rel="noopener noreferrer"
               className={styles.navbarItem}>
              <div className={styles.iconContainer}>
                <FileMusicIcon size={20} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>Vinyl2Digital</span>
            </a>
          </li>
          <li>
            <Link to="/popularify" className={styles.navbarItem}>
              <div className={styles.iconContainer}>
                <BarChart size={20} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>Popularify</span>
            </Link>
          </li>

          {/* Contact Section with Expand/Collapse */}
          <li className={`${styles.navbarItem} ${styles.contactSection}`}>
            <button className={styles.contactToggle} onClick={handleContactClick}>
              <div className={styles.iconContainer}>
                <Contact size={20} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>Contact</span>
              {sidebarActive && (
                <span className={`${styles.arrowIcon} ${contactExpanded ? styles.expanded : ''}`}>
                  ▼
                </span>
              )}
            </button>
            <ul className={`${styles.contactList} ${contactExpanded ? styles.expanded : ''}`}>
              <li>
                <a href="/static/assets/pdf/Martin Barker Resume.pdf" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className={styles.contactItem}>
                  <ResumeIcon size={20} className={styles.contactIcon} />
                  Resume
                </a>
              </li>
              <li>
                <a href="mailto:martinbarker99@gmail.com" className={styles.contactItem}>
                  <Mail size={20} className={styles.contactIcon} />
                  Email
                </a>
              </li>
              <li>
                <a href="https://github.com/MartinBarker" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className={styles.contactItem}>
                  <Github size={20} className={styles.contactIcon} />
                  Github
                </a>
              </li>
              <li>
                <a href="https://www.linkedin.com/in/martinbarker99" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className={styles.contactItem}>
                  <Linkedin size={20} className={styles.contactIcon} />
                  LinkedIn
                </a>
              </li>
            </ul>
          </li>
        </ul>
        
        <div className={styles.sidebarFooter}>
          <button onClick={refreshColors} className={`${styles.refreshButton} ${!sidebarActive && styles.hidden}`}>
            Refresh Colors
          </button>
          <img
            src={colorImage}
            alt="color palette"
            className={styles.colorImage}
            onClick={() => setImageModalOpen(true)}
          />
          <div className={`${styles.colorBoxes} ${!sidebarActive && styles.hidden}`}>
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
      <main className={`${styles.content} ${sidebarActive && isMobile ? styles.pushed : ''}`} 
            style={{ background: colors.LightMuted }}>
        <div className={styles.contentWrapper}>
          <div className={styles.titleCard} style={{ background: colors.Muted }}>
            <h1 className={styles.pageTitle}><strong>{pageTitle}</strong></h1>
            <div className={styles.links}>
              {/* Links */}
            </div>
          </div>
          <div className={styles.contentBody}>
            {children}
          </div>
        </div>
      </main>

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