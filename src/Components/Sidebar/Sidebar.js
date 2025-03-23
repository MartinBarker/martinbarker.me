import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from './Sidebar.module.css';
import {
  Home,
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

import RenderTuneIcon from "../../ico/rendertune.ico";
import ImageModal from '../ImageModal/ImageModal';

const MainLayout = ({ children, pageTitle, pageSubTitle, icon }) => {
  const isInitialMobile = window.innerWidth <= 768;
  const [sidebarActive, setSidebarActive] = useState(!isInitialMobile);
  const [contactExpanded, setContactExpanded] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(isInitialMobile);
  const [colors, setColors] = useState({
    Vibrant: '#ffffff',
    LightVibrant: '#ffffff',
    DarkVibrant: '#ffffff',
    Muted: '#ffffff',
    LightMuted: '#ffffff',
    DarkMuted: '#ffffff'
  });
  const [colorData, setColorData] = useState(null);
  const [randomImage, setRandomImage] = useState(null);

  const location = useLocation();

  // Function to calculate readable text color based on background color
  const getReadableTextColor = (backgroundColor) => {
    // Remove "#" and parse hex color values
    const color = backgroundColor.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    // Calculate brightness
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 125 ? '#000' : '#fff'; // Use black if light, white if dark
  };

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
        setColorData(data);
        const imageKeys = Object.keys(data);
        const randomKey = imageKeys[Math.floor(Math.random() * imageKeys.length)];
        setRandomImage(`/images/aesthetic-images/images/${randomKey}`);
        setColors(data[randomKey].colors);
      })
      .catch((error) => console.error("Error loading colors.json:", error));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      setSidebarActive(!mobile);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (icon) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = icon;
      document.head.appendChild(link);

      return () => {
        document.head.removeChild(link);
      };
    }
  }, [icon]);

  const toggleSidebar = () => {
    if (sidebarActive) {
      setContactExpanded(false); // Close the Contact submenu when collapsing the sidebar
    }
    setSidebarActive(!sidebarActive);
  };

  const handleContactClick = () => {
    if (!sidebarActive) {
      // If the sidebar is collapsed, open it first
      setSidebarActive(true);
    }
    // Then, toggle the Contact submenu
    setContactExpanded((prev) => !prev);
  };

  // Thanos Snap refresh colors logic 
  const maxDisplacementScale = 700;
  let isAnimating = false;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const setRandomSeed = (bigNoise) => {
    const randomSeed = Math.floor(Math.random() * 1000);
    bigNoise.setAttribute("seed", randomSeed);
  };

  const refreshColors = () => {
    if (isAnimating || !colorData) return; // Prevent multiple animations
    isAnimating = true;

    const imageKeys = Object.keys(colorData);
    const randomKey = imageKeys[Math.floor(Math.random() * imageKeys.length)];
    const newColors = colorData[randomKey].colors;
    setColors(newColors);

    // Dissolve animation logic
    const displayedImage = document.querySelector(`.${styles.colorImage}`);
    const dissolveFilter = document.getElementById("dissolve-filter");
    const displacementMap = dissolveFilter.querySelector("feDisplacementMap");
    const bigNoise = dissolveFilter.querySelector('feTurbulence[result="bigNoise"]');

    setRandomSeed(bigNoise);

    const initialDuration = 600;
    const overlapDuration = 700; // Overlap duration for smoother transition
    const reverseDuration = 800;
    const startTime = performance.now();

    // First part: Dissolve out the current image
    const animateOut = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / initialDuration, 1);
      const easedProgress = easeOutCubic(progress);

      // Scale displacement for dissolve effect
      const displacementScale = easedProgress * maxDisplacementScale;
      displacementMap.setAttribute("scale", displacementScale);

      // Scale and fade out
      displayedImage.style.transform = `scale(${1 + 0.1 * easedProgress})`;
      displayedImage.style.opacity = 1 - progress;

      // Start the dissolve-in for the new image when halfway through the dissolve-out
      if (progress >= 0.5 && displayedImage.style.opacity <= 0.5) {
        // Set the new image source and trigger the "reform" animation
        setRandomImage(`/images/aesthetic-images/images/${randomKey}`);
        const startTimeReform = performance.now();

        // Second part: Reform into the new image
        const animateIn = (currentTime) => {
          const elapsed = currentTime - startTimeReform;
          const progress = Math.min(elapsed / reverseDuration, 1);
          const easedProgress = easeOutCubic(progress);

          // Reverse scale displacement for reform effect
          const displacementScale = (1 - easedProgress) * maxDisplacementScale;
          displacementMap.setAttribute("scale", displacementScale);

          // Scale back down to normal
          displayedImage.style.transform = `scale(${1 + 0.1 * (1 - easedProgress)})`;
          displayedImage.style.opacity = easedProgress;

          if (progress < 1) {
            requestAnimationFrame(animateIn);
          } else {
            // Reset values to complete the transition smoothly
            displayedImage.style.transform = "scale(1)";
            displacementMap.setAttribute("scale", "0");
            isAnimating = false;
          }
        };

        requestAnimationFrame(animateIn);
      }

      if (progress < 1) {
        requestAnimationFrame(animateOut);
      }
    };

    requestAnimationFrame(animateOut);
  };

  const handleImageClick = () => {
    if (!sidebarActive) {
      setSidebarActive(true);
    } else {
      setImageModalOpen(true);
    }
  };

  const sidebarTextColor = getReadableTextColor(colors.DarkVibrant); // Get text color based on DarkVibrant

  // Tooltip helper function
  const ProjectLink = ({ to, icon: Icon, label, iconColor }) => (
    <li className={styles.tooltipContainer} data-tooltip={label}>
      <Link
        to={to}
        className={styles.navbarItem}
        style={{
          color: sidebarTextColor,
          background: location.pathname === to ? colors.LightMuted : 'transparent'
        }}
      >
        <div className={styles.iconContainer}>
          <Icon size={20} color={iconColor || sidebarTextColor} />
        </div>
        <span className={!sidebarActive ? styles.hidden : ''}>{label}</span>
      </Link>
    </li>
  );

  return (
    <>
      <svg xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }}>
        <defs>
          <filter id="dissolve-filter" x="-200%" y="-200%" width="500%" height="500%" colorInterpolationFilters="sRGB" overflow="visible">
            <feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="1" result="bigNoise" />
            <feComponentTransfer in="bigNoise" result="bigNoiseAdjusted">
              <feFuncR type="linear" slope="3" intercept="-1" />
              <feFuncG type="linear" slope="3" intercept="-1" />
            </feComponentTransfer>
            <feTurbulence type="fractalNoise" baseFrequency="1" numOctaves="1" result="fineNoise" />
            <feMerge result="mergedNoise">
              <feMergeNode in="bigNoiseAdjusted" />
              <feMergeNode in="fineNoise" />
            </feMerge>
            <feDisplacementMap in="SourceGraphic" in2="mergedNoise" scale="0" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div className={`${styles.wrapper} ${isMobile ? styles.mobile : ''}`}>
        <div className={`${styles.sidebarOverlay} ${sidebarActive && isMobile ? styles.active : ''}`}
          onClick={() => isMobile && setSidebarActive(false)} />
        <nav className={`${styles.sidebar} ${sidebarActive ? styles.active : styles.collapsed}`}
          style={{ background: colors.Vibrant }}>
          <div className={styles.sidebarHeader} style={{ background: colors.DarkMuted }}>
            <button id="sidebarToggle" className={styles.sidebarCollapse} onClick={toggleSidebar}>
              {sidebarActive ? <ChevronRight size={24} /> : <Menu size={24} />}
            </button>
            <h3 className={`${styles.sidebarHeaderText} ${!sidebarActive && styles.hidden}`}>
              <strong>Martin Barker</strong>
            </h3>
          </div>
          <ul className={styles.sidebarMenu} style={{ background: colors.DarkVibrant }}>

            {/* Home */}
            <ProjectLink
              to="/"
              icon={Home}
              label="Home"
            />

            <ProjectLink
              to="/rendertune"
              icon={FileMusicIcon}
              label="RenderTune"
            />

            <ProjectLink
              to="/tagger"
              icon={FileMusicIcon}
              label="tagger.site"
            />

            <ProjectLink
              to="/ffmpegwasm"
              icon={FileMusicIcon}
              label="ffmpeg wasm"
            />
{/* 
            <ProjectLink
              to="/retro-roulette"
              icon={FileMusicIcon}
              label="Retro Roulette"
            />

            <ProjectLink
              to="/discogs-video-extension"
              icon={Music}
              label="Discogs Extension"
            />

            <ProjectLink
              to="/rap-genius-producer-exporter"
              icon={BarChart}
              label="Rap Genius Exporter"
            />

            <ProjectLink
              to="/bandcamp-api"
              icon={FileMusicIcon}
              label="Bandcamp API"
            />

            <ProjectLink
              to="/split-by-silence"
              icon={FileMusicIcon}
              label="Split By Silence"
            />

            <ProjectLink
              to="/jermasearch"
              icon={FileMusicIcon}
              label="Jerma985 Search"
            />

            <ProjectLink
              to="/ableton-to-cue"
              icon={FileMusicIcon}
              label="Ableton .als to .cue"
            />
*/}
            {/* Existing Contact and other sections remain the same */}
            <ProjectLink
              to="/popularify"
              icon={BarChart}
              label="Popularify"
            />

            {/* Contact Submenu */}
            <li className={`${styles.navbarItem} ${styles.contactSection}`}>
              <button className={styles.contactToggle} onClick={handleContactClick} style={{ color: sidebarTextColor }}>
                <div className={styles.iconContainer}>
                  <Contact size={20} color={sidebarTextColor} />
                </div>
                <span className={!sidebarActive ? styles.hidden : ''}>Contact</span>
                {sidebarActive && (
                  <span className={`${styles.arrowIcon} ${contactExpanded ? styles.expanded : ''}`} style={{ color: sidebarTextColor }}>
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
                    style={{ color: sidebarTextColor }}>
                    <ResumeIcon size={20} className={styles.contactIcon} color={sidebarTextColor} />
                    Resume
                  </a>
                </li>
                <li>
                  <a href="mailto:martinbarker99@gmail.com" className={styles.contactItem} style={{ color: sidebarTextColor }}>
                    <Mail size={20} className={styles.contactIcon} color={sidebarTextColor} />
                    Email
                  </a>
                </li>
                <li>
                  <a href="https://github.com/MartinBarker"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.contactItem}
                    style={{ color: sidebarTextColor }}>
                    <Github size={20} className={styles.contactIcon} color={sidebarTextColor} />
                    Github
                  </a>
                </li>
                <li>
                  <a href="https://www.linkedin.com/in/martinbarker99"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.contactItem}
                    style={{ color: sidebarTextColor }}>
                    <Linkedin size={20} className={styles.contactIcon} color={sidebarTextColor} />
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
            {randomImage && (
              <img
                src={randomImage}
                alt="Random aesthetic"
                className={styles.colorImage}
                onClick={handleImageClick}
              />
            )}
            <p className={`${styles.creditText} ${!sidebarActive ? styles.hidden : ''}`}>
              <a href="https://codepen.io/Mikhail-Bespalov/pen/yLmpxOG" target="_blank" rel="noopener noreferrer">
                snap effect by Mike Bespalov
              </a>
            </p>
          </div>
        </nav>
        <main
          className={`${styles.content} ${sidebarActive && isMobile ? styles.pushed : ''
            }`}
          style={{ background: colors.LightMuted }}
        >
          <div className={styles.contentWrapper}>
            <div
              className={styles.titleCard}
              style={{ background: colors.Muted }}
            >
              <h1 className={styles.pageTitle}>
                <strong>{pageTitle}</strong>
              </h1>
              {pageSubTitle && (
                <p className={styles.pageSubTitle}>{pageSubTitle}</p>
              )}
            </div>
            <div className={styles.contentBody}>{children}</div>
          </div>
        </main>
        {imageModalOpen && (
          <ImageModal 
            imageUrl={randomImage} 
            onClose={() => setImageModalOpen(false)} 
          />
        )}
      </div>
    </>
  );
};

export default MainLayout;


