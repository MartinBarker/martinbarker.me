import React, { useState } from 'react';
import algoliasearch from 'algoliasearch/lite';
import './JermaSearch.css';  // Assuming you have a CSS file for styles

const apiUrl = window.location.hostname === 'localhost' ? 'http://localhost:3030' : 'http://jermasearch.com/internal-api';
// Set api url to "localhost:3000" if project is running locally, else set to "jermasearch.com"

const JermaSearch = () => {
    const [todos, setTodos] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [expanded, setExpanded] = useState({});

    const handleToggle = (index) => {
        setExpanded(prevState => ({
            ...prevState,
            [index]: !prevState[index]
        }));
    };

    // Algolia search
    const handleSearch = async (term) => {
        /*
        setSearchTerm(term);
        if (term.length >= 3) {
            index
                .search(term)
                .then(({ hits }) => {
                    console.log('Search results:', hits);
                    setTodos(hits);
                })
                .catch(err => {
                    console.error('Algolia search error:', err);
                });
        }
        */
            try {
                setSearchTerm(term);
                // Make request to backend server
                console.log(`making api request to: ${apiUrl}/dbtest`)
                const response = await fetch(`${apiUrl}/dbtest`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const result = await response.text(); // Adjust this if your server responds with JSON or another format
                console.log("result = ", result)
                //setData(result);
                //setError(''); // Clear any previous errors
            } catch (error) {
                //console.error('Error fetching data:', error);
                //setError(error.message);
            }
        
    }

    return (
        <section className="todo-container">
            <div className="todo">
                <h1 className="header">
                    Jerma985 Search
                </h1>

                <div>
                    <div>
                        <input
                            type="text"
                            placeholder="Search quote:"
                            value={searchTerm}
                            onChange={(e) => handleSearch(e.target.value)}
                        />
                    </div>
                </div>

                <div className="results-count">
                    Found {todos.length} results:
                </div>

                <div className="todo-content">
                    {todos.map((todoItem, index) => {
                        const youtubeUrl = `https://www.youtube.com/watch?v=${todoItem.video_id}&t=${todoItem.start}s`;
                        const embedUrl = `https://www.youtube.com/embed/${todoItem.video_id}?start=${todoItem.start}`;
                        const thumbnailUrl = `https://img.youtube.com/vi/${todoItem.video_id}/0.jpg`;

                        return (
                            <div key={index} className="result-item">
                                <div className="thumbnail">
                                    <img src={thumbnailUrl} alt="video thumbnail" />
                                </div>
                                <div className="quote-info">
                                    <p><strong>Quote:</strong> {todoItem.quote}</p>
                                    <p><strong>Start:</strong> {new Date(todoItem.start * 1000).toISOString().substr(11, 8)}</p>
                                    <p><strong>Video:</strong> <a href={youtubeUrl} target="_blank" rel="noopener noreferrer">{todoItem.video_title}</a></p>
                                    <button onClick={() => handleToggle(index)}>
                                        {expanded[index] ? '▼ Hide quote in video' : '▶ View quote in video'}
                                    </button>
                                    {expanded[index] && (
                                        <div className="video-embed">
                                            <iframe
                                                width="560"
                                                height="315"
                                                src={embedUrl}
                                                title="YouTube video player"
                                                frameBorder="0"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                            ></iframe>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

export default JermaSearch;
