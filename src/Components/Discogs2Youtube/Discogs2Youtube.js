import React, { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import LiteYouTubeEmbed from 'react-lite-youtube-embed';
import 'react-lite-youtube-embed/dist/LiteYouTubeEmbed.css';
import styles from './Discogs2Youtube.module.css';
import axios from 'axios';
import YouTube from 'react-youtube';

// Create a logging wrapper for axios with full response logging
const loggedAxios = {
    get: async (url, config = {}) => {
        console.log(`🔍 GET Request to: ${url}`, config);
        try {
            const response = await axios.get(url, config);
            console.log(`✅ GET Response from ${url}:`, {
                status: response.status,
                statusText: response.statusText,
                data: response.data
            });
            return response;
        } catch (error) {
            console.error(`❌ GET Error from ${url}:`, error);
            throw error;
        }
    },
    post: async (url, data = {}, config = {}) => {
        console.log(`📮 POST Request to: ${url}`, { data, config });
        try {
            const response = await axios.post(url, data, config);
            console.log(`✅ POST Response from ${url}:`, {
                status: response.status,
                statusText: response.statusText,
                data: response.data
            });
            return response;
        } catch (error) {
            console.error(`❌ POST Error from ${url}:`, error);
            throw error;
        }
    }
};

function Discogs2Youtube() {
    const [authStatus, setAuthStatus] = useState(false);
    const [generatedURL, setGeneratedURL] = useState('');
    const [discogsInput, setDiscogsInput] = useState('');
    const [extractedId, setExtractedId] = useState('');
    const [discogsResponse, setDiscogsResponse] = useState('');
    const [playlistName, setPlaylistName] = useState('');
    const [playlistResponse, setPlaylistResponse] = useState('');
    const [playlistId, setPlaylistId] = useState('');
    const [videoId, setVideoId] = useState('');
    const [addVideoResponse, setAddVideoResponse] = useState({ message: '', isError: false });
    const [urlError, setUrlError] = useState('');
    const [discogsAuthUrl, setDiscogsAuthUrl] = useState('');
    const [discogsAccessToken, setDiscogsAccessToken] = useState(null);
    const [discogsAuthStatus, setDiscogsAuthStatus] = useState(false);
    const [petTypes, setPetTypes] = useState('');
    const [backgroundJobStatus, setBackgroundJobStatus] = useState({
        isRunning: false,
        isPaused: false,
        progress: { current: 0, total: 0, uniqueLinks: 0 },
    });
    const [backgroundJobError, setBackgroundJobError] = useState(null);
    const [backgroundJobErrorDetails, setBackgroundJobErrorDetails] = useState(null);
    const [waitTime, setWaitTime] = useState(0);
    const [youtubeLinks, setYoutubeLinks] = useState([]);
    const [initialVideoId, setInitialVideoId] = useState('bVbt8qG7Fl8');
    const [isDevMode, setIsDevMode] = useState(false);
    const [selectedType, setSelectedType] = useState(null);
    const [inputError, setInputError] = useState('');
    const [searchHistory, setSearchHistory] = useState([]);
    const [backgroundTasks, setBackgroundTasks] = useState(() => {
        const savedTasks = localStorage.getItem('backgroundTasks');
        return savedTasks ? JSON.parse(savedTasks) : [];
    });
    const [selectedTaskId, setSelectedTaskId] = useState(null);
    const [isPollingActive, setIsPollingActive] = useState(false);
    const pollingIntervalRef = useRef(null);
    const [taskInfo, setTaskInfo] = useState({
        artistName: '',
        taskStatus: 'waiting',
    });
    const [taskCompleted, setTaskCompleted] = useState(false);
    const [finalTaskStats, setFinalTaskStats] = useState({
        current: 0,
        total: 0,
        uniqueLinks: 0
    });
    const [expandedTasks, setExpandedTasks] = useState({});
    const [taskData, setTaskData] = useState(() => {
        const savedTaskData = localStorage.getItem('taskData');
        return savedTaskData ? JSON.parse(savedTaskData) : {};
    });
    const [loadedTasks, setLoadedTasks] = useState(new Set());

    const isLocal = window.location.hostname === 'localhost';
    const apiUrl = isLocal ? "http://localhost:3030" : "https://www.jermasearch.com/internal-api";

    useEffect(() => {
        localStorage.setItem('backgroundTasks', JSON.stringify(backgroundTasks));

        if (backgroundTasks.length > 0 && !selectedTaskId) {
            setSelectedTaskId(backgroundTasks[0].id);
            setYoutubeLinks(backgroundTasks[0].youtubeLinks || []);
        }

        if (isPollingActive && backgroundTasks.length === 0) {
            console.log('No more tasks, stopping polling');
            setIsPollingActive(false);
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        }
    }, [backgroundTasks, selectedTaskId, isPollingActive]);

    useEffect(() => {
        if (isPollingActive && !pollingIntervalRef.current && !taskCompleted) {
            console.log('Starting background tasks polling');

            const fetchBackgroundTasks = async () => {
                try {
                    const response = await loggedAxios.get(`${apiUrl}/backgroundTasks`);
                    const updatedTasks = response.data.tasks || [];

                    // Check for status updates only if not already completed
                    if (!taskCompleted) {
                        const statusResponse = await loggedAxios.get(`${apiUrl}/backgroundJobStatus`);

                        // Check if task is completed but was previously running
                        if (backgroundJobStatus.isRunning && !statusResponse.data.isRunning) {
                            // Task just completed - preserve final stats
                            setTaskCompleted(true);
                            const finalStats = {
                                current: statusResponse.data.progress.total,
                                total: statusResponse.data.progress.total,
                                uniqueLinks: statusResponse.data.progress.uniqueLinks
                            };
                            setFinalTaskStats(finalStats);
                            console.log('⏹️ Task completed, preserving final stats:', {
                                progress: statusResponse.data.progress
                            });

                            // Get final links one last time
                            const finalLinksResponse = await loggedAxios.get(`${apiUrl}/backgroundJobLinks`);
                            if (finalLinksResponse.data.links && finalLinksResponse.data.links.length > 0) {
                                setYoutubeLinks(finalLinksResponse.data.links);
                                saveTaskData(selectedTaskId, finalStats, finalLinksResponse.data.links);
                            }

                            setIsPollingActive(false);
                            if (pollingIntervalRef.current) {
                                clearInterval(pollingIntervalRef.current);
                                pollingIntervalRef.current = null;
                            }
                            return;
                        }

                        // Update the task status based on current job state
                        const updatedTasksWithStatus = updatedTasks.map(task => {
                            if (statusResponse.data.artistId && task.id === statusResponse.data.artistId) {
                                let status = 'completed';
                                if (statusResponse.data.isRunning) {
                                    status = 'in-progress';
                                    if (statusResponse.data.waitTime > 0) {
                                        status = 'rate-limited';
                                    } else if (statusResponse.data.isPaused) {
                                        status = 'paused';
                                    }
                                }
                                return { ...task, status };
                            }
                            return task;
                        });

                        setBackgroundTasks(updatedTasksWithStatus);

                        if (!taskCompleted) {
                            setBackgroundJobStatus((prev) => ({
                                ...prev,
                                isRunning: statusResponse.data.isRunning,
                                isPaused: statusResponse.data.isPaused || false,
                                progress: statusResponse.data.progress,
                            }));
                        }

                        setBackgroundJobError(statusResponse.data.error);
                        setBackgroundJobErrorDetails(statusResponse.data.errorDetails || null);
                        setWaitTime(statusResponse.data.waitTime || 0);

                        if (statusResponse.data.artistName) {
                            setTaskInfo(prev => ({
                                ...prev,
                                artistName: statusResponse.data.artistName,
                                taskStatus: statusResponse.data.isRunning ? 'in-progress' : 'completed'
                            }));
                        }
                    }

                    // Stop polling if completed or if server says to stop
                    if (taskCompleted || !response.data.shouldPoll) {
                        console.log(`Stopping polling: ${taskCompleted ? 'Task completed' : 'Server indicated to stop'}`);
                        setIsPollingActive(false);
                        if (pollingIntervalRef.current) {
                            clearInterval(pollingIntervalRef.current);
                            pollingIntervalRef.current = null;
                        }
                        return;
                    }

                    // Only fetch new links if task is still running and not completed
                    if (!taskCompleted && backgroundJobStatus.isRunning) {
                        const linksResponse = await loggedAxios.get(`${apiUrl}/backgroundJobLinks`);
                        if (linksResponse.data.links && linksResponse.data.links.length > 0) {
                            setYoutubeLinks(linksResponse.data.links);
                            saveTaskData(selectedTaskId, backgroundJobStatus.progress, linksResponse.data.links);
                        }
                    }

                    if (selectedTaskId) {
                        const selectedTask = updatedTasks.find(task => task.id === selectedTaskId);
                        if (selectedTask && selectedTask.youtubeLinks && selectedTask.youtubeLinks.length > 0) {
                            // Only update if not completed to avoid losing final data
                            if (!taskCompleted) {
                                setYoutubeLinks(selectedTask.youtubeLinks);
                                saveTaskData(selectedTaskId, backgroundJobStatus.progress, selectedTask.youtubeLinks);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error fetching background tasks:', error.message);
                }
            };

            fetchBackgroundTasks();
            pollingIntervalRef.current = setInterval(fetchBackgroundTasks, 2000);
        }

        // If task is completed, make sure polling stops
        if (taskCompleted && pollingIntervalRef.current) {
            console.log('Task completed, stopping polling');
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };
    }, [isPollingActive, apiUrl, selectedTaskId, backgroundJobStatus.isRunning, taskCompleted]);

    // Reset task completed state when starting a new task
    useEffect(() => {
        if (isPollingActive) {
            setTaskCompleted(false);
            setFinalTaskStats({
                current: 0,
                total: 0,
                uniqueLinks: 0
            });
        }
    }, [isPollingActive]);

    useEffect(() => {
        const fetchBackgroundTasks = async () => {
            try {
                const response = await loggedAxios.get(`${apiUrl}/backgroundTasks`);
                const updatedTasks = response.data.tasks || [];
                setBackgroundTasks(updatedTasks);

                if (updatedTasks.length > 0 && !selectedTaskId) {
                    setSelectedTaskId(updatedTasks[0].id);
                    setYoutubeLinks(updatedTasks[0].youtubeLinks || []);
                }
            } catch (error) {
                console.error('Error fetching background tasks:', error.message);
            }
        };

        fetchBackgroundTasks();

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [apiUrl, selectedTaskId]);

    useEffect(() => {
        const fetchSignInURL = async () => {
            try {
                const response = await loggedAxios.get(`${apiUrl}/generateURL`);
                setGeneratedURL(response.data.url);
            } catch (error) {
                console.error('Error during generateURL request:', error);
                setUrlError(`Error generating URL: ${error.response?.status || 'Unknown'} - ${error.response?.data?.error || error.message}`);
            }
        };

        const fetchYouTubeAuthStatus = async () => {
            try {
                const response = await loggedAxios.get(`${apiUrl}/authStatus`);
                console.log('YouTube Auth Status:', response.data.isAuthenticated);
                setAuthStatus(response.data.isAuthenticated);
            } catch (error) {
                console.error('Error fetching auth status:', error);
            }
        };

        const fetchDiscogsAuthUrl = async () => {
            try {
                const response = await loggedAxios.get(`${apiUrl}/discogs/generateURL`);
                setDiscogsAuthUrl(response.data.url);
            } catch (error) {
                console.error('Error fetching Discogs auth URL:', error.message);
            }
        };

        const savedDevMode = localStorage.getItem('isDevMode') === 'true';
        setIsDevMode(savedDevMode);

        fetchSignInURL();
        fetchYouTubeAuthStatus();
        fetchDiscogsAuthUrl();
    }, []);

    useEffect(() => {
        const fetchDiscogsAuthStatus = async () => {
            try {
                const response = await loggedAxios.get(`${apiUrl}/discogs/authStatus`);
                console.log('Discogs Auth Status:', response.data.isAuthenticated);
                setDiscogsAuthStatus(response.data.isAuthenticated);
            } catch (error) {
                console.error('Error fetching Discogs auth status:', error.message);
            }
        };

        fetchDiscogsAuthStatus();
    }, [discogsAccessToken]);

    useEffect(() => {
        let interval;
        if (backgroundJobStatus.isRunning && !backgroundJobStatus.isPaused && !taskCompleted) {
            interval = setInterval(async () => {
                try {
                    const response = await loggedAxios.get(`${apiUrl}/backgroundJobStatus`);

                    // Check if the task is now completed
                    if (!response.data.isRunning && backgroundJobStatus.isRunning) {
                        console.log('Task completed, saving final stats and stopping polling');
                        setTaskCompleted(true);
                        const finalStats = {
                            current: response.data.progress.total,
                            total: response.data.progress.total,
                            uniqueLinks: response.data.progress.uniqueLinks
                        };
                        setFinalTaskStats(finalStats);

                        // Fetch final links one last time
                        const finalLinksResponse = await loggedAxios.get(`${apiUrl}/backgroundJobLinks`);
                        if (finalLinksResponse.data.links && finalLinksResponse.data.links.length > 0) {
                            setYoutubeLinks(finalLinksResponse.data.links);
                            saveTaskData(selectedTaskId, finalStats, finalLinksResponse.data.links);
                        }

                        // Update background job status
                        setBackgroundJobStatus(prev => ({
                            ...prev,
                            isRunning: false,
                            progress: response.data.progress
                        }));

                        // Clear interval and stop polling
                        clearInterval(interval);
                        return;
                    }

                    // Only update if task is not completed
                    if (!taskCompleted) {
                        setBackgroundJobStatus((prev) => ({
                            ...prev,
                            progress: response.data.progress,
                        }));
                        setBackgroundJobError(response.data.error);
                        setBackgroundJobErrorDetails(response.data.errorDetails || null);
                        setWaitTime(response.data.waitTime || 0);

                        // Only fetch links if task is still running
                        const linksResponse = await loggedAxios.get(`${apiUrl}/backgroundJobLinks`);
                        setYoutubeLinks(linksResponse.data.links);
                        saveTaskData(selectedTaskId, response.data.progress, linksResponse.data.links);
                    }
                } catch (error) {
                    console.error('Error fetching background job status or links:', error.message);
                    setBackgroundJobError('Failed to fetch job status.');
                    setBackgroundJobErrorDetails(error);
                }
            }, 1000);
        }
        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [backgroundJobStatus.isRunning, backgroundJobStatus.isPaused, taskCompleted, apiUrl]);

    // Make sure newly active tasks are expanded by default
    useEffect(() => {
        if (selectedTaskId) {
            setExpandedTasks(prev => ({
                ...prev,
                [selectedTaskId]: true
            }));
        }
    }, [selectedTaskId]);

    // When tasks are initially loaded, expand the selected task
    useEffect(() => {
        if (backgroundTasks.length > 0 && selectedTaskId) {
            setExpandedTasks(prev => ({
                ...prev,
                [selectedTaskId]: true
            }));

            // 🛠️ ADD THIS
            const savedData = taskData[selectedTaskId];
            if (savedData) {
                const uniqueLinksCount = savedData.youtubeLinks ? savedData.youtubeLinks.length : 0;

                const progressData = {
                    current: savedData.progress?.current || uniqueLinksCount,
                    total: savedData.progress?.total || uniqueLinksCount,
                    uniqueLinks: uniqueLinksCount
                };

                console.log('🔄 Reloading saved task progress from localStorage:', progressData);

                setFinalTaskStats(progressData);
                setBackgroundJobStatus(prev => ({
                    ...prev,
                    progress: progressData
                }));

                if (savedData.youtubeLinks) {
                    setYoutubeLinks(savedData.youtubeLinks);
                }
            }
        }
    }, [backgroundTasks, selectedTaskId, taskData]);


    useEffect(() => {
        localStorage.setItem('taskData', JSON.stringify(taskData));
    }, [taskData]);

    // Add this effect to automatically expand new tasks
    useEffect(() => {
        if (backgroundTasks.length > 0) {
            const newTask = backgroundTasks[0];
            if (newTask && !expandedTasks[newTask.id]) {
                setExpandedTasks(prev => ({
                    ...prev,
                    [newTask.id]: true
                }));
                setLoadedTasks(prev => new Set([...prev, newTask.id]));
            }
        }
    }, [backgroundTasks]);

    const saveTaskData = (taskId, progress, links) => {
        setTaskData(prev => ({
            ...prev,
            [taskId]: {
                ...prev[taskId],
                progress: {
                    current: progress.current,
                    total: progress.total,
                    uniqueLinks: progress.uniqueLinks
                },
                youtubeLinks: links
            }
        }));
    };

    const saveTaskProgress = (taskId, progress, links) => {
        setTaskData(prev => ({
            ...prev,
            [taskId]: {
                ...prev[taskId],
                progress: {
                    current: progress.current,
                    total: progress.total,
                    uniqueLinks: progress.uniqueLinks
                },
                youtubeLinks: links
            }
        }));
    };

    const handleDiscogsSearch = async () => {
        if (!extractedId.trim() || !selectedType) return;

        if (!searchHistory.includes(discogsInput)) {
            setSearchHistory((prevHistory) => [discogsInput, ...prevHistory]);
        }

        try {
            const response = await loggedAxios.post(`${apiUrl}/discogsSearch`, {
                [selectedType]: extractedId,
                isDevMode,
            });

            if (selectedType === 'label') {
                const { labelName } = response.data;
                setDiscogsResponse(`Label: ${labelName}`);
                setTaskInfo(prev => ({
                    ...prev,
                    artistName: labelName,
                    taskStatus: 'starting'
                }));
                console.log(`Starting background job for label: ${labelName}`);

                setIsPollingActive(true);

                // Fetch updated background tasks immediately after starting the job
                const fetchUpdatedTasks = async () => {
                    try {
                        const tasksResponse = await loggedAxios.get(`${apiUrl}/backgroundTasks`);
                        setBackgroundTasks(tasksResponse.data.tasks || []);
                    } catch (error) {
                        console.error('Error fetching updated background tasks:', error.message);
                    }
                };
                fetchUpdatedTasks();
            } else {
                setDiscogsResponse(`Successfully fetched ${selectedType} data.`);
            }
        } catch (error) {
            console.error('Error during Discogs search:', error);

            // Fetch background tasks even if the search fails
            const fetchUpdatedTasks = async () => {
                try {
                    const tasksResponse = await loggedAxios.get(`${apiUrl}/backgroundTasks`);
                    setBackgroundTasks(tasksResponse.data.tasks || []);
                } catch (fetchError) {
                    console.error('Error fetching updated background tasks after failure:', fetchError.message);
                }
            };
            fetchUpdatedTasks();

            if (error.response) {
                setDiscogsResponse(error.response.data.error || 'An error occurred.');
            } else {
                setDiscogsResponse('An unknown error occurred.');
            }
        }
    };

    const handleInputChange = (value) => {
        setDiscogsInput(value);
        setInputError('');

        if (value.startsWith('https://www.discogs.com/artist/')) {
            const id = value.split('/').pop().split('-')[0];
            setExtractedId(id);
            setSelectedType('artist');
        } else if (value.startsWith('https://www.discogs.com/label/')) {
            const id = value.split('/').pop().split('-')[0];
            setExtractedId(id);
            setSelectedType('label');
        } else if (value.startsWith('https://www.discogs.com/lists/')) {
            const id = value.split('/').pop();
            setExtractedId(id);
            setSelectedType('list');
        } else if (value.startsWith('[a') && value.endsWith(']')) {
            const id = value.slice(2, -1);
            setExtractedId(id);
            setSelectedType('artist');
        } else if (value.startsWith('[l') && value.endsWith(']')) {
            const id = value.slice(2, -1);
            setExtractedId(id);
            setSelectedType('label');
        } else if (/^\d+$/.test(value)) {
            setExtractedId(value);
        } else {
            setExtractedId('');
        }
    };

    const handleSearchClick = () => {
        if (!discogsInput.trim() && !selectedType) {
            setInputError('Please select a type and enter a value.');
        } else if (!selectedType) {
            setInputError('Please select a type.');
        } else if (!discogsInput.trim()) {
            setInputError('Please enter a value.');
        } else {
            setInputError('');
            handleDiscogsSearch();
        }
    };

    const handleCreatePlaylist = async () => {
        try {
            const response = await loggedAxios.post(`${apiUrl}/createPlaylist`, { name: playlistName });
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
            const response = await loggedAxios.post(`${apiUrl}/addVideoToPlaylist`, {
                playlistId,
                videoId,
            });
            console.log('Add Video Response:', response.data);
            setAddVideoResponse({ message: 'Success: Video added to playlist!', isError: false });
        } catch (error) {
            console.error('Error adding video to playlist:', error);
            const errorMessage = error.response
                ? `Error: ${JSON.stringify(error.response.data, null, 2)}`
                : 'An unknown error occurred.';
            setAddVideoResponse({ message: errorMessage, isError: true });
        }
    };

    const handleQuickFill = (value) => {
        setDiscogsInput(value);
    };

    const fetchYouTubeAuthUrl = async () => {
        try {
            const response = await loggedAxios.get(`${apiUrl}/generateURL`);
            console.log('YouTube Auth URL:', response.data.url);
            window.location.href = response.data.url;
        } catch (error) {
            console.error('Error fetching YouTube auth URL:', error.message);
        }
    };

    const initiateDiscogsAuth = () => {
        if (discogsAuthUrl) {
            window.location.href = discogsAuthUrl;
        }
    };

    const handleDiscogsCallback = async (oauthToken, oauthVerifier) => {
        try {
            const response = await loggedAxios.get(`${apiUrl}/discogs/callback`, {
                params: { oauth_token: oauthToken, oauth_verifier: oauthVerifier },
            });
            console.log('Discogs Access Token:', response.data);
            setDiscogsAccessToken(response.data);
        } catch (error) {
            console.error('Error handling Discogs callback:', error.message);
        }
    };

    const handleSignOut = async () => {
        try {
            const response = await loggedAxios.post(`${apiUrl}/signOut`);
            if (response.status === 200) {
                setAuthStatus(false);
                setDiscogsAuthStatus(false);
                setPlaylistId('');
                setVideoId('');
                console.log('Signed out successfully.');
            } else {
                console.error('Sign-out failed:', response.data);
            }
        } catch (error) {
            console.error('Error signing out:', error.message);
        }
    };

    const pauseBackgroundJob = async () => {
        try {
            setBackgroundJobStatus((prev) => ({ ...prev, isPaused: true }));
            await loggedAxios.post(`${apiUrl}/pauseBackgroundJob`);
        } catch (error) {
            console.error('Error pausing background job:', error.message);
        }
    };

    const stopBackgroundJob = async () => {
        try {
            setBackgroundJobStatus({ isRunning: false, isPaused: false, progress: { current: 0, total: 0, uniqueLinks: 0 } });
            await loggedAxios.post(`${apiUrl}/stopBackgroundJob`);
        } catch (error) {
            console.error('Error stopping background job:', error.message);
        }
    };

    const handleDevModeToggle = () => {
        setIsDevMode((prev) => {
            const newDevMode = !prev;
            localStorage.setItem('isDevMode', newDevMode);
            return newDevMode;
        });
    };

    const clearAllTasks = async () => {
        try {
            await loggedAxios.post(`${apiUrl}/clearBackgroundTasks`);

            setBackgroundTasks([]);
            setSelectedTaskId(null);
            setYoutubeLinks([]);
            setBackgroundJobStatus({
                isRunning: false,
                isPaused: false,
                progress: { current: 0, total: 0, uniqueLinks: 0 },
            });

            localStorage.removeItem('backgroundTasks');
        } catch (error) {
            console.error('Error clearing background tasks:', error.message);
        }
    };

    const handleTaskClick = (taskId) => {
        const task = backgroundTasks.find((task) => task.id === taskId);
        if (task) {
            setSelectedTaskId(taskId);

            // Load saved progress and links from localStorage
            if (taskData[taskId]) {
                const savedData = taskData[taskId];
                const uniqueLinksCount = savedData.youtubeLinks ? savedData.youtubeLinks.length : 0;

                const progressData = {
                    current: savedData.progress?.current || uniqueLinksCount,
                    total: savedData.progress?.total || uniqueLinksCount,
                    uniqueLinks: uniqueLinksCount
                };

                setFinalTaskStats(progressData);
                // Update background job status with saved progress
                setBackgroundJobStatus(prev => ({
                    ...prev,
                    progress: progressData
                }));

                if (savedData.youtubeLinks) {
                    setYoutubeLinks(savedData.youtubeLinks);
                }
            }

            setTaskCompleted(task.status === 'completed');
            if (task.status === 'completed') {
                const uniqueLinksCount = task.youtubeLinks ? task.youtubeLinks.length :
                    (taskData[taskId]?.youtubeLinks?.length || 0);

                const finalStats = {
                    current: task.progress?.total || uniqueLinksCount,
                    total: task.progress?.total || uniqueLinksCount,
                    uniqueLinks: uniqueLinksCount
                };
                setFinalTaskStats(finalStats);
                // Also update the background job status
                setBackgroundJobStatus(prev => ({
                    ...prev,
                    progress: finalStats
                }));
            }

            setExpandedTasks(prev => ({
                ...prev,
                [taskId]: true
            }));
            setLoadedTasks(prev => new Set([...prev, taskId]));
        }
    };

    const handlePauseTask = async (taskId, event) => {
        event.stopPropagation();
        try {
            const task = backgroundTasks.find(task => task.id === taskId);
            if (task && task.status === 'paused') {
                await loggedAxios.post(`${apiUrl}/resumeBackgroundJob`);
                setBackgroundJobStatus(prev => ({ ...prev, isPaused: false }));
                setBackgroundTasks(prevTasks =>
                    prevTasks.map(t =>
                        t.id === taskId ? { ...t, status: 'in-progress' } : t
                    )
                );
            } else {
                await loggedAxios.post(`${apiUrl}/pauseBackgroundJob`);
                setBackgroundJobStatus(prev => ({ ...prev, isPaused: true }));
                setBackgroundTasks(prevTasks =>
                    prevTasks.map(t =>
                        t.id === taskId ? { ...t, status: 'paused' } : t
                    )
                );
            }
        } catch (error) {
            console.error('Error pausing/resuming task:', error.message);
        }
    };

    const toggleTaskExpansion = (taskId, event) => {
        event.stopPropagation();
        setExpandedTasks(prev => {
            const isExpanded = !prev[taskId];
            if (isExpanded) {
                // Add to loaded tasks set when expanding
                setLoadedTasks(prev => new Set([...prev, taskId]));

                // Load data from localStorage if available
                if (taskData[taskId]) {
                    const savedData = taskData[taskId];
                    const uniqueLinksCount = savedData.youtubeLinks ? savedData.youtubeLinks.length : 0;

                    setFinalTaskStats({
                        current: savedData.progress?.current || uniqueLinksCount,
                        total: savedData.progress?.total || uniqueLinksCount,
                        uniqueLinks: uniqueLinksCount
                    });

                    if (savedData.youtubeLinks) {
                        setYoutubeLinks(savedData.youtubeLinks);
                    }
                }
            }
            return {
                ...prev,
                [taskId]: isExpanded
            };
        });
    };

    const createPlaylistUrls = (videoIds) => {
        const chunkSize = 50;
        const chunks = [];

        for (let i = 0; i < videoIds.length; i += chunkSize) {
            chunks.push(videoIds.slice(i, i + chunkSize));
        }

        return chunks.map((chunk, index) => ({
            url: `https://www.youtube.com/watch_videos?video_ids=${chunk.join(',')}`,
            count: chunk.length,
            start: index * chunkSize + 1,
            end: index * chunkSize + chunk.length
        }));
    };

    return (
        <>
            <Helmet>
                <title>Discogs2YouTube</title>
                <meta name="description" content="Extract youtube links from discogs " />

                {/* Google / Search Engine Tags */}
                <meta itemprop="name" content="Discogs2YouTube" />
                <meta itemprop="description" content="Extract youtube links from discogs " />
                <meta itemprop="image" content="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Discogs-logo-billboard-1548-1092x722.jpg/330px-Discogs-logo-billboard-1548-1092x722.jpg" />

                {/* Facebook Meta Tags */}
                <meta property="og:url" content="https://jermasearch.com/discogs2youtube" />
                <meta property="og:type" content="website" />
                <meta property="og:title" content="Discogs2YouTube" />
                <meta property="og:description" content="Extract youtube links from discogs " />
                <meta property="og:image" content="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Discogs-logo-billboard-1548-1092x722.jpg/330px-Discogs-logo-billboard-1548-1092x722.jpg" />

                {/* Twitter Meta Tags  */}
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Discogs2YouTube" />
                <meta name="twitter:description" content="Extract youtube links from discogs " />
                <meta name="twitter:image" content="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Discogs-logo-billboard-1548-1092x722.jpg/330px-Discogs-logo-billboard-1548-1092x722.jpg" />
            </Helmet>
            <div className={styles.container}>

                <section className={styles.section}>
                    <h2 className={styles.subtitle}>Discogs Authentication</h2>
                    {discogsAuthStatus ? (
                        <>
                            <p className={styles.success}>You are signed in to Discogs!</p>
                            <button
                                className={`${styles.searchButton} ${styles.signOutButton}`}
                                onClick={handleSignOut}
                                style={{ backgroundColor: 'red', color: 'white' }}
                            >
                                Sign Out
                            </button>
                            <p className={styles.description}>
                                Fetch all YouTube links for a Discogs artist, label, or list:
                            </p>
                            <input
                                type="text"
                                className={`${styles.input} ${inputError ? styles.inputError : ''}`}
                                placeholder={inputError || "Enter a discogs artist / label / list ID or URL"}
                                value={discogsInput}
                                onChange={(e) => handleInputChange(e.target.value)}
                                list="search-history"
                            />
                            <datalist id="search-history">
                                {searchHistory.map((item, index) => (
                                    <option key={index} value={item} />
                                ))}
                            </datalist>
                            <div className={styles.quickFillContainer}>
                                <button
                                    className={`${styles.quickFill} ${selectedType === 'label' ? styles.selected : ''}`}
                                    onClick={() => setSelectedType('label')}
                                >
                                    Label
                                </button>
                                <button
                                    className={`${styles.quickFill} ${selectedType === 'artist' ? styles.selected : ''}`}
                                    onClick={() => setSelectedType('artist')}
                                >
                                    Artist
                                </button>
                                <button
                                    className={`${styles.quickFill} ${selectedType === 'list' ? styles.selected : ''}`}
                                    onClick={() => setSelectedType('list')}
                                >
                                    List
                                </button>
                            </div>
                            <button
                                className={styles.searchButton}
                                onClick={handleSearchClick}
                                disabled={!discogsInput.trim() || !selectedType}
                            >
                                Search
                            </button>
                        </>
                    ) : (
                        <>
                            <p className={styles.authStatus}>You are not signed in to Discogs, please sign in below to be able to extract videos!</p>
                            <button className={styles.searchButton} onClick={initiateDiscogsAuth}>
                                Authenticate with Discogs
                            </button>
                        </>
                    )}
                </section>

                <section className={styles.section}>
                    <h2 className={styles.subtitle}>Background Tasks</h2>
                    {backgroundTasks.length > 0 ? (
                        <>
                            {/*
                            <button className={styles.searchButton} onClick={clearAllTasks}>
                                Clear Tasks
                            </button> 
                            */}
                            <ul className={styles.taskList}>
                                {backgroundTasks.map((task) => (
                                    <li
                                        key={task.id}
                                        className={`${styles.taskItem} 
                                            ${selectedTaskId === task.id ? styles.selectedTask : ''}
                                            ${task.status === 'completed' ? styles.completedTask : ''}
                                        `}
                                    >
                                        <div
                                            className={styles.taskHeader}
                                            onClick={() => handleTaskClick(task.id)}
                                        >
                                            <div className={styles.taskInfo}>
                                                <span>{task.name}</span>
                                                <span className={`${styles.taskStatus} ${styles[`status-${task.status}`]}`}>
                                                    {task.status}
                                                </span>
                                            </div>
                                            <div className={styles.taskActions}>
                                                {task.status !== 'completed' && (
                                                    <button
                                                        className={`${styles.taskActionButton} ${task.status === 'paused' ? styles.resumeButton : styles.pauseButton
                                                            }`}
                                                        onClick={(e) => handlePauseTask(task.id, e)}
                                                        title={task.status === 'paused' ? "Resume task" : "Pause task"}
                                                    >
                                                        {task.status === 'paused' ? '▶️' : '⏸️'}
                                                    </button>
                                                )}
                                                <button
                                                    className={styles.expandButton}
                                                    onClick={(e) => toggleTaskExpansion(task.id, e)}
                                                    title={expandedTasks[task.id] ? "Collapse" : "Expand"}
                                                >
                                                    {expandedTasks[task.id] ? '🔼' : '🔽'}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Task Details (expanded state) */}
                                        {loadedTasks.has(task.id) && (
                                            <div className={`${styles.taskDetails} ${expandedTasks[task.id] ? styles.visible : ''}`}>
                                                <div className={styles.progressContainer}>
                                                    <h3 className={styles.subtitle}>Task Progress</h3>
                                                    {taskInfo.artistName && task.id === selectedTaskId && (
                                                        <p className={styles.artistName}>Artist: {taskInfo.artistName}</p>
                                                    )}

                                                    {/* Progress counters moved inside the task dropdown */}
                                                    {task.id === selectedTaskId && (
                                                        <>
                                                            <p>
                                                                Processing: {taskCompleted ? finalTaskStats.current : backgroundJobStatus.progress.current} / {taskCompleted ? finalTaskStats.total : backgroundJobStatus.progress.total}
                                                                {(taskCompleted ? finalTaskStats.total : backgroundJobStatus.progress.total) > 0 && (
                                                                    <span> ({Math.round(((taskCompleted ? finalTaskStats.current : backgroundJobStatus.progress.current) / (taskCompleted ? finalTaskStats.total : backgroundJobStatus.progress.total)) * 100)}%)</span>
                                                                )}
                                                            </p>
                                                            <p>Unique YouTube Links Found: {taskCompleted ? finalTaskStats.uniqueLinks : backgroundJobStatus.progress.uniqueLinks}</p>
                                                            {backgroundJobStatus.isPaused && !taskCompleted && (
                                                                <p className={styles.waitTime}>Paused</p>
                                                            )}
                                                            {waitTime > 0 && !taskCompleted && (
                                                                <p className={styles.waitTime}>
                                                                    Rate limit hit, waiting for {Math.ceil(waitTime / 1000)} seconds before resuming...
                                                                </p>
                                                            )}
                                                            {taskCompleted && (
                                                                <p className={styles.success}>Task Completed</p>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Only show YouTube links for the selected task */}
                                                    {youtubeLinks.length > 0 && task.id === selectedTaskId && (
                                                        <div className={styles.progressContainer}>
                                                            <h3>Click for YouTube Playlists</h3>
                                                            <p className={styles.playlistInfo}>
                                                                {youtubeLinks.length} videos split into {Math.ceil(youtubeLinks.length / 50)} playlist(s)
                                                            </p>
                                                            {createPlaylistUrls(
                                                                youtubeLinks
                                                                    .map(link => {
                                                                        try {
                                                                            return new URL(link.url).searchParams.get('v');
                                                                        } catch (error) {
                                                                            console.error('Invalid URL:', link.url);
                                                                            return null;
                                                                        }
                                                                    })
                                                                    .filter(Boolean)
                                                            ).map((playlist, index) => (
                                                                <a
                                                                    key={index}
                                                                    href={playlist.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className={styles.youtubeLink}
                                                                >
                                                                    Click here for playlist {index + 1} (Videos {playlist.start}-{playlist.end})
                                                                </a>
                                                            ))}

                                                            <div className={styles.youtubeContainer}>
                                                                {youtubeLinks.map((link, index) => {
                                                                    if (!link.url || !link.releaseId || !link.artist || !link.releaseName) {
                                                                        console.warn(`Skipping invalid link at index ${index}:`, link);
                                                                        return null;
                                                                    }

                                                                    let videoId;
                                                                    try {
                                                                        videoId = new URL(link.url).searchParams.get('v');
                                                                    } catch (error) {
                                                                        console.error(`Invalid URL at index ${index}:`, link.url, error);
                                                                        return null;
                                                                    }

                                                                    if (!videoId) {
                                                                        console.warn(`Skipping link without video ID at index ${index}:`, link.url);
                                                                        return null;
                                                                    }

                                                                    return (
                                                                        <div key={index} className={styles.youtubeEmbed}>
                                                                            <div className={styles.divider}></div> {/* Divider line */}
                                                                            <div style={{ marginBottom: '10px', paddingBottom: '10px' }}>
                                                                                <p><strong>Discogs Release:</strong></p>
                                                                                <a
                                                                                    href={`https://www.discogs.com/release/${link.releaseId}`}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className={styles.youtubeLink}
                                                                                >
                                                                                    {link.artist} - {link.releaseName} [{link.releaseId}]
                                                                                </a>
                                                                                <p><strong>YouTube URL:</strong></p>
                                                                                <a
                                                                                    href={link.url}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className={styles.youtubeLink}
                                                                                >
                                                                                    {link.url}
                                                                                </a>
                                                                            </div>
                                                                            <iframe
                                                                                width="560"
                                                                                height="315"
                                                                                src={`https://www.youtube.com/embed/${videoId}`}
                                                                                title="YouTube video player"
                                                                                frameBorder="0"
                                                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                                                allowFullScreen
                                                                            ></iframe>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : (
                        <p>No tasks</p>
                    )}
                </section>

                <section className={styles.section}>
                    <h2 className={styles.subtitle}>YouTube Authentication</h2>
                    {authStatus ? (
                        <>
                            <p className={styles.authStatus}>You are signed in to YouTube!</p>
                            <button
                                className={`${styles.searchButton} ${styles.signOutButton}`}
                                onClick={handleSignOut}
                                style={{ backgroundColor: 'red', color: 'white' }}
                            >
                                Sign Out
                            </button>
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
                        </>
                    ) : (
                        <>
                            <p className={styles.authStatus}>You are not signed in to YouTube. Please sign in below if you want to add playlists to your account.</p>
                            <button className={styles.searchButton} onClick={fetchYouTubeAuthUrl}>
                                Authenticate with YouTube
                            </button>
                        </>
                    )}
                </section>

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
        </>
    );
}

export default Discogs2Youtube;