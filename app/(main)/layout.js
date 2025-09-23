/* eslint-disable @next/next/no-img-element */
'use client'
import React, { useState, useEffect } from 'react';
import styles from './layout.module.css';
import Link from 'next/link'
import { usePathname } from 'next/navigation';
import { Home, Music, FileMusicIcon, BarChart, Mail, Github, Linkedin, Menu, ChevronRight, Contact, FileText as ResumeIcon, Palette, Video, List, FileText, Zap } from 'lucide-react';
import ImageModal from './ImageModal/ImageModal';
import { ColorContext } from './ColorContext';
import { getRouteInfo } from './routeInfo';

export default function RootLayout({ children }) {
  
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarActive, setSidebarActive] = useState(true); // Always start with sidebar active
  const [contactExpanded, setContactExpanded] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [thumbnailVisible, setThumbnailVisible] = useState(true); // New state for thumbnail visibility
  const [imageLoaded, setImageLoaded] = useState(false); // Track image load state
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
  const { title: pageTitle, subtitle: pageSubTitle, tabTitle, icon: pageIcon } = getRouteInfo(pathname);

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
        })
        .catch((error) => console.error("Error loading colors.json:", error));
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

  // Function to sanitize filename for safe filesystem operations (matches ingestImages.js)
  const sanitizeFilename = (filename) => {
    return filename
      .replace(/['"]/g, '') // Remove quotes
      .replace(/[()]/g, '') // Remove parentheses
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/[^\w\-_.]/g, '') // Remove any other special characters except dash, underscore, dot
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
  };

  // Function to convert image path to thumbnail path (mobile-aware)
  const getThumbnailPath = (imagePath, forceDesktop = false) => {
    if (!imagePath) return null;
    // Extract filename from path like "/images/aesthetic-images/images/1597379681161.jpg"
    const filename = imagePath.split('/').pop();
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    const sanitizedName = sanitizeFilename(nameWithoutExt);
    
    // For sidebar images: always use mobile thumbnails when browser dimensions are small
    // For modals: respect forceDesktop parameter to show higher quality
    const useMobile = isMobile && !forceDesktop;
    const suffix = useMobile ? '-thumbnail-mobile.jpg' : '-thumbnail.jpg';
    
    // Mobile thumbnail path logic
    
    return `/images/aesthetic-images/thumbnails/${sanitizedName}${suffix}`;
  };

  return (
    <ColorContext.Provider value={{ colors, colorData }}>
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <title>{tabTitle || pageTitle || "Martin Barker"}</title>
          <link rel="icon" href={pageIcon} />
          <link rel="shortcut icon" href={pageIcon} />
          <meta name="google-site-verification" content="gDJG6R2M9ZdQ8t8SHYpzGW8Pq433BC0D-JlwXkvurxE" />
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
          {/* Mobile toggle button - always visible */}
          {isMobile && (
            <button id="sidebarToggle" className={styles.mobileToggle} onClick={toggleSidebar}>
              {sidebarActive ? <ChevronRight size={24} /> : <Menu size={24} />}
            </button>
          )}
          
          <div className={`${styles.sidebarOverlay} ${sidebarActive && isMobile ? styles.active : ''}`}
            onClick={toggleSidebar} />
          <nav className={`${styles.sidebar} ${sidebarActive ? styles.active : styles.collapsed}`}
            style={{ background: colors.Vibrant }}>
            <div className={styles.sidebarHeader} style={{ background: colors.DarkMuted }}>
              {/* Desktop toggle button - only visible on desktop */}
              {!isMobile && (
                <button id="sidebarToggleDesktop" className={styles.sidebarCollapse} onClick={toggleSidebar}>
                  {sidebarActive ? <ChevronRight size={24} /> : <Menu size={24} />}
                </button>
              )}
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

              <li className={styles.tooltipContainer} data-tooltip="RenderTune">
                <Link
                  href="/rendertune"
                  className={styles.navbarItem}
                  style={{
                    color: sidebarTextColor,
                    background: pathname === "/rendertune"
                      ? colors.LightMuted
                      : 'transparent'
                  }}
                >
                  <div className={styles.iconContainer}>
                    <img 
                      src="/ico/rendertune.ico" 
                      alt="RenderTune" 
                      style={{ width: '20px', height: '20px' }}
                    />
                  </div>
                  <span className={!sidebarActive ? styles.hidden : ''}>RenderTune</span>
                </Link>
              </li>

              <ProjectLink
                to="/tagger"
                icon={FileText}
                label="tagger.site"
              />

              {/* <ProjectLink
                to="/ffmpegwasm"
                icon={Zap}
                label="ffmpeg wasm"
              /> */}

              <ProjectLink
                to="/listogs"
                icon={List}
                label="Listogs"
              />

              <ProjectLink
                to="/ALS2CUE"
                icon={Music}
                label="ALS to CUE"
              />

              <ProjectLink
                to="/vibrant"
                icon={Palette}
                label="Vibrant.js Demo"
              />

              <li className={styles.tooltipContainer} data-tooltip="Discord2Playlist">
                <Link
                  href="/discord2playlist"
                  className={styles.navbarItem}
                  style={{
                    color: sidebarTextColor,
                    background: pathname === "/discord2playlist"
                      ? colors.LightMuted
                      : 'transparent'
                  }}
                >
                  <div className={styles.iconContainer}>
                    <svg 
                      width="20" 
                      height="20" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                    </svg>
                  </div>
                  <span className={!sidebarActive ? styles.hidden : ''}>Discord2Playlist</span>
                </Link>
              </li>

              <li className={styles.tooltipContainer} data-tooltip="Vinyl2Digital">
                <Link
                  href="/vinyl2digital"
                  className={styles.navbarItem}
                  style={{
                    color: sidebarTextColor,
                    background: pathname === "/vinyl2digital"
                      ? colors.LightMuted
                      : 'transparent'
                  }}
                >
                  <div className={styles.iconContainer}>
                    <svg 
                      width="20" 
                      height="20" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                    </svg>
                  </div>
                  <span className={!sidebarActive ? styles.hidden : ''}>Vinyl2Digital</span>
                </Link>
              </li>

              <li className={styles.tooltipContainer} data-tooltip="FFMPEG WASM">
                <Link
                  href="/ffmpegwasm"
                  className={styles.navbarItem}
                  style={{
                    color: sidebarTextColor,
                    background: pathname === "/ffmpegwasm"
                      ? colors.LightMuted
                      : 'transparent'
                  }}
                >
                  <div className={styles.iconContainer}>
                    <svg 
                      width="20" 
                      height="20" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                  </div>
                  <span className={!sidebarActive ? styles.hidden : ''}>FFMPEG WASM</span>
                </Link>
              </li>

              {/* <li className={styles.tooltipContainer} data-tooltip="Auto-Split Tool">
                <Link
                  href="/auto-split"
                  className={styles.navbarItem}
                  style={{
                    color: sidebarTextColor,
                    background: pathname === "/auto-split"
                      ? colors.LightMuted
                      : 'transparent'
                  }}
                >
                  <div className={styles.iconContainer}>
                    <svg 
                      width="20" 
                      height="20" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                    </svg>
                  </div>
                  <span className={!sidebarActive ? styles.hidden : ''}>Auto-Split Tool</span>
                </Link>
              </li> */}

              {/* <li className={styles.tooltipContainer} data-tooltip="Waveform Visualizer">
                <Link
                  href="/waveform-visualizer"
                  className={styles.navbarItem}
                  style={{
                    color: sidebarTextColor,
                    background: pathname === "/waveform-visualizer"
                      ? colors.LightMuted
                      : 'transparent'
                  }}
                >
                  <div className={styles.iconContainer}>
                    <svg 
                      width="20" 
                      height="20" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  </div>
                  <span className={!sidebarActive ? styles.hidden : ''}>Waveform Visualizer</span>
                </Link>
              </li> */}

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
              
              {/* <ProjectLink
                to="/popularify"
                icon={BarChart}
                label="Popularify"
              />
               */}
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
                    <a href="/pdf/Martin_Barker_Resume.pdf"
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
                  key={`${randomImage}-${isMobile}`} // Force re-render when mobile state changes
                  src={getThumbnailPath(randomImage)}
                  alt="Random aesthetic"
                  className={styles.colorImage}
                  onClick={handleImageClick}
                  loading="lazy"
                  decoding="async"
                  style={{
                    willChange: isMobile ? 'auto' : (sidebarActive ? 'auto' : 'transform, opacity'),
                    backfaceVisibility: isMobile ? 'visible' : 'hidden',
                    transform: isMobile ? 'none' : 'translateZ(0)', // No hardware acceleration on mobile
                    opacity: imageLoaded ? 1 : 0.8,
                    transition: 'opacity 0.3s ease'
                  }}
                  onLoad={(e) => {
                    // Optimize image rendering after load
                    setImageLoaded(true);
                    e.target.style.willChange = 'auto';
                  }}
                  onError={(e) => {
                    console.warn('Failed to load thumbnail:', e.target.src);
                    // Hide image on error to prevent layout issues
                    e.target.style.display = 'none';
                  }}
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
              <div className={styles.contentBody}>{children}</div>
            </div>
          </main>
          {imageModalOpen && (
            <ImageModal
              imageUrl={getThumbnailPath(randomImage, true)} // Force desktop thumbnail for modal
              onClose={() => setImageModalOpen(false)} 
            />
          )}
        </div>
        </body>
      </html>
    </ColorContext.Provider>
  );
} 