import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styles from './Sidebar.module.css';
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
  const [randomImage, setRandomImage] = useState(null);
  const [colorData, setColorData] = useState(null);
  const [textColor, setTextColor] = useState('#000'); 
  const [lightTextColor, setLightTextColor] = useState('#FFFFFF'); 

  useEffect(() => {
    // Fetch colors.json from the public folder
    fetch(`${process.env.PUBLIC_URL}/images/aesthetic-images/colors.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load colors.json");
        }
        return response.json();
      })
      .then((data) => {
        setColorData(data); // Store color data for later use
        // Select a random image initially
        const imageKeys = Object.keys(data);
        const randomKey = imageKeys[Math.floor(Math.random() * imageKeys.length)];
        setRandomImage(`/images/aesthetic-images/images/${randomKey}`);
        setColors(data[randomKey].colors); // Set colors based on the randomly selected image
        updateTextColor(data[randomKey].colors.LightVibrant); // Set initial text color
      })
      .catch((error) => console.error("Error loading colors.json:", error));
  }, []);

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

  const refreshColors = () => {
    if (colorData) {
      // Select a new random image from colors.json
      const imageKeys = Object.keys(colorData);
      const randomKey = imageKeys[Math.floor(Math.random() * imageKeys.length)];
      
      // Update the random image and colors
      setRandomImage(`/images/aesthetic-images/images/${randomKey}`);
      const newColors = colorData[randomKey].colors;
      setColors(newColors);
      updateTextColor(newColors.LightVibrant); // Update text color based on the new background color
    }
  };

  // Function to calculate contrast and decide on black or white text color
  const updateTextColor = (backgroundColor) => {
    const color = backgroundColor.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    setTextColor(brightness > 125 ? '#000' : '#fff');
  };

  // Function to handle image click in collapsed mode
  const handleImageClick = () => {
    if (!sidebarActive) {
      setSidebarActive(true); // Expand the sidebar if it’s collapsed
    } else {
      setImageModalOpen(true); // Open modal if sidebar is already expanded
    }
  };

  return (
    <div className={`${styles.wrapper} ${isMobile ? styles.mobile : ''}`}>
      <div className={`${styles.sidebarOverlay} ${sidebarActive && isMobile ? styles.active : ''}`} 
           onClick={() => isMobile && setSidebarActive(false)} />
      <nav className={`${styles.sidebar} ${sidebarActive ? styles.active : styles.collapsed}`}
           style={{ background: colors.LightVibrant, color: textColor }}>
        <div className={styles.sidebarHeader} style={{ background: colors.DarkMuted }}>
          <button id="sidebarToggle" className={styles.sidebarCollapse} onClick={toggleSidebar}>
            {sidebarActive ? <ChevronRight size={24} /> : <Menu size={24} />}
          </button>
          <h3 className={`${styles.sidebarHeaderText} ${!sidebarActive && styles.hidden}`}>
            <strong>Martin Barker</strong>
          </h3>
        </div>
        <ul className={styles.sidebarMenu} style={{ background: colors.DarkVibrant, color: lightTextColor }}>
          <li>
            <Link to="/" className={styles.navbarItem} style={{ color: lightTextColor }}>
              <div className={styles.iconContainer}>
                <FileMusicIcon size={20} color={lightTextColor} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>About</span>
            </Link>
          </li>
          <li>
            <Link to="/tagger" className={styles.navbarItem} style={{ color: lightTextColor }}>
              <div className={styles.iconContainer}>
                <Tag size={20} color={lightTextColor} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>tagger.site</span>
            </Link>
          </li>
          <li>
            <Link to="/RenderTune" className={styles.navbarItem} style={{ color: lightTextColor }}>
              <div className={styles.iconContainer}>
                <Music size={20} color={lightTextColor} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>RenderTune</span>
            </Link>
          </li>
          <li>
            <a href="https://github.com/MartinBarker/vinyl2digital" 
               target="_blank" 
               rel="noopener noreferrer"
               className={styles.navbarItem}
               style={{ color: lightTextColor }}>
              <div className={styles.iconContainer}>
                <FileMusicIcon size={20} color={lightTextColor} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>Vinyl2Digital</span>
            </a>
          </li>
          <li>
            <Link to="/popularify" className={styles.navbarItem} style={{ color: lightTextColor }}>
              <div className={styles.iconContainer}>
                <BarChart size={20} color={lightTextColor} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>Popularify</span>
            </Link>
          </li>

          {/* Contact Section with Expand/Collapse */}
          <li className={`${styles.navbarItem} ${styles.contactSection}`}>
            <button className={styles.contactToggle} onClick={handleContactClick} style={{ color: lightTextColor }}>
              <div className={styles.iconContainer}>
                <Contact size={20} color={lightTextColor} />
              </div>
              <span className={!sidebarActive ? styles.hidden : ''}>Contact</span>
              {sidebarActive && (
                <span className={`${styles.arrowIcon} ${contactExpanded ? styles.expanded : ''}`} style={{ color: lightTextColor }}>
                  ▼
                </span>
              )}
            </button>
            <ul className={`${styles.contactList} ${contactExpanded ? styles.expanded : ''}`}>
              <li>
                <a href="/static/assets/pdf/Martin Barker Resume.pdf" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className={styles.contactItem}
                   style={{ color: lightTextColor }}>
                  <ResumeIcon size={20} className={styles.contactIcon} color={lightTextColor} />
                  Resume
                </a>
              </li>
              <li>
                <a href="mailto:martinbarker99@gmail.com" className={styles.contactItem} style={{ color: lightTextColor }}>
                  <Mail size={20} className={styles.contactIcon} color={lightTextColor} />
                  Email
                </a>
              </li>
              <li>
                <a href="https://github.com/MartinBarker" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className={styles.contactItem}
                   style={{ color: lightTextColor }}>
                  <Github size={20} className={styles.contactIcon} color={lightTextColor} />
                  Github
                </a>
              </li>
              <li>
                <a href="https://www.linkedin.com/in/martinbarker99" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className={styles.contactItem}
                   style={{ color: lightTextColor }}>
                  <Linkedin size={20} className={styles.contactIcon} color={lightTextColor} />
                  LinkedIn
                </a>
              </li>
            </ul>
          </li>
        </ul>
        <div className={styles.sidebarFooter}>
          <button onClick={refreshColors} className={`${styles.refreshButton} ${!sidebarActive && styles.hidden}`} style={{ border: '1px solid black' }}>
            Refresh Colors
          </button>
          {randomImage && (
            <img
              src={randomImage}
              alt="Random aesthetic"
              className={styles.colorImage}
              onClick={handleImageClick}
            />
          )}
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
            {randomImage && (
              <img src={randomImage} alt="Random aesthetic" className={styles.modalImage} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MainLayout;
