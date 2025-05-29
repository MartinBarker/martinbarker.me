/* eslint-disable @next/next/no-img-element */
import Head from 'next/head';
import styles from './page.module.css';
// remove the broken import
// instead reference the public asset by its URL:
const headshot = '/images/headshot.jpg';

export default function Home() {
  return (
    <>
      <Head>
        <title>Martin Barker – Software Developer Portfolio</title>
        <meta property="og:title" content="Martin Barker – Software Developer Portfolio" />
        <meta property="og:description" content="Explore Martin Barker’s portfolio showcasing open-source music apps, projects & experience." />
        <meta property="og:image" content="https://alleninstitute.org/wp-content/uploads/2025/03/Martin-Barker-square-web.jpg" />
        <meta property="og:url" content="https://martinbarker.me/" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <div className={styles.homeContent}>
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
                        <span>Martin Anthony Barker</span>
                    </div>
                    <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Age:</span>
                        <span>27 years</span>
                    </div>
                    <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Location:</span>
                        <span>Seattle, WA</span>
                    </div>
                </div>
                
            </div>

            {/* Projects Note */}
            <div className={styles.projectNote}>
                👉 Check out all my projects in the sidebar! From music digitization tools to web applications, 
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
            <section className={styles.section}>
                <h2>Careers</h2>
                {[
                    {
                        company: "Allen Institute",
                        date: "November 2024 - Present",
                        location: "Seattle, WA | Philips",
                        title: "Software Engineer II",
                        responsibilities: [
                            "As a contract worker at the Allen Institute, my role involves working closely with the Office of the CTO to support and advance technology initiatives in the bioscience field. I focus on developing and implementing APIs and cloud-native applications, integrating cutting-edge AI technologies to enhance biological research. My responsibilities include full-stack development, cloud infrastructure management, and ensuring robust, scalable solutions in a collaborative, multi-disciplinary team environment.",
                        ],
                    },
                    {
                        company: "Philips Ultrasound",
                        date: "February 2022 - May 2024",
                        location: "Bothell, WA | Philips",
                        title: "Senior DevOps Engineer",
                        responsibilities: [
                            "Developed .NET applications in C# / C++, integrating GitHub API and SQL databases, enhancing functionality and efficiency of Ultrasound developer applications.",
                            "Wrote a Python script to lead the migration from IBM RTC to Azure DevOps for over 107,000 work items, attachments, parent/child relations, and comments.",
                            "Managed the NuGet/Artifactory package and release process, integrated into .NET applications.",
                            "Implemented GitHub Actions for CI/CD pipelines, enhancing deployment automation and reliability.",
                        ],
                    },
                    {
                        company: "Alaska Airlines",
                        date: "September 2021 - November 2021",
                        location: "Seattle, WA | Alaska Airlines",
                        title: "Software Developer Contractor",
                        responsibilities: [
                            "Developed and maintained the E-Commerce suite of web and mobile products.",
                            "Increased accessibility score for Alaska Airlines web/mobile web products.",
                        ],
                    },
                    {
                        company: "Bungee Tech",
                        date: "January 2020 - August 2021",
                        location: "Seattle, WA | Bungee Tech",
                        title: "Software Engineer",
                        responsibilities: [
                            "Added front-end features to websites displaying millions of rows of data.",
                            "Handled week-long on-call rotations resolving infrastructure and DevOps issues.",
                            "Wrote PostgreSQL queries, set up and managed databases for data health monitoring.",
                            "Responded to client feedback and bug reports.",
                        ],
                    },
                    {
                        company: "Zume, Inc",
                        date: "September 2019 - January 2020",
                        location: "Seattle, WA | Zume, Inc",
                        title: "DevOps Engineer (Software Engineer I)",
                        responsibilities: [
                            "Created Kubernetes clusters in Google Cloud Platform and installed Helm.",
                            "Wrote Helm charts, Dockerfiles, and automated deployments using Spinnaker pipelines.",
                            "Set up alert monitoring and handled cluster authorization with a security mindset.",
                        ],
                    },
                    {
                        company: "MoxiWorks",
                        date: "June 2018 - August 2019",
                        location: "Seattle, WA | moxiworks.com",
                        title: "Quality Assurance Engineer Intern",
                        responsibilities: [
                            "Wrote automated testing software in Java covering web products and APIs.",
                            "Strengthened programming habits for writing scalable, reusable code.",
                            "Collaborated with a team using agile development practices.",
                        ],
                    },
                    {
                        company: "KBVR FM / TV",
                        date: "September 2016 - April 2018",
                        location: "Corvallis, OR | orangemedianetwork.com",
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
                            ))}
                        </ul>
                    </div>
                ))}
            </section>
        </div>
    </>
);
}
