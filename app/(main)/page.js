'use client'
/* eslint-disable @next/next/no-img-element */
import React, { useContext } from 'react';
import styles from './page.module.css';
import { ColorContext } from './ColorContext';
// remove the broken import
// instead reference the public asset by its URL:
const headshot = '/images/headshot.jpg';

// Metadata is now handled in layout.js since this is a client component

export default function Home() {
  const { colors } = useContext(ColorContext);

  // Function to darken a color (similar to Vibrant.js)
  const darkenColor = (color, amount = 0.3) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - Math.floor(255 * amount));
    const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - Math.floor(255 * amount));
    const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - Math.floor(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Function to calculate readable text color based on background color
  const getReadableTextColor = (backgroundColor) => {
    const color = backgroundColor.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 125 ? '#000' : '#fff';
  };

  // Create dynamic gradient from ColorContext colors
  const createDynamicGradient = () => {
    if (!colors) {
      // Fallback gradient if colors aren't available
      return 'linear-gradient(45deg, #667eea, #764ba2, #f093fb, #f5576c, #4facfe, #00f2fe)';
    }

    // Create gradient using the available colors with different darkening levels
    const colorArray = [
      colors.Vibrant || '#667eea',
      darkenColor(colors.DarkVibrant || '#764ba2', 0.2),
      colors.LightVibrant || '#f093fb',
      darkenColor(colors.Muted || '#f5576c', 0.1),
      colors.LightMuted || '#4facfe',
      darkenColor(colors.DarkMuted || '#00f2fe', 0.3)
    ];

    return `linear-gradient(45deg, ${colorArray.join(', ')})`;
  };

  const gradientBackground = createDynamicGradient();
  const textColor = colors ? getReadableTextColor(colors.Vibrant || '#667eea') : '#ffffff';
  
  // Determine if background is light (for white glow effect)
  const isLightBackground = colors ? getReadableTextColor(colors.Vibrant || '#667eea') === '#000' : false;

  return (
    <div className={styles.homeContent}>
            {/* Hero Title Section */}
            <div 
              className={styles.heroSection}
              style={{
                '--gradient-colors': gradientBackground.replace('linear-gradient(45deg, ', '').replace(')', ''),
                color: textColor
              }}
            >
                <h1 
                  className={styles.heroTitle}
                  data-light-background={isLightBackground}
                >
                  Martin Barker
                </h1>
                <p className={styles.heroSubtitle}>Seattle-based full-stack engineer, vinyl archivist and open-source contributor</p>
            </div>

            {/* Top Section - 3 Column Layout */}
            <div className={styles.topSection}>

                {/* About Column */}
                <div className={styles.aboutColumn}>
                    <h2>About Me</h2>
                    <p>
                        Seattle software developer creating open-source free music applications.
                    </p>
                </div>

                {/* Image Column */}
                <div className={styles.imageColumn}>
                    <img src="/images/headshot.jpg" alt="Martin Barker" className={styles.headshot} />
                </div>

                {/* Details Column */}
                <div className={styles.detailsColumn}>
                    <h2>Details</h2>
                    <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Name:</span>
                        <span>Martin Barker</span>
                    </div>
                    <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Age:</span>
                        <span>{(() => {
                                const birthDate = new Date(1997, 8, 1); // September is month 8 (0-indexed)
                                const today = new Date();
                                let age = today.getFullYear() - birthDate.getFullYear();
                                const m = today.getMonth() - birthDate.getMonth();
                                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                                    age--;
                                }
                                return `${age} years`;
                            })()}</span>
                    </div>
                    <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Location:</span>
                        <span>Seattle, WA</span>
                    </div>
                </div>
                
            </div>

            {/* Projects Note */}
            <div className={styles.projectNote}>
                👈 Check out all my projects in the sidebar! From music digitization tools to web applications, 
                there&apos;s something for everyone interested in software and music preservation.
            </div>

            {/* Education Section */}
            <section className={styles.section}>
                <h2>Education</h2>
                <div className={styles.educationContent}>
                    <div className={styles.educationHeader}>
                        <h3>Oregon State University</h3>
                        <span className={styles.date}>September 2015 - July 2019</span>
                        <div className={styles.location}>Corvallis, OR</div>
                    </div>
                    <h4>Bachelor - Applied Computer Science (Focus: Cybersecurity)</h4>
                    <p>
                        My applied CS degree gave me the unique perspective of software development from a cybersecurity view. 
                        My courses included programming in languages such as Python, C++, C, as well as bash and Linux command line experience.
                        I also took courses on web development using NodeJS, HTML, CSS, JavaScript, and Django, as well as database setup and
                        management with SQL and PostgreSQL. My cybersecurity courses taught me computer networking protocols and security,
                        as well as threat detection / response.
                    </p>
                </div>
            </section>

            {/* Career Section */}
            <div className={styles.careerSection}>
                <h2 className={styles.sectionTitle}>Careers</h2>
                {[
                    {
                        company: "Allen Institute",
                        date: "November 2024 - Present",
                        location: "Seattle, WA",
                        title: "Software Developer III / Contractor",
                        responsibilities: [
                            "Developed Rhapso, a Python package for stitching petabyte-scale microscopy data using Ray distributed computing, AWS, and Zarr storage format",
                            "Built configurable pipelines for interest point detection and dataset splitting, integrated with Fiji and BigStitcher, processing datasets exceeding 1PB",
                            "Presented Rhapso project progress to cross-functional teams, mentoring junior developers and driving collaboration on distributed systems",
                            "Working for the office of the CTO developing petabyte-scale microscopy image stitching programs for biological research",
                        ],
                    },
                    {
                        company: "Philips Ultrasound",
                        date: "February 2022 - May 2024",
                        location: "Bothell, WA",
                        title: "Senior DevOps / Software Developer",
                        responsibilities: [
                            "Developed .NET applications in C# integrating front-end UIs with backend GitHub and SQL APIs",
                            "Led the migration of 117,000+ work items from IBM RTC to Azure DevOps, released open-source migration tools",
                            "Designed HIPAA-compliant tools for logging and testing ultrasound systems, improving reliability and regulatory compliance",
                            "Managed NuGet/Artifactory packaging, ensuring efficient build/test/release of .NET applications",
                            "Implemented GitHub Actions for CI/CD pipelines, enhancing deployment automation and reliability",
                        ],
                    },
                    {
                        company: "Alaska Airlines",
                        date: "September 2021 - November 2021",
                        location: "Seattle, WA",
                        title: "Software Developer Contractor",
                        responsibilities: [
                            "Developed and maintained web and mobile products, improving user experience and functionality",
                            "Increased accessibility score for alaskaairlines.com by 30% for screen readers and navigation devices",
                        ],
                    },
                    {
                        company: "Bungee Tech",
                        date: "January 2020 - August 2021",
                        location: "Seattle, WA",
                        title: "Software Engineer",
                        responsibilities: [
                            "Implemented front-end retail analytics graphs and tables, enabling sorting millions of rows of data",
                            "Designed JavaScript web scrapers in Node.js with Puppeteer to gather metadata for retail analytics",
                            "Continuously deployed and monitored performance in Amazon Web Services and AWS Lambda",
                            "Managed PostgreSQL databases, integrated new front-end features for filtering / querying data",
                        ],
                    },
                    {
                        company: "Zume, Inc",
                        date: "September 2019 - January 2020",
                        location: "Seattle, WA",
                        title: "DevOps Engineer (Software Engineer I)",
                        responsibilities: [
                            "Automated CI/CD build pipelines in Google Cloud Platform with Docker / Terraform / Kubernetes",
                        ],
                    },
                    {
                        company: "MoxiWorks",
                        date: "June 2018 - August 2019",
                        location: "Seattle, WA",
                        title: "Quality Assurance Engineer Intern",
                        responsibilities: [
                            "Strengthened customer experiences by writing full coverage testing suites in Java Groovy",
                        ],
                    },
                    {
                        company: "KBVR FM / TV",
                        date: "September 2016 - April 2018",
                        location: "Corvallis, OR",
                        title: "Student Engineer",
                        responsibilities: [
                            "Learned and taught state-of-the-art media software and hardware.",
                            "Ran audio for on-location OSU football broadcasts.",
                            "Represented OSU at the National Association of Broadcasters convention.",
                        ],
                    }
                ].map((job, index) => (
                    <div key={index} className={styles.careerItem}>
                        <div className={styles.careerHeader}>
                            <h3>{job.company}</h3>
                            <span className={styles.date}>{job.date}</span>
                            <div className={styles.location}>{job.location}</div>
                        </div>
                        <h4>{job.title}</h4>
                        <ul>
                            {job.responsibilities.map((task, idx) => (
                                <li key={idx}>{task}</li>
                            ))}                        </ul>
                    </div>
                ))}
            </div>
        </div>
);
}
