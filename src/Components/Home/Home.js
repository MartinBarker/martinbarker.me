
import React from 'react';
import styles from './Home.module.css';
import headshot from '../../images/headshot.jpg';

const Home = () => {
    return (
        <div className={styles.homeContent}>
            {/* Image Section */}
            <div className={styles.imageSection}>
                <img src={headshot} alt="Martin Barker headshot" className={styles.headshot} />
            </div>

            {/* About and Details Section */}
            <div className={styles.aboutDetailsSection}>
                {/* About Column */}
                <div className={styles.aboutColumn}>
                    <h2>About Me</h2>
                    <p>
                        I am a Seattle software developer who graduated in 2019 with a BS in Applied Computer Science (Cybersecurity) from Oregon State University.
                        In my spare time, I create free open-source software to help improve the preservation and digitization of music online.
                    </p>
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
                <div className={styles.careerItem}>
                    <div className={styles.careerHeader}>
                        <h3>Philips Ultrasound</h3>
                        <span className={styles.date}>February 2022 - May 2024</span>
                        <div className={styles.location}>Bothell, WA | Philips</div>
                    </div>
                    <h4>Senior DevOps Engineer</h4>
                    <ul>
                        <li>Developed .NET applications in C# / C++, integrating GitHub API and SQL databases, enhancing functionality and efficiency of Ultrasound developer applications.</li>
                        <li>Wrote a Python script to lead the migration from IBM RTC to Azure DevOps for over 107,000 work items, attachments, parent/child relations, and comments.</li>
                        <li>Managed the NuGet/Artifactory package and release process, integrated into .NET applications.</li>
                        <li>Implemented GitHub Actions for CI/CD pipelines, enhancing deployment automation and reliability.</li>
                    </ul>
                </div>
                {/* Add other career items similarly */}
            </section>

            </div>
        </div>
    );
};

export default Home;
