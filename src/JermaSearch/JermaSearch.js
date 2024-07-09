import React, { useState } from 'react';
import './JermaSearch.css';  // Assuming you have a CSS file for styles

const apiUrl = window.location.hostname === 'localhost' ? 'http://localhost:3030' : 'http://jermasearch.com/internal-api';
// Set api url to "localhost:3030" if project is running locally, else set to "jermasearch.com"

const JermaSearch = () => {
    const [results, setResults] = useState([]);
    const [totalResults, setTotalResults] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [expanded, setExpanded] = useState({});
    const [error, setError] = useState(""); 
    const [searchPage, setSearchPage] = useState(0); // State to track the current search page
    const [sortOrder, setSortOrder] = useState("mostRecent"); // State to track the sorting order

    const handleToggle = (index) => {
        setExpanded(prevState => ({
            ...prevState,
            [index]: !prevState[index]
        }));
    };

    // Function to sort results based on upload date
    const sortResults = (results, order) => {
        return results.sort((a, b) => {
            const dateA = new Date(a.upload_date.slice(0, 4), a.upload_date.slice(4, 6) - 1, a.upload_date.slice(6, 8));
            const dateB = new Date(b.upload_date.slice(0, 4), b.upload_date.slice(4, 6) - 1, b.upload_date.slice(6, 8));
            return order === "mostRecent" ? dateB - dateA : dateA - dateB;
        });
    };

    // Get search results from backend-node server
    const handleSearch = async (e, page = 0) => {
        if (e) e.preventDefault(); // Prevent default form submission behavior if event exists
        try {
            console.log(`handleSearch ${searchTerm} page ${page}`);
            const response = await fetch(`${apiUrl}/algolia/search/${page}/${searchTerm}`)
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            } else {
                const result = await response.json(); 
                console.log('result=', result)
                
                var hits = result.hits
                var numberHits = result.numberHits
                var currentPage = result.currentPage
                var numberPages = result.numberPages
                setTotalResults(numberHits)

                const sortedResults = sortResults(page === 0 ? hits : [...results, ...hits], sortOrder);
                setResults(sortedResults);
                setError('');
            }
        } catch (error) {
            setError(error.message); // Set only the error message
            if (page === 0) setResults([]); // Ensure results is an empty array on error for the initial search
        }
    }

    // Handler for "Show More" button
    const handleShowMore = () => {
        const nextPage = searchPage + 1;
        setSearchPage(nextPage);
        handleSearch(null, nextPage);
    }

    // Handler for changing the sort order
    const handleSortChange = (e) => {
        setSortOrder(e.target.value);
        const sortedResults = sortResults(results, e.target.value);
        setResults(sortedResults);
    };

    // Function to format date
    const formatDate = (dateString) => {
        const date = new Date(dateString.slice(0, 4), dateString.slice(4, 6) - 1, dateString.slice(6, 8));
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    return (
        <section className="todo-container">
            <div className="todo">
                <h1 className="header">
                    Jerma985 Search
                </h1>

                {error && <h1 className="error">{error}</h1>}

                <form onSubmit={(e) => { setSearchPage(0); handleSearch(e, 0); }}>
                    <div>
                        <input
                            type="text"
                            placeholder="Search quote:"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)} // Update searchTerm state
                        />
                        <button type="submit">Submit</button>
                    </div>
                </form>

                <div className="results-count">
                    {totalResults != 0 ? `Found ${totalResults} results:` : ""}
                </div>

                <div className="sort-options">
                    <label>Sort by: </label>
                    <select value={sortOrder} onChange={handleSortChange}>
                        <option value="mostRecent">Most Recent</option>
                        <option value="furthestAway">Furthest Away</option>
                    </select>
                </div>

                <div className="todo-content">
                    {Array.isArray(results) && results.length > 0 ? (
                        results.map((todoItem, index) => {
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
                                        <p><strong>Upload Date:</strong> {formatDate(todoItem.upload_date)}</p>
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
                        })
                    ) : (
                        <div>No results found</div>
                    )}
                </div>

                {Array.isArray(results) && results.length > 0 && (
                    <div className="pagination">
                        <button onClick={handleShowMore}>Show More</button>
                    </div>
                )}
            </div>
        </section>
    );
}

export default JermaSearch;
