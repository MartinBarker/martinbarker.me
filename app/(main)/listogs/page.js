'use client'
import Head from 'next/head';
import styles from './listogs.module.css';
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { socket, useSocketStatus, useYoutubeLinks, useYoutubeResults } from './socket'; // <-- Import useSocketStatus hook

const loggedAxios = axios;

export default function Discogs2Youtube() {
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
  const [backgroundJobStatus, setBackgroundJobStatus] = useState({
      isRunning: false,
      isPaused: false,
      progress: { current: 0, total: 0, uniqueLinks: 0 },
  });
  const [backgroundJobError, setBackgroundJobError] = useState(null);
  const [backgroundJobErrorDetails, setBackgroundJobErrorDetails] = useState(null);
  const [waitTime, setWaitTime] = useState(0);
  const [youtubeLinks, setYoutubeLinks] = useState([]);
  const youtubeResults = useYoutubeResults(); // Capture real-time YouTube results

  const [initialVideoId, setInitialVideoId] = useState('bVbt8qG7Fl8');
  const [isDevMode, setIsDevMode] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [inputError, setInputError] = useState('');
  const [searchHistory, setSearchHistory] = useState([]);
  const [progress, setProgress] = useState({
    progress: { current: 0, total: 0, uniqueLinks: 0 },
    waitTime: 0,
    isRunning: false,
    isPaused: false
  });
  const [progressLogs, setProgressLogs] = useState([]);
  const logsEndRef = useRef(null);
  
  // Add socket connection status
  const { status: socketStatus, hasMounted } = useSocketStatus();

  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  const apiUrl = isLocal ? "http://localhost:3030" : "https://www.jermasearch.com/internal-api";
  const wsUrl = isLocal ? 'http://localhost:3030' : 'https://www.jermasearch.com';

  // --- Real-time progress updates using shared socket instance ---
  useEffect(() => {
    if (!socket) {
      console.log('[Socket.IO] No socket instance available');
      return;
    }
    
    function onProgress(data) {
      console.log('[Socket.IO] Progress update received:', data);
      setProgress(data);
    }
    
    function onProgressLog(msg) {
      console.log('[Socket.IO] Progress log received:', msg);
      setProgressLogs(logs => [...logs, msg]);
    }

    console.log('[Socket.IO] Setting up event listeners');
    socket.on("progress", onProgress);
    socket.on("progressLog", onProgressLog);

    // Real-time YouTube links: deduplicate by videoId
    const onResults = (videos) => {
      setYoutubeLinks(prevLinks => {
        // Add only unique videoIds
        const all = [...prevLinks, ...videos];
        const seen = new Set();
        return all.filter(link => {
          if (!link.videoId) return false;
          if (seen.has(link.videoId)) return false;
          seen.add(link.videoId);
          return true;
        });
      });
    };
    socket.on("results", onResults);

    // Force socket to connect if not connected
    if (!socket.connected) {
      console.log('[Socket.IO] Socket not connected, attempting to connect');
      socket.connect();
    }

    return () => {
      console.log('[Socket.IO] Cleaning up event listeners');
      socket.off("progress", onProgress);
      socket.off("progressLog", onProgressLog);
      socket.off("results", onResults);
    };
  }, []);
  
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
  }, [apiUrl]);

  // Add console logs to debug auth status
  useEffect(() => {
      const fetchDiscogsAuthStatus = async () => {
          try {
              const response = await loggedAxios.get(`${apiUrl}/discogs/authStatus`);
              console.log('🔍 Discogs Auth Status:', response.data.isAuthenticated);
              setDiscogsAuthStatus(response.data.isAuthenticated);
          } catch (error) {
              console.error('Error fetching Discogs auth status:', error.message);
              setDiscogsAuthStatus(false); // Explicitly set to false on error
          }
      };

      fetchDiscogsAuthStatus();
  }, [apiUrl, discogsAccessToken]);

  useEffect(() => {
      let interval;
      if (backgroundJobStatus.isRunning && !backgroundJobStatus.isPaused) {
          interval = setInterval(async () => {
              try {
                  const statusResponse = await loggedAxios.get(`${apiUrl}/backgroundJobStatus`);
                  const linksResponse = await loggedAxios.get(`${apiUrl}/backgroundJobLinks`);

                  setBackgroundJobStatus(prev => ({
                      ...prev,
                      isRunning: statusResponse.data.isRunning,
                      progress: statusResponse.data.progress
                  }));

                  if (linksResponse.data.links) {
                      setYoutubeLinks(linksResponse.data.links);
                  }

                  if (!statusResponse.data.isRunning && backgroundJobStatus.isRunning) {
                      console.log('Task completed! Final results:', {
                          links: linksResponse.data.links,
                          stats: statusResponse.data.progress
                      });
                      clearInterval(interval);
                  }

              } catch (error) {
                  console.error('Error fetching job status:', error.message);
                  setBackgroundJobError('Failed to fetch job status.');
                  setBackgroundJobErrorDetails(error);
              }
          }, 1000);

          return () => clearInterval(interval);
      }
  }, [backgroundJobStatus.isRunning, backgroundJobStatus.isPaused, apiUrl]);

  useEffect(() => {
      const fetchDiscogsAuthStatus = async () => {
          try {
              const response = await loggedAxios.get(`${apiUrl}/discogs/authStatus`);
              console.log('🔍 Discogs Auth Status:', response.data.isAuthenticated);
              setDiscogsAuthStatus(response.data.isAuthenticated);
          } catch (error) {
              console.error('Error fetching Discogs auth status:', error.message);
              setDiscogsAuthStatus(false); // Explicitly set to false on error
          }
      };

      fetchDiscogsAuthStatus();
  }, [apiUrl, discogsAccessToken]);

  const handleDiscogsSearch = async () => {
      if (!extractedId.trim() || !selectedType) return;

      setYoutubeLinks([]); // Clear previous links
      setBackgroundJobStatus({ // Reset background job status
          isRunning: false,
          isPaused: false,
          progress: { current: 0, total: 0, uniqueLinks: 0 }
      });
      setBackgroundJobError(null);
      setBackgroundJobErrorDetails(null);
      setProgressLogs([]); // Clear progress log on submit

      try {
          const response = await loggedAxios.post(`${apiUrl}/discogsSearch`, {
              [selectedType]: extractedId,
              isDevMode,
          });
          console.log('/discogsSearch response=', response);

      } catch (error) {
          console.error('Error during Discogs search:', error);
          const errorMsg = error.response?.data?.error || error.message || 'An unknown error occurred.';
          setDiscogsResponse(`Error: ${errorMsg}`);
          setBackgroundJobError(errorMsg);
          setBackgroundJobErrorDetails(error.response?.data?.details || error.stack);
      }
  };

  const handleInputChange = (value) => {
      setDiscogsInput(value);
      setInputError('');
      setExtractedId(''); // Reset extracted ID initially
      setSelectedType(null); // Reset type initially


      // Try matching URLs first
      const artistMatch = value.match(/discogs\.com\/artist\/(\d+)/);
      if (artistMatch && artistMatch[1]) {
          setExtractedId(artistMatch[1]);
          setSelectedType('artist');
          return;
      }

      const labelMatch = value.match(/discogs\.com\/label\/(\d+)/);
      if (labelMatch && labelMatch[1]) {
          setExtractedId(labelMatch[1]);
          setSelectedType('label');
          return;
      }

      const listMatch = value.match(/discogs\.com\/lists\/.*-(\d+)/); // Match lists like 'MyList-12345'
       if (listMatch && listMatch[1]) {
           setExtractedId(listMatch[1]);
           setSelectedType('list');
           return;
       }
      const listMatchSimple = value.match(/discogs\.com\/lists\/(\d+)/); // Match simple numeric lists
       if (listMatchSimple && listMatchSimple[1]) {
           setExtractedId(listMatchSimple[1]);
           setSelectedType('list');
           return;
       }

       // Try matching bracket format
       const bracketArtistMatch = value.match(/^\[a(\d+)\]$/);
       if (bracketArtistMatch && bracketArtistMatch[1]) {
           setExtractedId(bracketArtistMatch[1]);
           setSelectedType('artist');
           return;
       }

       const bracketLabelMatch = value.match(/^\[l(\d+)\]$/);
       if (bracketLabelMatch && bracketLabelMatch[1]) {
           setExtractedId(bracketLabelMatch[1]);
           setSelectedType('label');
           return;
       }

       // If only numbers, assume it *could* be an ID, but don't set type yet
       if (/^\d+$/.test(value)) {
           setExtractedId(value);
           // Don't set selectedType here, let the user choose via radio buttons
       }
  };

  const handleSearchClick = () => {
      if (!selectedType) { // Require type selection first
          setInputError('Please select a type (Artist, Label, or List).');
          return;
       }
      if (!discogsInput.trim() || !extractedId) { // Require input value and ensure ID was extracted
           setInputError(`Please enter a valid Discogs ${selectedType} URL or ID.`);
           return;
       }

      setInputError('');
      handleDiscogsSearch();

  };

  const handleCreatePlaylist = async () => {
      try {
          const response = await loggedAxios.post(`${apiUrl}/createPlaylist`, { name: playlistName });
          console.log('Playlist Creation Response:', response.data);
          setPlaylistResponse(`Playlist created: ${response.data.title} (ID: ${response.data.id})`);
          setPlaylistId(response.data.id); // Automatically set the created playlist ID for adding videos
      } catch (error) {
          console.error('Error creating playlist:', error);
           const errorMsg = error.response?.data?.error || error.message || 'An error occurred.';
          setPlaylistResponse(`Error: ${errorMsg}`);
      }
  };

  const handleAddVideoToPlaylist = async () => {
      if (!playlistId || !videoId) {
           setAddVideoResponse({ message: 'Error: Playlist ID and Video ID are required.', isError: true });
           return;
       }
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
              ? `Error: ${JSON.stringify(error.response.data?.error || error.response.data, null, 2)}`
              : 'An unknown error occurred.';
          setAddVideoResponse({ message: errorMessage, isError: true });
      }
  };

  const handleQuickFill = (value) => {
     handleInputChange(value); // Use the main input handler
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

  // This should likely be handled on a dedicated callback page/route
  // But if handling directly for simplicity:
  // useEffect(() => {
  //    const urlParams = new URLSearchParams(window.location.search);
  //    const oauthToken = urlParams.get('oauth_token');
  //    const oauthVerifier = urlParams.get('oauth_verifier');
  //    if (oauthToken && oauthVerifier && !discogsAccessToken) { // Check if not already processed
  //       handleDiscogsCallback(oauthToken, oauthVerifier);
  //    }
  // }, [discogsAccessToken]); // Add dependency

  const handleDiscogsCallback = async (oauthToken, oauthVerifier) => {
      try {
          const response = await loggedAxios.get(`${apiUrl}/discogs/callback`, {
              params: { oauth_token: oauthToken, oauth_verifier: oauthVerifier },
          });
          console.log('Discogs Access Token Received (client-side placeholder):', response.data);
          // Assuming the backend now stores the token server-side associated with the session/user
          setDiscogsAccessToken(true); // Indicate success, actual token not stored in state
          setDiscogsAuthStatus(true); // Update status
          // Maybe remove query params from URL after successful processing
          // window.history.replaceState({}, document.title, window.location.pathname);
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
              setDiscogsAccessToken(null); // Clear token indicator
              // Optionally clear other state like tasks, etc.
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
          // Optimistically update UI first
          setBackgroundJobStatus((prev) => ({ ...prev, isPaused: true }));
           // Update the specific task's status in the list
           setBackgroundTasks(prevTasks =>
               prevTasks.map(task =>
                   task.id === selectedTaskId ? { ...task, status: 'paused' } : task
               )
           );
          await loggedAxios.post(`${apiUrl}/pauseBackgroundJob`);
      } catch (error) {
          console.error('Error pausing background job:', error.message);
          // Revert UI update on error?
          setBackgroundJobStatus((prev) => ({ ...prev, isPaused: false }));
           setBackgroundTasks(prevTasks =>
               prevTasks.map(task =>
                   task.id === selectedTaskId ? { ...task, status: 'in-progress' } : task // Assuming it was in-progress
               )
           );
      }
  };

  const stopBackgroundJob = async (taskId, event) => {
      event?.stopPropagation(); // Prevent task selection if clicking stop button
       if (!taskId) taskId = selectedTaskId; // Use selected if none provided
       if (!taskId) return; // No task to stop


      try {
           // If the stopped task is the currently active one, reset global status
           if (taskId === backgroundJobStatus.artistId || taskId === selectedTaskId) {
               setBackgroundJobStatus({ isRunning: false, isPaused: false, progress: { current: 0, total: 0, uniqueLinks: 0 }, artistId: null, artistName: null });
               setIsPollingActive(false); // Stop polling if the active task is stopped
               if (pollingIntervalRef.current) {
                   clearInterval(pollingIntervalRef.current);
                   pollingIntervalRef.current = null;
               }
           }


           // Update the task list - remove the task or mark as stopped/cancelled
           setBackgroundTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));

            // Remove from localStorage task data
           setTaskData(prev => {
               const newData = { ...prev };
               delete newData[taskId];
               return newData;
           });
           setLoadedTasks(prev => {
                const newSet = new Set(prev);
                newSet.delete(taskId);
                return newSet;
           });


           // If the stopped task was selected, select the next available one or null
           if (taskId === selectedTaskId) {
               const remainingTasks = backgroundTasks.filter(task => task.id !== taskId);
               setSelectedTaskId(remainingTasks.length > 0 ? remainingTasks[0].id : null);
                setYoutubeLinks([]); // Clear links display
                setFinalTaskStats({ current: 0, total: 0, uniqueLinks: 0 }); // Clear stats display
           }


          await loggedAxios.post(`${apiUrl}/stopBackgroundJob`, { taskId }); // Send taskId to backend


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
              artistId: null,
              artistName: null
          });
          setIsPollingActive(false); // Stop polling
           if (pollingIntervalRef.current) {
               clearInterval(pollingIntervalRef.current);
               pollingIntervalRef.current = null;
           }
          setFinalTaskStats({ current: 0, total: 0, uniqueLinks: 0 });
          setTaskInfo({ artistName: '', taskStatus: 'waiting' });
          setExpandedTasks({});
          setTaskData({}); // Clear saved task data from state
          setLoadedTasks(new Set()); // Clear loaded tasks


          localStorage.removeItem('backgroundTasks');
          localStorage.removeItem('taskData'); // Clear from local storage too
      } catch (error) {
          console.error('Error clearing background tasks:', error.message);
      }
  };

  const handleTaskClick = (taskId) => {
       if (taskId === selectedTaskId) {
           // Optional: Toggle expansion if clicking the already selected task
           // toggleTaskExpansion(taskId);
           return; // Already selected
       }


      const task = backgroundTasks.find((task) => task.id === taskId);
      if (task) {
          setSelectedTaskId(taskId);
          setTaskCompleted(task.status === 'completed'); // Set completion status based on task list
          setYoutubeLinks([]); // Clear links initially, they will be loaded by the useEffect
           setFinalTaskStats({ current: 0, total: 0, uniqueLinks: 0 }); // Reset stats display
           setBackgroundJobStatus(prev => ({ // Reset progress display until loaded
               ...prev,
               progress: { current: 0, total: 0, uniqueLinks: 0 }
           }));


          // The useEffect dependent on selectedTaskId will handle loading data and expansion
          // Ensure the task is marked for loading if not already loaded
          if (!loadedTasks.has(taskId)) {
             setLoadedTasks(prev => new Set([...prev, taskId]));
          }


           // If the selected task is *not* the currently running background job,
           // ensure the backgroundJobStatus reflects the selected task's stored state, not the active job's.
           const currentActiveJobId = backgroundJobStatus.artistId;
           if (task.id !== currentActiveJobId) {
               const savedData = taskData[taskId];
               if (savedData) {
                   const uniqueLinksCount = savedData.youtubeLinks ? savedData.youtubeLinks.length : 0;
                   const progressData = {
                       current: savedData.progress?.current ?? uniqueLinksCount,
                       total: savedData.progress?.total ?? uniqueLinksCount,
                       uniqueLinks: uniqueLinksCount
                   };
                   // Update display status but keep isRunning, isPaused etc. from the actual active job
                   setBackgroundJobStatus(prev => ({
                       ...prev, // Keep isRunning, isPaused etc. from the actual active job
                       progress: progressData // Show progress of the *selected* task
                   }));
                    if (task.status === 'completed') {
                        setFinalTaskStats(progressData); // Show final stats if completed
                    }
               } else {
                  // Reset progress if no saved data found for the selected task
                   setBackgroundJobStatus(prev => ({
                       ...prev,
                       progress: { current: 0, total: 0, uniqueLinks: 0 }
                   }));
               }
                if (savedData?.youtubeLinks) {
                    setYoutubeLinks(savedData.youtubeLinks);
                }
           } else {
              // If selecting the *currently running* task, the polling/interval useEffects
              // should already be updating backgroundJobStatus correctly.
              // Ensure finalStats are cleared if the running task is selected
               setFinalTaskStats({ current: 0, total: 0, uniqueLinks: 0 });
           }


      }
  };

  const handlePauseTask = async (taskId, event) => {
      event.stopPropagation(); // Prevent task selection

      const task = backgroundTasks.find(task => task.id === taskId);
      if (!task) return;

      try {
          if (task.status === 'paused') {
              // Optimistically update UI
               setBackgroundTasks(prevTasks =>
                   prevTasks.map(t =>
                       t.id === taskId ? { ...t, status: 'in-progress' } : t
                   )
               );
               if (taskId === selectedTaskId || taskId === backgroundJobStatus.artistId) {
                   setBackgroundJobStatus(prev => ({ ...prev, isPaused: false }));
               }
              await loggedAxios.post(`${apiUrl}/resumeBackgroundJob`, { taskId }); // Send taskId to backend
              // Start polling again if it was stopped and this is the selected task
               if (taskId === selectedTaskId && !isPollingActive) {
                   setIsPollingActive(true);
               }
          } else if (task.status === 'in-progress' || task.status === 'rate-limited') {
              // Optimistically update UI
               setBackgroundTasks(prevTasks =>
                   prevTasks.map(t =>
                       t.id === taskId ? { ...t, status: 'paused' } : t
                   )
               );
               if (taskId === selectedTaskId || taskId === backgroundJobStatus.artistId) {
                   setBackgroundJobStatus(prev => ({ ...prev, isPaused: true }));
               }
              await loggedAxios.post(`${apiUrl}/pauseBackgroundJob`, { taskId }); // Send taskId to backend
          }
      } catch (error) {
          console.error('Error pausing/resuming task:', error.message);
          // Revert optimistic update on error
           setBackgroundTasks(prevTasks =>
               prevTasks.map(t =>
                   t.id === taskId ? { ...t, status: task.status } : t // Revert to original status
               )
           );
           if (taskId === selectedTaskId || taskId === backgroundJobStatus.artistId) {
                setBackgroundJobStatus(prev => ({ ...prev, isPaused: task.status !== 'paused' })); // Revert pause state
           }
      }
  };

  const toggleTaskExpansion = (taskId, event) => {
      event?.stopPropagation(); // Prevent task selection if called from button click
      setExpandedTasks(prev => {
          const isCurrentlyExpanded = !!prev[taskId];
          const newExpandedState = !isCurrentlyExpanded;

          if (newExpandedState && !loadedTasks.has(taskId)) {
              // Mark as loaded when expanding for the first time
              setLoadedTasks(prevLoaded => new Set([...prevLoaded, taskId]));
              // Trigger data loading logic by selecting the task if it wasn't already selected
              // This ensures the useEffect for loading data runs upon first expansion
               if (selectedTaskId !== taskId) {
                   handleTaskClick(taskId); // Simulate a click to load data
               }
          } else if (newExpandedState && selectedTaskId !== taskId) {
              // If expanding an already loaded but non-selected task, select it to show its data.
               handleTaskClick(taskId);
          }

          return {
              ...prev,
              [taskId]: newExpandedState // Toggle the expansion state
          };
      });
  };

  const createPlaylistUrls = (videoIds) => {
      if (!videoIds || videoIds.length === 0) return [];
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

  // Derive playlist links based on the *current* youtubeLinks state
  const currentPlaylistUrls = createPlaylistUrls(youtubeLinks.map(link => link.videoId).filter(Boolean));

  // Determine current progress display based on task completion status
  //const displayProgress = taskCompleted ? finalTaskStats : backgroundJobStatus.progress;

  const handleExtractImages = async () => {
    try {
        const response = await loggedAxios.post(`${apiUrl}/getDiscogsImgs`, {
            query: extractImgsQuery,
            enablePagination: true // Disable pagination for testing
        });
        console.log('handleExtractImages() response:', response);
        setExtractImgsResult(`Success: ${response.data.paginationSummary}`);

        // Try to get the first release info for title suggestions
        let release = null;
        if (response.data.item_release) {
          release = response.data.item_release;
        } else if (response.data.releases_info && Array.isArray(response.data.releases_info) && response.data.releases_info.length > 0) {
          release = response.data.releases_info[0];
        }
        if (release) {
          setVideoTitleSuggestions(generateVideoTitleSuggestions(release));
        } else {
          setVideoTitleSuggestions([]);
        }
    } catch (error) {
        setExtractImgsResult('Error extracting images.');
        setVideoTitleSuggestions([]);
        console.log('error=', error);
    }
};

 // Helper to generate video title recommendations
function generateVideoTitleSuggestions(release) {
  if (!release) return [];
  const albumTitle = release.title || '';
  const artist = (release.artists && release.artists.length > 0 && release.artists[0].name) || release.artist || '';
  const year = release.year || '';
  const genres = Array.isArray(release.genres) ? release.genres.join(', ') : (release.genre || '');
  const styles = Array.isArray(release.styles) ? release.styles.join(', ') : (release.style || '');

  const base = `${albumTitle} - ${artist}`;
  const yearStr = year ? ` | ${year}` : '';
  const genreStr = genres ? ` | ${genres}` : '';
  const styleStr = styles ? ` | ${styles}` : '';

  return [
    `${base}${yearStr}${genreStr} | Full Album`.replace(/\s+\|/g, ' |').trim(),
    `${base} [Full Album]${yearStr}${genreStr}`.replace(/\s+\|/g, ' |').trim(),
    `${albumTitle} (Full Album)${yearStr}${genreStr}${styleStr}`.replace(/\s+\|/g, ' |').trim(),
    `${artist} - ${albumTitle} (${year}) [Full Album, ${genres}${styles ? ', ' + styles : ''}]`.replace(/\s+\|/g, ' |').trim(),
    `${albumTitle} by ${artist} | ${year}${genreStr}${styleStr} | Full Album`.replace(/\s+\|/g, ' |').trim(),
  ];
}

 return (
    <>
      <Head>
        <title>Discogs2Youtube – Convert Releases to Playlists | Martin Barker</title>        <meta name="description" content="Convert Discogs releases, labels, and lists into YouTube playlists automatically. Search Discogs catalog and create matching YouTube playlists with ease." />
        <meta name="keywords" content="Discogs, YouTube, playlist, music discovery, record collection, vinyl, music catalog, playlist generator" />        <meta name="author" content="Martin Barker" />
        <meta property="og:title" content="Discogs2Youtube – Convert Discogs Releases to YouTube Playlists" />        <meta property="og:description" content="Easily convert Discogs releases, labels, and lists into YouTube playlists. Perfect for music discovery and collection management." />
        <meta property="og:image" content="/images/discogs_previewCard.PNG" />
        <meta property="og:url" content="https://martinbarker.me/discogs2youtube" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Martin Barker Portfolio" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Discogs2Youtube – Convert Releases to Playlists" />
        <meta name="twitter:description" content="Convert Discogs releases into YouTube playlists automatically. Perfect for music discovery." />
        <meta name="twitter:image" content="/images/discogs_previewCard.PNG" />
        <link rel="canonical" href="https://martinbarker.me/discogs2youtube" />
      </Head>

      <div className={styles.container}>

        {/* Authentication Section */}
        <div className={styles.section}>
          <h2>Authentication</h2>
          <div className={styles.authStatus}>
            <span>YouTube: {authStatus ? 'Authenticated' : 'Not Authenticated'}</span>
            {!authStatus && generatedURL && (
              <button onClick={fetchYouTubeAuthUrl} className={styles.button}>Authenticate YouTube</button>
            )}
          </div>
          <div className={styles.authStatus}>
            <span>Discogs: {discogsAuthStatus ? 'Authenticated' : 'Not Authenticated'}</span>
            {!discogsAuthStatus && discogsAuthUrl && (
              <button onClick={initiateDiscogsAuth} className={styles.button}>Authenticate Discogs</button>
            )}
          </div>
           {(authStatus || discogsAuthStatus) && (
             <button onClick={handleSignOut} className={`${styles.button} ${styles.signOutButton}`}>Sign Out</button>
           )}
          {urlError && <p className={styles.error}>Error: {urlError}</p>}
        </div>


        {/* Input Section */}
        <div className={styles.section}>
          <h2>Search Discogs</h2>
           <p className={styles.instructions}>Enter a Discogs Artist, Label, or List URL</p>
          <div className={styles.inputTypeSelection}>
            <label>
              <input
                type="radio"
                name="selectedType"
                value="artist"
                checked={selectedType === 'artist'}
                onChange={(e) => setSelectedType(e.target.value)}
              /> Artist
            </label>
            <label>
              <input
                type="radio"
                name="selectedType"
                value="label"
                checked={selectedType === 'label'}
                onChange={(e) => setSelectedType(e.target.value)}
              /> Label (Creates Background Task)
            </label>
            <label>
              <input
                type="radio"
                name="selectedType"
                value="list"
                checked={selectedType === 'list'}
                onChange={(e) => setSelectedType(e.target.value)}
              /> List
            </label>
          </div>
          <input
            type="text"
            value={discogsInput}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Enter Discogs URL or ID"
            className={styles.input}
            disabled={!discogsAuthStatus} // Only check Discogs auth for input
          />
          {extractedId && <p>Detected ID: {extractedId} {selectedType ? `(Type: ${selectedType})` : '(Select Type Above)'}</p>}
          <button 
            onClick={handleSearchClick} 
            className={styles.button} 
            disabled={!extractedId || !selectedType || (!authStatus && !discogsAuthStatus)}
          >
            Submit
          </button>
          {/* Add debug info */}
          {process.env.NODE_ENV === 'development' && (
            <div style={{fontSize: '12px', color: '#666'}}>
              Debug - Auth Status: YouTube: {authStatus ? 'Yes' : 'No'}, Discogs: {discogsAuthStatus ? 'Yes' : 'No'}
            </div>
          )}
          {inputError && <p className={styles.error}>{inputError}</p>}
          {discogsResponse && <pre className={styles.response}>{discogsResponse}</pre>}
           {/* <div className={styles.devModeToggle}>
             <label>
               <input type="checkbox" checked={isDevMode} onChange={handleDevModeToggle} />
               Developer Mode (Reduced Results)
             </label>
           </div> */}
        </div> 

        {/* Playlist Creation/Management Section */}
        {authStatus && (
          <div className={styles.section}>
              <h2>Manage YouTube Playlists</h2>
              <div>
                  <input
                    type="text"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    placeholder="New Playlist Name"
                    className={styles.input}
                  />
                  <button onClick={handleCreatePlaylist} className={styles.button} disabled={!playlistName.trim()}>
                    Create Playlist
                  </button>
                   {playlistResponse && <pre className={styles.response}>{playlistResponse}</pre>}
              </div>
              <div style={{ marginTop: '1em' }}>
                 <p className={styles.instructions}>Add a specific video to an existing playlist by ID.</p>
                  <input
                    type="text"
                    value={playlistId}
                    onChange={(e) => setPlaylistId(e.target.value)}
                    placeholder="Playlist ID (e.g., PLxxxxxxxxxxxx)"
                    className={styles.input}
                    style={{ marginRight: '0.5em' }}
                  />
                  <input
                    type="text"
                    value={videoId}
                    onChange={(e) => setVideoId(e.target.value)}
                    placeholder="Video ID (e.g., bVbt8qG7Fl8)"
                    className={styles.input}
                  />
                  <button onClick={handleAddVideoToPlaylist} className={styles.button} disabled={!playlistId.trim() || !videoId.trim()}>
                    Add Video to Playlist
                  </button>
                  {addVideoResponse.message && (
                    <pre className={`${styles.response} ${addVideoResponse.isError ? styles.error : ''}`}>{addVideoResponse.message}</pre>
                  )}
              </div>
          </div>
        )}

        {/* Real-time Progress Section */}
        <div className={styles.section}>
          <h2>Background Job Progress</h2>
          {/* Socket connection status indicator - Only show dynamic status after mounting */}
          <div className={styles.socketStatus}>
            <span>Socket Connection: </span>
            {hasMounted ? (
              <>
                <span className={socketStatus.connected ? styles.connected : styles.disconnected}>
                  {socketStatus.connected ? 'Connected' : 'Disconnected'}
                </span>
                {socketStatus.error && (
                  <span className={styles.error}> (Error: {socketStatus.error})</span>
                )}
              </>
            ) : (
              // During SSR and before hydration, always show disconnected
              <span className={styles.disconnected}>Disconnected</span>
            )}
          </div>
          
          <div className={styles.progressContainer}>
            <div>
              <strong>Status:</strong>{' '}
              {progress.isRunning
                ? progress.isPaused
                  ? 'Paused'
                  : 'Running'
                : 'Idle'}
            </div>
            <div>
              <strong>Progress:</strong>{' '}
              {progress.progress.current} / {progress.progress.total} releases processed
            </div>
            <div>
              <strong>Unique YouTube Links:</strong> {youtubeLinks.length}
            </div>
            {progress.waitTime > 0 && (
              <div className={styles.waitTime}>
                <strong>Rate limited. Waiting:</strong> {(progress.waitTime / 1000).toFixed(0)} seconds...
              </div>
            )}
            
            {/* Progress log output */}
            <div style={{ marginTop: 16, background: "#222", color: "#fff", padding: 8, borderRadius: 4, maxHeight: 120, overflowY: "auto", fontSize: 13 }}>
              <div><strong>Progress Log:</strong></div>
              {progressLogs.length === 0 ? (
                <div style={{fontStyle: 'italic', color: '#999'}}>No logs yet</div>
              ) : (
                progressLogs.map((log, i) => (
                  <div key={i}>{log}</div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
        
        {/* New Extract Images Section */}
        {/* <div className={styles.section}>
          <h2>Extract Images</h2>
          <input
            type="text"
            placeholder="Enter label ID or URL"
            value={extractImgsQuery}
            onChange={e => setExtractImgsQuery(e.target.value)}
            className={styles.input}
          />
          <button onClick={handleExtractImages} className={styles.searchButton}>
            Submit (First Page Only)
          </button>
          {extractImgsResult && <p className={styles.response}>{extractImgsResult}</p>}

         
          {videoTitleSuggestions.length > 0 && (
            <div style={{ marginTop: '1em' }}>
              <h3>Video Title Recommendations for Full Album Upload:</h3>
              <ul>
                {videoTitleSuggestions.map((title, idx) => (
                  <li key={idx}><code>{title}</code></li>
                ))}
              </ul>
            </div>
          )}
        </div> */}

        {/* Fetched YouTube Videos Section */}
        <div className={styles.section}>
          <h2>Fetched YouTube Videos</h2>
          {youtubeLinks.length === 0 ? (
            <p>No videos fetched yet.</p>
          ) : (
            <div className={styles.youtubeContainer}>
              {youtubeLinks.map((link, index) => (
                <div key={index} className={styles.youtubeEmbed}>
                  {/* Discogs release info above the video */}
                  <div style={{ marginBottom: 6 }}>
                    {link.discogsUrl && link.artist && link.releaseName ? (
                      <a
                        href={link.discogsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.discogsTitleLink}
                        style={{ color: "#111" }} // Force black text
                      >
                        {link.artist} - {link.releaseName}
                        {link.year ? ` (${link.year})` : ''}
                      </a>
                    ) : null}
                  </div>
                  {/* YouTube video link above the embed */}
                  {link.fullUrl && (
                    <div style={{ marginBottom: 4 }}>
                      <a
                        href={link.fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#007bff', textDecoration: 'underline', fontSize: '14px' }}
                      >
                        {link.fullUrl}
                      </a>
                    </div>
                  )}
                  {/* Fixed-size YouTube embed */}
                  <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                    <iframe
                      width="400"
                      height="225"
                      src={`https://www.youtube.com/embed/${link.videoId}`}
                      title={`YouTube Video ${index + 1}`}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ display: "block", maxWidth: "100%", borderRadius: "6px", background: "#000" }}
                    ></iframe>
                  </div>
                  {/* Divider under each video section */}
                  <hr className={styles.youtubeDivider} />
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </>
  );
}