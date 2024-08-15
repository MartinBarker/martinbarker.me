import React from 'react';
import './Home.css';

const Home = () => {
    return (
        <div className="home-content">
            <h1>martinbarker.me</h1>
            <h3>View code for this page</h3>
            <section className="about-me">
                <h2>About me</h2>
                <p>
                    I am a Seattle software developer who graduated from 2019 with a BS in Applied Computer Science (Cybersecurity) from Oregon State University.
                    In my spare time I create free open-source software to help improve the preservation and digitization of music online.
                </p>
            </section>

            <section className="details">
                <h3>Details</h3>
                <p><strong>Name:</strong> Martin Anthony Barker</p>
                <p><strong>Age:</strong> 26 years</p>
                <p><strong>Location:</strong> Seattle, WA</p>
            </section>

            <section className="education">
                <h2>Education</h2>
                <h3>Oregon State University</h3>
                <p>September 2015 - July 2019</p>
                <p><strong>Bachelor - Applied Computer Science (Focus: Cybersecurity)</strong></p>
                <p>
                    My applied CS degree gave me the unique perspective of software development from a cybersecurity view.
                    My courses included programming in languages such as Python, C++, C, as well as bash and linux command line experience.
                    I also took courses on web development using NodeJS, HTML, CSS, Javascript, and Django.
                </p>
            </section>

            <section className="career">
                <h2>Careers</h2>
                <h3>Philips Ultrasound</h3>
                <p>February 2022 - May 2024</p>
                <p><strong>Senior DevOps Engineer</strong></p>
                <p>Developed .NET applications in C# / C++, integrating GitHub API and SQL databases, enhancing functionality and efficiency of Ultrasound developer applications.</p>

                <h3>Alaska Airlines</h3>
                <p>September 2021 - November 2021</p>
                <p><strong>Software Developer Contractor</strong></p>
                <p>Working at Alaska Airlines, I help to develop and maintain the E-Commerce suite of web and mobile products.</p>

                <h3>Bungee Tech</h3>
                <p>January 2020 - August 2021</p>
                <p><strong>Software Engineer</strong></p>
                <p>Bungee Tech empowers retailers and brands to compete effectively in an ever-changing landscape by collecting competitor product data, and visualizing that data to the clients online.</p>

                <h3>Zume, Inc</h3>
                <p>September 2019 - January 2020</p>
                <p><strong>DevOps Engineer (Software Engineer I)</strong></p>
                <p>Working at Zume before the Seattle office was laid off, I gained hands-on experience with the full DevOps pipeline.</p>

                <h3>MoxiWorks</h3>
                <p>June 2018 - August 2019</p>
                <p><strong>Quality Assurance Engineer Intern</strong></p>
                <p>MoxiWorks is a real estate tech startup located in Seattle, WA. As a QA engineer, I wrote automated testing software in Java to cover the Moxi suite of web products as well as their external API.</p>

                <h3>KBVR FM / TV</h3>
                <p>September 2016 - April 2018</p>
                <p><strong>Full Time - Student Engineer</strong></p>
                <p>At Orange Media Network I worked as a student engineer for OSU's TV / Radio station KBVR FM / TV.</p>
            </section>
        </div>
    );
};

export default Home;
