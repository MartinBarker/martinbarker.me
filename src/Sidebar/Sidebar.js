import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Sidebar.css';
import { FaMusic, FaPaintBrush, FaRecordVinyl, FaSpotify, FaSearch, FaHome, FaEnvelope, FaLinkedin, FaGithub, FaFilePdf } from 'react-icons/fa';

const Sidebar = ({ children }) => {
    const [isOpen, setIsOpen] = useState(window.innerWidth > 768);

    const toggleSidebar = () => setIsOpen(!isOpen);

    const handleIconClick = () => {
        setIsOpen(true);
    };

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth <= 768) {
                setIsOpen(false);
            } else {
                setIsOpen(true);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <div className="app-container">
            <div className={`sidebar ${isOpen ? 'open' : 'collapsed'}`}>
                <div className="sidebar-header">
                    <button className="sidebar-toggle" onClick={toggleSidebar}>
                        &#9776;
                    </button>
                    {isOpen && <div className="name-box">martinbarker.me</div>}
                </div>
                <nav className="sidebar-content">
                    <ul>
                        <li onClick={handleIconClick}>
                            <Link to="/">
                                <FaHome className="icon" />
                                {isOpen && <span>Home</span>}
                            </Link>
                        </li>
                        <li onClick={handleIconClick}>
                            <Link to="/tagger">
                                <FaMusic className="icon" />
                                {isOpen && <span>tagger.site</span>}
                            </Link>
                        </li>
                        <li onClick={handleIconClick}>
                            <Link to="/rendertune">
                                <FaPaintBrush className="icon" />
                                {isOpen && <span>RenderTune</span>}
                            </Link>
                        </li>
                        <li onClick={handleIconClick}>
                            <Link to="/vinyl2digital">
                                <FaRecordVinyl className="icon" />
                                {isOpen && <span>Vinyl2Digital</span>}
                            </Link>
                        </li>
                        <li onClick={handleIconClick}>
                            <Link to="/popularify">
                                <FaSpotify className="icon" />
                                {isOpen && <span>Popularify</span>}
                            </Link>
                        </li>
                        <li onClick={handleIconClick}>
                            <Link to="/jermasearch">
                                <FaSearch className="icon" />
                                {isOpen && <span>Jerma Search</span>}
                            </Link>
                        </li>
                    </ul>

                    <h2 className={`section-label ${isOpen ? '' : 'hidden'}`}>Contact</h2>
                    <ul>
                        <li onClick={handleIconClick}>
                            <a href="mailto:your-email@example.com">
                                <FaEnvelope className="icon" />
                                {isOpen && <span>Email</span>}
                            </a>
                        </li>
                        <li onClick={handleIconClick}>
                            <a href="/resume.pdf" target="_blank">
                                <FaFilePdf className="icon" />
                                {isOpen && <span>Resume</span>}
                            </a>
                        </li>
                        <li onClick={handleIconClick}>
                            <a href="https://linkedin.com/in/yourprofile" target="_blank">
                                <FaLinkedin className="icon" />
                                {isOpen && <span>LinkedIn</span>}
                            </a>
                        </li>
                        <li onClick={handleIconClick}>
                            <a href="https://github.com/yourprofile" target="_blank">
                                <FaGithub className="icon" />
                                {isOpen && <span>GitHub</span>}
                            </a>
                        </li>
                    </ul>
                </nav>
            </div>
            <div className="content-container">
                {children}
            </div>
        </div>
    );
};

export default Sidebar;
