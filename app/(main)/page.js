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
                <p 
                  className={styles.heroSubtitle}
                  data-light-background={isLightBackground}
                >
                  Seattle-based full-stack engineer, vinyl archivist and open-source contributor
                </p>
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
                        company: "The Walt Disney Company",
                        date: "January 2026 - Present",
                        location: "Seattle, WA",
                        title: "Software Developer II / Contractor",
                        responsibilities: [
                            "Lead Seattle device lab manager, overseeing device provisioning, inventory, and cross-platform testing infrastructure",
                            "Collaborate with QA teams to define and execute testing strategies across a wide range of consumer devices",
                            "Build and maintain internal tools using Electron, React, and Socket.IO for real-time device management and test orchestration",
                            "Author and maintain Cucumber/Gherkin-based test suites in Java for behavior-driven end-to-end testing",
                            "Implement self-healing test automation to reduce flakiness and improve reliability across CI pipelines",
                            "Support DevOps workflows including deployment automation, environment management, and continuous integration/delivery",
                        ],
                    },
                    {
                        company: "Allen Institute",
                        date: "November 2024 - January 2026",
                        location: "Seattle, WA",
                        title: "Software Engineer II / Contractor",
                        responsibilities: [
                            "Developed modular, cloud-agnostic Python toolkits that accelerate scientific discovery through scalable data-processing pipelines",
                            "Built and optimized distributed workflows for aligning and fusing large 3D microscopy datasets, processing multi-terabyte and petabyte-scale imaging data",
                            "Designed pluggable components for image registration, feature matching, and global optimization, allowing scientists to swap algorithms and parameters with ease",
                            "Deployed pipelines across AWS clusters using Ray for distributed computing, optimizing cost, CPU/memory scheduling, and throughput",
                            "Engineered efficient I/O systems supporting Zarr, HDF5, and TIFF formats, ensuring high-performance data access across local and cloud environments",
                            "Collaborated with researchers and engineers to build modular, reproducible systems that accelerate scientific workflows in neuroscience and cell biology",
                        ],
                    },
                    {
                        company: "Philips Ultrasound",
                        date: "February 2022 - May 2024",
                        location: "Bothell, WA",
                        title: "Senior DevOps Engineer",
                        responsibilities: [
                            "Built HIPAA-compliant diagnostic logging and monitoring tools to ensure security and traceability across medical imaging systems",
                            "Led migration of 100,000+ work items from IBM RTC to Azure DevOps using custom Python automation, released as open-source on Philips' GitHub",
                            "Automated CI/CD pipelines using GitHub Actions and Azure DevOps, meeting uptime expectations and reducing build errors",
                            "Developed internal developer tools and services in C#, C++, and .NET to streamline ultrasound software development and testing",
                            "Managed artifact storage and versioning with Artifactory and NuGet, improving reliability and traceability in release management",
                            "Integrated GitHub APIs for analytics, audit logging, and internal reporting systems used by multiple engineering teams",
                            "Collaborated across software, hardware, and QA teams to ensure scalable, secure, and compliant infrastructure for FDA-regulated medical devices",
                        ],
                    },
                    {
                        company: "Alaska Airlines",
                        date: "September 2021 - November 2021",
                        location: "Seattle, WA",
                        title: "Contract Software Engineer",
                        responsibilities: [
                            "Contributed to front-end development for Alaska Airlines' E-Commerce suite, improving accessibility and performance across web and mobile platforms",
                            "Built and maintained responsive UI components using modern JavaScript frameworks to enhance booking and travel experience features",
                            "Improved accessibility scores by implementing WCAG-compliant design patterns and optimizing front-end workflows",
                            "Collaborated with UX and QA teams to deliver updates ensuring smooth customer experiences across devices",
                        ],
                    },
                    {
                        company: "Bungee Tech",
                        date: "January 2020 - August 2021",
                        location: "Seattle, WA",
                        title: "Software Engineer",
                        responsibilities: [
                            "Designed and deployed scalable data collection systems using Node.js, Puppeteer, and AWS for retail analytics",
                            "Developed and maintained web scrapers to aggregate real-time competitor pricing and inventory data from major e-commerce platforms",
                            "Automated deployment and monitoring pipelines to ensure continuous uptime and reliability of hundreds of scraping tasks",
                            "Optimized PostgreSQL queries and schemas to improve data retrieval speeds and reporting performance",
                            "Built front-end data exploration tools enabling filtering, sorting, and export of large datasets for analytics teams",
                            "Participated in on-call DevOps rotations, resolving incidents and maintaining high system reliability",
                        ],
                    },
                    {
                        company: "Zume, Inc",
                        date: "September 2019 - January 2020",
                        location: "Seattle, WA",
                        title: "DevOps Engineer (Software Engineer I)",
                        responsibilities: [
                            "Automated CI/CD pipelines with Docker, Kubernetes, and Spinnaker within Google Cloud Platform (GCP)",
                            "Created Kubernetes clusters and Helm charts from scratch to standardize deployments across dev, staging, and production",
                            "Configured load balancers, ingress controllers, and Terraform-managed infrastructure to enhance scalability and uptime",
                            "Developed custom Jenkins automation and webhook integrations to streamline build and release workflows",
                        ],
                    },
                    {
                        company: "MoxiWorks",
                        date: "June 2018 - September 2019",
                        location: "Seattle, WA",
                        title: "Quality Assurance Engineer Intern",
                        responsibilities: [
                            "Built automated testing suites in Java to verify functionality, reliability, and performance of MoxiWorks web products and APIs",
                            "Collaborated with developers and product managers in agile sprints to identify and reproduce defects early in the release cycle",
                            "Contributed to continuous integration workflows, integrating test automation into Jenkins pipelines",
                            "Improved test coverage and reduced manual regression testing time through reusable code and test frameworks",
                        ],
                    },
                    {
                        company: "KBVR FM / TV",
                        date: "September 2016 - January 2018",
                        location: "Corvallis, OR",
                        title: "Student Engineer",
                        responsibilities: [
                            "Engineered live audio and video productions for KBVR FM radio and KBVR TV, broadcasting 24/7 on 90.3 FM and channel 27",
                            "Trained students on professional audio, radio, and video production equipment and software",
                            "Ran on-location audio for OSU football and basketball broadcasts, streaming live via FM and online",
                            "Produced and edited podcasts and live radio-drama shows using Adobe Audition",
                            "Represented Oregon State at the National Association of Broadcasters convention in Las Vegas (2016, 2017)",
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
