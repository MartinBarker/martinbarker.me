import React from 'react';
import styles from './Home.module.css';
import headshot from '../images/headshot.jpg';

const Home = () => {
    return (
        <div className={styles.homeContent}>
            <section className={styles.aboutMe}>
                <h2>About me</h2>
                <div className={styles.aboutContainer}>
                    <img src={headshot} alt="Martin Barker headshot" className={styles.headshot} />
                    <p className={styles.aboutText}>
                        I am a Seattle software developer who graduated in 2019 with a BS in Applied Computer Science (Cybersecurity) from Oregon State University.
                        In my spare time, I create free open-source software to help improve the preservation and digitization of music online.
                    </p>
                </div>
            </section>

            <section className={styles.details}>
                <h3>Details</h3>
                <p><strong>Name:</strong> Martin Anthony Barker</p>
                <p><strong>Age:</strong> 26 years</p>
                <p><strong>Location:</strong> Seattle, WA</p>
            </section>

            <section className={styles.education}>
                <h2>Education</h2>
                <h3>Oregon State University</h3>
                <p>September 2015 - July 2019</p>
                <p><strong>Bachelor - Applied Computer Science (Focus: Cybersecurity)</strong></p>
                <p>
                    My applied CS degree gave me the unique perspective of software development from a cybersecurity view.
                    My courses included programming in Python, C++, C, as well as bash and Linux command line experience.
                    I also took courses on web development using NodeJS, HTML, CSS, JavaScript, and Django.
                </p>
            </section>

            {/* Other sections remain the same */}
        </div>
    );
};

export default Home;
