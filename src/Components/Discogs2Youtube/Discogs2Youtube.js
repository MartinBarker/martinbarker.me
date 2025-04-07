import React, { useState, useEffect } from 'react';
import styles from './Discogs2Youtube.module.css';
import axios from 'axios';

function Discogs2Youtube() {
    const [authStatus, setAuthStatus] = useState(false); // State for YouTube authentication status
    const [generatedURL, setGeneratedURL] = useState(''); // State for the YouTube sign-in URL
    const [discogsInput, setDiscogsInput] = useState(''); // State for Discogs search input
    const [discogsResponse, setDiscogsResponse] = useState(''); // State for Discogs backend response
    const [playlistName, setPlaylistName] = useState(''); // State for playlist name
    const [playlistResponse, setPlaylistResponse] = useState(''); // State for playlist creation response
    const [playlistId, setPlaylistId] = useState(''); // State for playlist ID
    const [videoId, setVideoId] = useState(''); // State for YouTube video ID
    const [addVideoResponse, setAddVideoResponse] = useState(''); // State for add video response

    useEffect(() => {
        // Fetch the sign-in URL on component mount
        const fetchSignInURL = async () => {
            try {
                const response = await axios.get('http://localhost:3030/generateURL'); // Ensure the backend route matches
                console.log('Generated URL:', response.data.url);
                setGeneratedURL(response.data.url);
            } catch (error) {
                console.error('Error during generateURL request:', error);
                if (error.response) {
                    console.log('Error Response:', error.response.data);
                }
            }
        };

        // Fetch the authentication status on component mount
        const fetchAuthStatus = async () => {
            try {
                const response = await axios.get('http://localhost:3030/authStatus');
                console.log('Auth Status:', response.data.isAuthenticated);
                setAuthStatus(response.data.isAuthenticated);
            } catch (error) {
                console.error('Error fetching auth status:', error);
            }
        };

        fetchSignInURL();
        fetchAuthStatus();
    }, []);

    const handleDiscogsSearch = async () => {
        try {
            const response = await axios.post('http://localhost:3030/discogsAuth', { query: discogsInput });
            console.log('Discogs Response:', response.data);
            setDiscogsResponse(
                `Type: ${response.data.type}, ID: ${response.data.id}\nAPI Response: ${JSON.stringify(response.data.apiResponse, null, 2)}`
            );
        } catch (error) {
            console.error('Error during Discogs search:', error);
            if (error.response) {
                setDiscogsResponse(error.response.data.error || 'An error occurred.');
            }
        }
    };

    const handleCreatePlaylist = async () => {
        try {
            const response = await axios.post('http://localhost:3030/createPlaylist', { name: playlistName });
            console.log('Playlist Creation Response:', response.data);
            setPlaylistResponse(`Playlist created: ${response.data.title} (ID: ${response.data.id})`);
        } catch (error) {
            console.error('Error creating playlist:', error);
            if (error.response) {
                setPlaylistResponse(error.response.data.error || 'An error occurred.');
            }
        }
    };

    const handleAddVideoToPlaylist = async () => {
        try {
            const response = await axios.post('http://localhost:3030/addVideoToPlaylist', {
                playlistId,
                videoId,
            });
            console.log('Add Video Response:', response.data);
            setAddVideoResponse(`Success: ${JSON.stringify(response.data, null, 2)}`);
        } catch (error) {
            console.error('Error adding video to playlist:', error);
            if (error.response) {
                setAddVideoResponse(`Error: ${JSON.stringify(error.response.data, null, 2)}`);
            } else {
                setAddVideoResponse('An unknown error occurred.');
            }
        }
    };

    const handleQuickFill = (value) => {
        setDiscogsInput(value);
    };

    return (
        <div className={styles.container}>
            {/* General Site Description Section */}
            <section className={styles.section}>
                <h1 className={styles.title}>Discogs2Youtube</h1>
                <p className={styles.description}>
                    Welcome to Discogs2Youtube! This tool allows you to authenticate with YouTube and Discogs to manage playlists and search for artists, labels, or lists.
                </p>
            </section>

            {/* YouTube Auth Section */}
            <section className={styles.section}>
                <h2 className={styles.subtitle}>YouTube Authentication</h2>
                {authStatus ? (
                    <p className={styles.authStatus}>You are signed in to YouTube!</p>
                ) : (
                    <p className={styles.authStatus}>You are not signed in to YouTube. Please sign in below:</p>
                )}
                {generatedURL && (
                    <p className={styles.generatedURL}>
                        Sign-In URL: <a href={generatedURL}>{generatedURL}</a>
                    </p>
                )}
                {authStatus && (
                    <div>
                        <h3 className={styles.subtitle}>Add Video to Playlist</h3>
                        <input
                            type="text"
                            className={styles.input}
                            placeholder="Enter Playlist ID"
                            value={playlistId}
                            onChange={(e) => setPlaylistId(e.target.value)}
                        />
                        <input
                            type="text"
                            className={styles.input}
                            placeholder="Enter YouTube Video ID"
                            value={videoId}
                            onChange={(e) => setVideoId(e.target.value)}
                        />
                        <button className={styles.searchButton} onClick={handleAddVideoToPlaylist}>
                            Add Video to Playlist
                        </button>
                        {addVideoResponse && (
                            <pre className={styles.response}>{addVideoResponse}</pre> // Display response in plaintext
                        )}
                    </div>
                )}
            </section>

            {/* Discogs Auth Section */}
            <section className={styles.section}>
                <h2 className={styles.subtitle}>Discogs Authentication</h2>
                <p className={styles.description}>
                    Enter an artist ID, label ID, or list to search Discogs. You can also click on the following quick-fill options:
                </p>
                <div className={styles.quickFillContainer}>
                    <span
                        className={styles.quickFill}
                        onClick={() => handleQuickFill('[l23152]')}
                    >
                        labelId
                    </span>
                    <span
                        className={styles.quickFill}
                        onClick={() => handleQuickFill('[a290309]')}
                    >
                        artistId
                    </span>
                    <span
                        className={styles.quickFill}
                        onClick={() => handleQuickFill('https://www.discogs.com/lists/439152')}
                    >
                        listId
                    </span>
                </div>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="Enter artist ID, label ID, or list"
                    value={discogsInput}
                    onChange={(e) => setDiscogsInput(e.target.value)}
                />
                <button className={styles.searchButton} onClick={handleDiscogsSearch}>
                    Search
                </button>
                {discogsResponse && (
                    <pre className={styles.response}>{discogsResponse}</pre> // Use <pre> for plaintext formatting
                )}
            </section>

            {/* Create Playlist Section */}
            {authStatus && (
                <section className={styles.section}>
                    <h2 className={styles.subtitle}>Create Playlist</h2>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="Enter playlist name"
                        value={playlistName}
                        onChange={(e) => setPlaylistName(e.target.value)}
                    />
                    <button className={styles.searchButton} onClick={handleCreatePlaylist}>
                        Create Playlist
                    </button>
                    {playlistResponse && <p className={styles.response}>{playlistResponse}</p>}
                </section>
            )}
        </div>
    );
}

export default Discogs2Youtube;
