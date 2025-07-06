/* eslint-disable @next/next/no-img-element */
'use client'
import React, { useState, useEffect } from 'react';
import styles from './layout.module.css';
import Link from 'next/link'
import { usePathname } from 'next/navigation';
import { Home, Music, FileMusicIcon, BarChart, Mail, Github, Linkedin, Menu, ChevronRight, Contact, FileText as ResumeIcon } from 'lucide-react';
import ImageModal from './ImageModal/ImageModal';
import { ColorContext } from './ColorContext';
import { getRouteInfo } from './routeInfo';

export default function RootLayout({ children }) {
  
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarActive, setSidebarActive] = useState(true); // Always start with sidebar active
  const [contactExpanded, setContactExpanded] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [thumbnailVisible, setThumbnailVisible] = useState(true); // New state for thumbnail visibility
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

  const pathname = usePathname(); // get current path
  
  // Get route info from shared module
  const { title: pageTitle, subtitle: pageSubTitle, icon: pageIcon } = getRouteInfo(pathname);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      // Remove this line to prevent automatic sidebar collapse on mobile
      // setSidebarActive(!mobile);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      fetch('/images/aesthetic-images/colors.json')
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
          console.log('fetched color data: ', data[randomKey].colors)
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
    const maxDisplacementScale = 300; // Reduced from 700 for faster transitions
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
  
      const initialDuration = 100; 
      const reverseDuration = 200;  
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
        displayedImage.style.transform = `scale(${1 + 0.05 * easedProgress})`; // Reduced scale effect
        displayedImage.style.opacity = 1 - progress;
  
        // Start the dissolve-in for the new image when halfway through the dissolve-out
        if (progress >= 0.4) { // Start transition earlier
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
            displayedImage.style.transform = `scale(${1 + 0.05 * (1 - easedProgress)})`; // Reduced scale effect
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
          href={to}                          // <-- use href instead of to
          className={styles.navbarItem}
          style={{
            color: sidebarTextColor,
            background: pathname === to     // <-- use pathname variable
              ? colors.LightMuted
              : 'transparent'
          }}
        >
          <div className={styles.iconContainer}>
            <Icon size={20} color={iconColor || sidebarTextColor} />
          </div>
          <span className={!sidebarActive ? styles.hidden : ''}>{label}</span>
        </Link>
      </li>
    );

  // Function to convert image path to thumbnail path
  const getThumbnailPath = (imagePath) => {
    if (!imagePath) return null;
    // Extract filename from path like "/images/aesthetic-images/images/1597379681161.jpg"
    const filename = imagePath.split('/').pop();
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    return `/images/aesthetic-images/thumbnails/${nameWithoutExt}-thumbnail.jpg`;
  };

  return (
    <ColorContext.Provider value={{ colors, colorData }}>
      <html lang="en">
        <head>
          <title>{pageTitle}</title>
          <link rel="icon" href={pageIcon} />
          <link rel="shortcut icon" href={pageIcon} />
        </head>
        <body  style={{ margin: '0px' }}>
        <svg xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }}>
          <defs>
            <filter id="dissolve-filter" x="-200%" y="-200%" width="500%" height="500%" colorInterpolationFilters="sRGB" overflow="visible">
              <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="1" result="bigNoise" /> {/* Increased baseFrequency for fewer particles */}
              <feComponentTransfer in="bigNoise" result="bigNoiseAdjusted">
                <feFuncR type="linear" slope="2" intercept="-0.8" /> {/* Adjusted values for less intense effect */}
                <feFuncG type="linear" slope="2" intercept="-0.8" />
              </feComponentTransfer>
              <feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="1" result="fineNoise" /> {/* Adjusted baseFrequency */}
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

              <ProjectLink
                to="/discogs2youtube"
                icon={FileMusicIcon}
                label="Discogs2Youtube"
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
              {/* Show image thumbnail conditionally based on thumbnailVisible state */}
              {randomImage && thumbnailVisible && (
                <img
                  id="colorImage"
                  src={getThumbnailPath(randomImage)}
                  alt="Random aesthetic"
                  className={styles.colorImage}
                  onClick={handleImageClick}
                />
              )}
              <p className={`${styles.creditText} ${!sidebarActive ? styles.hidden : ''}`}>
                <a href="https://codepen.io/Mikhail-Bespalov/pen/yLmpxOG" target="_blank" rel="noopener noreferrer">
                  Refresh color effect by Mike Bespalov
                </a>
              </p>
              {/* Convert mobile text to a toggle button */}
              {isMobile && (
                <button
                  className={`${styles.creditText} ${styles.mobileText} ${!sidebarActive ? styles.hidden : ''}`}
                  onClick={() => setThumbnailVisible(!thumbnailVisible)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    padding: '0.25rem 0.5rem',
                    cursor: 'pointer'
                  }}
                >
                  {thumbnailVisible ? 'Hide Thumbnail' : 'Show Thumbnail'}
                </button>
              )}
            </div>
          </nav>
          <main
            className={`${styles.content} ${sidebarActive && isMobile ? styles.pushed : ''
              }`}
            style={{ background: colors.LightMuted }}
          >
            <div className={styles.contentWrapper}>
              <div className={styles.titleCard}
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
        </body>
      </html>
    </ColorContext.Provider>
  );
} 