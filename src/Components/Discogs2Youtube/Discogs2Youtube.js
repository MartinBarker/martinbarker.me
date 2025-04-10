import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
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
    const [addVideoResponse, setAddVideoResponse] = useState({ message: '', isError: false }); // Update state to include error flag
    const [urlError, setUrlError] = useState(''); // State for URL fetch error
    const [discogsAuthUrl, setDiscogsAuthUrl] = useState('');
    const [discogsAccessToken, setDiscogsAccessToken] = useState(null);
    const [discogsAuthStatus, setDiscogsAuthStatus] = useState(false);
    const [petTypes, setPetTypes] = useState(''); // State for petTypes secret

    useEffect(() => {
        // Fetch the sign-in URL on component mount
        const fetchSignInURL = async () => {
            try {
                const response = await axios.get('http://localhost:3030/generateURL'); // Ensure the backend route matches
                //console.log('Generated URL:', response.data.url);
                setGeneratedURL(response.data.url);
            } catch (error) {
                console.error('Error during generateURL request:', error);
                setUrlError(`Error generating URL: ${error.response?.status || 'Unknown'} - ${error.response?.data?.error || error.message}`);
            }
        };

        // Fetch the authentication status on component mount
        const fetchYouTubeAuthStatus = async () => {
            try {
                const response = await axios.get('http://localhost:3030/authStatus');
                console.log('YouTube Auth Status:', response.data.isAuthenticated);
                setAuthStatus(response.data.isAuthenticated);
            } catch (error) {
                console.error('Error fetching auth status:', error);
            }
        };

        // Fetch Discogs sign-in URL on component mount
        const fetchDiscogsAuthUrl = async () => {
            try {
                const response = await axios.get('http://localhost:3030/discogs/generateURL');
                //console.log('Discogs Auth URL:', response.data.url);
                setDiscogsAuthUrl(response.data.url);
            } catch (error) {
                console.error('Error fetching Discogs auth URL:', error.message);
            }
        };

        fetchSignInURL();
        fetchYouTubeAuthStatus();
        fetchDiscogsAuthUrl();
    }, []);

    useEffect(() => {
        // Fetch Discogs authentication status
        const fetchDiscogsAuthStatus = async () => {
            try {
                const response = await axios.get('http://localhost:3030/discogs/authStatus');
                console.log('Discogs Auth Status:', response.data.isAuthenticated);
                setDiscogsAuthStatus(response.data.isAuthenticated);
            } catch (error) {
                console.error('Error fetching Discogs auth status:', error.message);
            }
        };

        fetchDiscogsAuthStatus();
    }, [discogsAccessToken]);

    useEffect(() => {
        const fetchAwsSecretError = async () => {
            try {
                const response = await axios.get('http://localhost:3030/awsSecretError');
                console.log('AWS Secret Error:', response.data.error);
            } catch (error) {
                console.error('Error fetching AWS secret error:', error.message);
            }
        };

        fetchAwsSecretError();
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
            setAddVideoResponse({ message: 'Success: Video added to playlist!', isError: false }); // Success message
        } catch (error) {
            console.error('Error adding video to playlist:', error);
            const errorMessage = error.response
                ? `Error: ${JSON.stringify(error.response.data, null, 2)}`
                : 'An unknown error occurred.';
            setAddVideoResponse({ message: errorMessage, isError: true }); // Error message
        }
    };

    const handleQuickFill = (value) => {
        setDiscogsInput(value);
    };

    const fetchYouTubeAuthUrl = async () => {
        try {
            const response = await axios.get('http://localhost:3030/generateURL');
            console.log('YouTube Auth URL:', response.data.url);
            window.location.href = response.data.url; // Open the URL in the current tab
        } catch (error) {
            console.error('Error fetching YouTube auth URL:', error.message);
        }
    };

    const initiateDiscogsAuth = () => {
        if (discogsAuthUrl) {
            window.location.href = discogsAuthUrl; // Open the URL in the current tab
        }
    };

    const handleDiscogsCallback = async (oauthToken, oauthVerifier) => {
        try {
            const response = await axios.get('http://localhost:3030/discogs/callback', {
                params: { oauth_token: oauthToken, oauth_verifier: oauthVerifier },
            });
            console.log('Discogs Access Token:', response.data);
            setDiscogsAccessToken(response.data);
        } catch (error) {
            console.error('Error handling Discogs callback:', error.message);
        }
    };

    const handleFetchPetTypes = async () => {
        try {
            const response = await axios.get('http://localhost:3030/fetchPetTypes');
            console.log('Pet Types:', response.data.petTypes);
            setPetTypes(response.data.petTypes);
        } catch (error) {
            console.error('Error fetching petTypes:', error.message);
            setPetTypes(`Error: ${error.message}`);
        }
    };

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const oauthToken = urlParams.get('oauth_token');
        const oauthVerifier = urlParams.get('oauth_verifier');

        if (oauthToken && oauthVerifier) {
            handleDiscogsCallback(oauthToken, oauthVerifier);
        }
    }, []);

    return (
        <>
            <Helmet>
                <title>Discogs2Youtube Preview</title>
                <meta name="description" content="Convert Discogs data to YouTube links with Discogs2Youtube." />
                <meta property="og:title" content="Discogs2Youtube" />
                <meta property="og:description" content="Manage your Discogs and YouTube playlists seamlessly." />
                <meta property="og:image" content="https://i.ytimg.com/vi/AF5dSwXQwbo/maxresdefault.jpg" />
                <meta property="og:url" content="http://localhost:3001/discogs2youtube" />
                <meta name="twitter:card" content="summary_large_image" />
            </Helmet>
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
                        <>
                            <p className={styles.authStatus}>You are not signed in to YouTube. Please sign in below:</p>
                            <button className={styles.searchButton} onClick={fetchYouTubeAuthUrl}>
                                Authenticate with YouTube
                            </button>
                        </>
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
                            {addVideoResponse.message && (
                                <p
                                    className={
                                        addVideoResponse.isError ? styles.error : styles.success
                                    }
                                >
                                    {addVideoResponse.message}
                                </p>
                            )}
                        </div>
                    )}
                </section>

                {/* Combined Discogs Authentication & Search Section */}
                <section className={styles.section}>
                    <h2 className={styles.subtitle}>Discogs Authentication</h2>
                    {discogsAuthStatus ? (
                        <>
                            <p className={styles.success}>You are signed in to Discogs!</p>
                            <p className={styles.description}>
                                Enter an artist ID, label ID, or list to search Discogs.
                            </p>
                            <div className={styles.quickFillContainer}>
                                <span className={styles.quickFill} onClick={() => handleQuickFill('[l23152]')}>
                                    labelId
                                </span>
                                <span className={styles.quickFill} onClick={() => handleQuickFill('[a290309]')}>
                                    artistId
                                </span>
                                <span className={styles.quickFill} onClick={() => handleQuickFill('https://www.discogs.com/lists/439152')}>
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
                                <pre className={styles.response}>{discogsResponse}</pre>
                            )}
                        </>
                    ) : (
                        <>
                            <p className={styles.authStatus}>You are not signed in to Discogs. Please sign in below:</p>
                            <button className={styles.searchButton} onClick={initiateDiscogsAuth}>
                                Authenticate with Discogs
                            </button>
                        </>
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

                {/* Fetch PetTypes Section */}
                <section className={styles.section}>
                    <button className={styles.smallButton} onClick={handleFetchPetTypes}>
                        Fetch PetTypes
                    </button>
                    {petTypes && <pre className={styles.response}>{petTypes}</pre>}
                </section>
            </div>
        </>
    );
}

export default Discogs2Youtube;