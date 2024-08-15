import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Sidebar.css';

const Sidebar = ({ children }) => {
    const [isOpen, setIsOpen] = useState(window.innerWidth > 768);

    const toggleSidebar = () => setIsOpen(!isOpen);

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
                <button className="sidebar-toggle" onClick={toggleSidebar}>
                    &#9776;
                </button>
                {isOpen && (
                    <nav className="sidebar-content">
                        <ul>
                            <li><Link to="/">Home</Link></li>
                            <li>
                                <span>Projects</span>
                                <ul>
                                    <li><Link to="/tagger">tagger.site</Link></li>
                                    <li><Link to="/rendertune">RenderTune</Link></li>
                                    <li><Link to="/vinyl2digital">Vinyl2Digital</Link></li>
                                    <li><Link to="/popularify">Popularify</Link></li>
                                    <li><Link to="/jermasearch">Jerma Search</Link></li> {/* Added Jerma Search */}
                                </ul>
                            </li>
                            <li><Link to="/contact">Contact</Link></li>
                        </ul>
                    </nav>
                )}
            </div>
            <div className="content-container">
                {children}
            </div>
        </div>
    );
};

export default Sidebar;
