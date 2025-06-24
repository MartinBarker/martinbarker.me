'use client'
import Head from 'next/head';
import styles from './discogs2youtube.module.css';
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const loggedAxios = axios;  // ← ADD THIS LINE

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
      if (typeof window === 'undefined') return [];
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
      if (typeof window === 'undefined') return {};
      const savedTaskData = localStorage.getItem('taskData');
      return savedTaskData ? JSON.parse(savedTaskData) : {};
  });
  const [loadedTasks, setLoadedTasks] = useState(new Set());
  const [extractImgInput, setExtractImgInput] = useState('');
  const [extractImgResult, setExtractImgResult] = useState('');
  const [extractImgsQuery, setExtractImgsQuery] = useState('https://www.discogs.com/label/935942-TR-Design');
  const [extractImgsResult, setExtractImgsResult] = useState('');

  // Add state for video title recommendations
  const [videoTitleSuggestions, setVideoTitleSuggestions] = useState([]);

  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
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
  }, [isPollingActive, apiUrl, selectedTaskId, backgroundJobStatus.isRunning, taskCompleted, backgroundJobStatus.progress]); // Added selectedTaskId & backgroundJobStatus.progress here as they are used indirectly

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
                  // Load links from saved data if available when auto-selecting first task
                  const firstTaskId = updatedTasks[0].id;
                  const savedData = taskData[firstTaskId];
                   if (savedData && savedData.youtubeLinks) {
                       setYoutubeLinks(savedData.youtubeLinks);
                   } else if (updatedTasks[0].youtubeLinks) {
                       setYoutubeLinks(updatedTasks[0].youtubeLinks);
                   } else {
                       setYoutubeLinks([]);
                   }
              }
          } catch (error) {
              console.error('Error fetching background tasks:', error.message || error);
          }
      };

      fetchBackgroundTasks();

      return () => {
          if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
          }
      };
  // Added taskData here as it's used to potentially load initial links
  }, [apiUrl, selectedTaskId, taskData]);

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
  }, [apiUrl, discogsAccessToken]);

  useEffect(() => {
      let interval;
      if (backgroundJobStatus.isRunning && !backgroundJobStatus.isPaused && !taskCompleted) {
          interval = setInterval(async () => {
              try {
                  const response = await loggedAxios.get(`${apiUrl}/background`);
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
                          saveTaskData(selectedTaskId, finalStats, finalLinksResponse.data.links); // Use selectedTaskId here
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
                      saveTaskData(selectedTaskId, response.data.progress, linksResponse.data.links); // Use selectedTaskId here
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
  // Added selectedTaskId because it's used in saveTaskData call
  }, [backgroundJobStatus.isRunning, backgroundJobStatus.isPaused, taskCompleted, apiUrl, backgroundJobStatus.progress, selectedTaskId]);

  // Make sure newly active tasks are expanded by default
  useEffect(() => {
      if (selectedTaskId) {
          setExpandedTasks(prev => ({
              ...prev,
              [selectedTaskId]: true
          }));
      }
  }, [selectedTaskId]);

  // When tasks are initially loaded or selected task changes, expand the selected task and load its data
  useEffect(() => {
      if (backgroundTasks.length > 0 && selectedTaskId) {
          setExpandedTasks(prev => ({
              ...prev,
              [selectedTaskId]: true // Expand the selected task
          }));

          // Load data associated with the selected task from localStorage
          const savedData = taskData[selectedTaskId];
          if (savedData && loadedTasks.has(selectedTaskId)) { // Check if already loaded to avoid overwriting active progress
              const uniqueLinksCount = savedData.youtubeLinks ? savedData.youtubeLinks.length : 0;

              const progressData = {
                  current: savedData.progress?.current || uniqueLinksCount,
                  total: savedData.progress?.total || uniqueLinksCount,
                  uniqueLinks: uniqueLinksCount
              };

              console.log('🔄 Reloading saved task progress from localStorage for task:', selectedTaskId, progressData);

              // Only set final stats if the task is actually completed, otherwise set backgroundJobStatus
              const selectedTaskObject = backgroundTasks.find(t => t.id === selectedTaskId);
              if (selectedTaskObject && selectedTaskObject.status === 'completed') {
                   setFinalTaskStats(progressData);
                   // Ensure background status reflects completion too
                   setBackgroundJobStatus(prev => ({
                       ...prev,
                       isRunning: false,
                       isPaused: false,
                       progress: progressData
                   }));
                   setTaskCompleted(true); // Make sure completion state is set
              } else if (!backgroundJobStatus.isRunning || backgroundJobStatus.artistId !== selectedTaskId) {
                 // If no job is running or a *different* job is running, update status from saved data
                 setBackgroundJobStatus(prev => ({
                      ...prev,
                      progress: progressData
                 }));
                 setTaskCompleted(false); // Ensure completion state is false if not completed
              }


              if (savedData.youtubeLinks) {
                  setYoutubeLinks(savedData.youtubeLinks);
              }
          } else if (!loadedTasks.has(selectedTaskId)) {
             // If not loaded yet, mark as loaded
              setLoadedTasks(prev => new Set([...prev, selectedTaskId]));
          }
      }
  // Added loadedTasks to dependencies to re-evaluate when a task is marked as loaded
  // Added backgroundJobStatus to ensure we don't overwrite active progress with stale loaded data
  }, [backgroundTasks, selectedTaskId, taskData, loadedTasks, backgroundJobStatus.isRunning, backgroundJobStatus.artistId]);


  // Add this effect to automatically expand new tasks
  useEffect(() => {
      if (backgroundTasks.length > 0) {
          const newTask = backgroundTasks[0];
          // Expand if it's a new task AND not already in expandedTasks state
          if (newTask && !expandedTasks[newTask.id]) {
              setExpandedTasks(prev => ({
                  ...prev,
                  [newTask.id]: true
              }));
              // Ensure it's marked as loaded immediately if it's being auto-expanded
              if (!loadedTasks.has(newTask.id)) {
                 setLoadedTasks(prev => new Set([...prev, newTask.id]));
              }
          }
      }
  // Depends on backgroundTasks to detect new tasks, expandedTasks to check if already expanded,
  // and loadedTasks to potentially mark as loaded.
  }, [backgroundTasks, expandedTasks, loadedTasks]);


  useEffect(() => {
      localStorage.setItem('taskData', JSON.stringify(taskData));
  }, [taskData]);

  const saveTaskData = (taskId, progress, links) => {
     if (!taskId) return; // Avoid saving data for null taskId
      setTaskData(prev => ({
          ...prev,
          [taskId]: {
              ...prev[taskId],
              progress: {
                  current: progress.current,
                  total: progress.total,
                  uniqueLinks: progress.uniqueLinks || (links ? links.length : 0) // Ensure uniqueLinks is saved correctly
              },
              youtubeLinks: links
          }
      }));
  };

  // This function seems redundant with saveTaskData, consider removing if functionality is identical
  // const saveTaskProgress = (taskId, progress, links) => {
  //     if (!taskId) return;
  //     setTaskData(prev => ({
  //         ...prev,
  //         [taskId]: {
  //             ...prev[taskId],
  //             progress: {
  //                 current: progress.current,
  //                 total: progress.total,
  //                 uniqueLinks: progress.uniqueLinks || (links ? links.length : 0)
  //             },
  //             youtubeLinks: links
  //         }
  //     }));
  // };


  const handleDiscogsSearch = async () => {
      if (!extractedId.trim() || !selectedType) return;

      if (!searchHistory.includes(discogsInput)) {
          setSearchHistory((prevHistory) => [discogsInput, ...prevHistory]);
      }

      setTaskCompleted(false); // Reset completion state for the new search
      setYoutubeLinks([]); // Clear previous links
      setBackgroundJobStatus({ // Reset background job status
          isRunning: false,
          isPaused: false,
          progress: { current: 0, total: 0, uniqueLinks: 0 },
          artistId: null, // Clear artistId
          artistName: null, // Clear artistName
      });
      setBackgroundJobError(null); // Clear any previous errors
      setBackgroundJobErrorDetails(null);
      setFinalTaskStats({ current: 0, total: 0, uniqueLinks: 0 }); // Reset final stats display


      try {
          const response = await loggedAxios.post(`${apiUrl}/discogsSearch`, {
              [selectedType]: extractedId,
              isDevMode,
          });

          // Fetch updated background tasks immediately after starting the job/search
          // regardless of whether it's artist, label, or list
          const fetchUpdatedTasks = async () => {
              try {
                  const tasksResponse = await loggedAxios.get(`${apiUrl}/backgroundTasks`);
                  const newTasks = tasksResponse.data.tasks || [];
                  setBackgroundTasks(newTasks);

                  // Auto-select the newly added task (usually the first one)
                  if (newTasks.length > 0) {
                      const latestTask = newTasks[0];
                       setSelectedTaskId(latestTask.id);
                       setExpandedTasks(prev => ({ ...prev, [latestTask.id]: true })); // Expand it
                       setLoadedTasks(prev => new Set([...prev, latestTask.id])); // Mark as loaded

                       // Update task info based on the response
                       setTaskInfo(prev => ({
                            ...prev,
                            artistName: latestTask.name || (selectedType === 'label' ? response.data.labelName : 'Task'),
                            taskStatus: 'starting'
                        }));

                       // Start polling if it's a background task type (label)
                       if (selectedType === 'label') {
                           console.log(`Starting background job for label: ${response.data.labelName}`);
                           setIsPollingActive(true);
                       }
                  }

              } catch (error) {
                  console.error('Error fetching updated background tasks:', error.message);
              }
          };

          // Handle response based on type BEFORE fetching tasks
           if (selectedType === 'label') {
               const { labelName } = response.data;
               setDiscogsResponse(`Label: ${labelName} - Background job started.`);
           } else {
               setDiscogsResponse(`Successfully fetched ${selectedType} data.`);
               // If it's not a background task (e.g., artist, list for now), display results directly if available
               if (response.data.youtubeLinks) {
                   setYoutubeLinks(response.data.youtubeLinks);
                   // Manually save data for non-background tasks if needed, or adjust backend to add them to tasks list too
               }
           }

          await fetchUpdatedTasks(); // Now fetch tasks to get the ID and update UI

      } catch (error) {
          console.error('Error during Discogs search:', error);
           const errorMsg = error.response?.data?.error || error.message || 'An unknown error occurred.';
           setDiscogsResponse(`Error: ${errorMsg}`);
           setBackgroundJobError(errorMsg); // Show error in the status area too
           setBackgroundJobErrorDetails(error.response?.data?.details || error.stack);


          // Fetch background tasks even if the search fails to update the list
          const fetchUpdatedTasksOnFailure = async () => {
              try {
                  const tasksResponse = await loggedAxios.get(`${apiUrl}/backgroundTasks`);
                  setBackgroundTasks(tasksResponse.data.tasks || []);
              } catch (fetchError) {
                  console.error('Error fetching updated background tasks after failure:', fetchError.message);
              }
          };
          fetchUpdatedTasksOnFailure();

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
                   // Update display status but keep isRunning based on the *actual* running job
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
  const displayProgress = taskCompleted ? finalTaskStats : backgroundJobStatus.progress;

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
        <h1>Discogs 2 YouTube Playlist</h1>

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
           <p className={styles.instructions}>
               Enter a Discogs Artist, Label, or List URL (e.g., <code>https://www.discogs.com/artist/2725-Kraftwerk</code>) or ID.
           </p>
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
            disabled={!authStatus || !discogsAuthStatus} // Disable if not authenticated
          />
          {extractedId && <p>Detected ID: {extractedId} {selectedType ? `(Type: ${selectedType})` : '(Select Type Above)'}</p>}
          <button onClick={handleSearchClick} className={styles.button} disabled={!extractedId || !selectedType || !authStatus || !discogsAuthStatus}>
            Search
          </button>
           {inputError && <p className={styles.error}>{inputError}</p>}
          {discogsResponse && <pre className={styles.response}>{discogsResponse}</pre>}
           <div className={styles.devModeToggle}>
             <label>
               <input type="checkbox" checked={isDevMode} onChange={handleDevModeToggle} />
               Developer Mode (Reduced Results)
             </label>
           </div>

           {/* Quick Fill / History - Optional */}
           {/* ... */}
        </div>

        {/* Background Tasks Section */}
        {backgroundTasks.length > 0 && (
          <div className={styles.section}>
              <h2>Background Tasks</h2>
               <button onClick={clearAllTasks} className={`${styles.button} ${styles.clearButton}`}>Clear All Tasks</button>
              <div className={styles.taskList}>
                  {backgroundTasks.map(task => {
                      const isSelected = task.id === selectedTaskId;
                       const isExpanded = !!expandedTasks[task.id];
                       const taskSpecificData = taskData[task.id];
                       const links = isSelected ? youtubeLinks : (taskSpecificData?.youtubeLinks || []);
                       const progress = isSelected ? displayProgress : (taskSpecificData?.progress || { current: 0, total: 0, uniqueLinks: 0 });
                       const uniqueLinkCount = progress.uniqueLinks || links.length;
                       const totalItems = progress.total || uniqueLinkCount; // Use total from progress if available
                       const currentItems = progress.current || uniqueLinkCount; // Use current from progress if available

                       // Determine status text/icon more dynamically
                       let statusText = task.status || 'waiting';
                       let statusClass = styles.statusWaiting;
                       const isActiveJob = backgroundJobStatus.isRunning && backgroundJobStatus.artistId === task.id;

                       if (isActiveJob) {
                          if (backgroundJobStatus.isPaused) {
                              statusText = 'paused'; statusClass = styles.statusPaused;
                          } else if (waitTime > 0) {
                              statusText = `rate-limited (${Math.ceil(waitTime / 1000)}s)`; statusClass = styles.statusRateLimited;
                          } else {
                              statusText = 'in-progress'; statusClass = styles.statusInProgress;
                          }
                       } else if (task.status === 'completed') {
                           statusText = 'completed'; statusClass = styles.statusCompleted;
                       } else if (task.status === 'paused') {
                           statusText = 'paused'; statusClass = styles.statusPaused;
                       } else if (task.status === 'error') {
                           statusText = 'error'; statusClass = styles.statusError;
                       }
                       // Add more specific statuses based on your backend logic if needed

                       return (
                           <div key={task.id} className={`${styles.taskItem} ${isSelected ? styles.selectedTask : ''}`} onClick={() => handleTaskClick(task.id)}>
                               <div className={styles.taskHeader}>
                                   <span className={styles.taskName}>{task.name || `Task ${task.id.substring(0, 6)}`}</span>
                                   <span className={`${styles.taskStatus} ${statusClass}`}>{statusText}</span>
                                   <div className={styles.taskActions}>
                                       {(statusText === 'in-progress' || statusText.startsWith('rate-limited')) && (
                                           <button onClick={(e) => handlePauseTask(task.id, e)} className={`${styles.button} ${styles.pauseButton}`}>Pause</button>
                                       )}
                                       {statusText === 'paused' && (
                                           <button onClick={(e) => handlePauseTask(task.id, e)} className={`${styles.button} ${styles.resumeButton}`}>Resume</button>
                                       )}
                                        <button onClick={(e) => stopBackgroundJob(task.id, e)} className={`${styles.button} ${styles.stopButton}`}>Stop</button>
                                       <button onClick={(e) => toggleTaskExpansion(task.id, e)} className={`${styles.button} ${styles.expandButton}`}>
                                           {isExpanded ? 'Collapse' : 'Expand'}
                                       </button>
                                   </div>
                               </div>
                               {isExpanded && (
                                  <div className={styles.taskDetails}>
                                      <p>Status: {statusText}</p>
                                      {/* Show progress bar only if task is not complete or has a total > 0 */}
                                       {(totalItems > 0 && statusText !== 'completed') || isActiveJob ? (
                                           <>
                                               <progress
                                                   value={currentItems}
                                                   max={totalItems}
                                                   className={styles.progressBar}
                                               />
                                                <span>{currentItems} / {totalItems} releases processed</span>
                                                <br />
                                                <span>{uniqueLinkCount} unique YouTube links found</span>
                                            </>
                                       ) : statusText === 'completed' ? (
                                           <span>Completed: {uniqueLinkCount} unique YouTube links found from {totalItems} releases.</span>
                                       ) : (
                                           <span>Waiting or initializing...</span>
                                       )}

                                       {backgroundJobError && isSelected && (
                                         <div className={styles.errorDetails}>
                                             <p className={styles.error}>Error: {backgroundJobError}</p>
                                              {backgroundJobErrorDetails && <pre>{JSON.stringify(backgroundJobErrorDetails, null, 2)}</pre>}
                                          </div>
                                       )}

                                      {/* Display YouTube Links for the selected and expanded task */}
                                      {links.length > 0 && (
                                          <div className={styles.linksSection}>
                                              <h4>YouTube Links ({uniqueLinkCount} unique)</h4>
                                              {/* Generate Playlist Links */}
                                              {currentPlaylistUrls.length > 0 && isSelected && (
                                                 <div className={styles.playlistLinks}>
                                                     <h5>Create Playlist from Links:</h5>
                                                     {currentPlaylistUrls.map((pl, index) => (
                                                         <p key={index}>
                                                             <a href={pl.url} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
                                                                 Create Playlist Part {index + 1} ({pl.start}-{pl.end})
                                                             </a> ({pl.count} videos)
                                                         </p>
                                                     ))}
                                                     <p className={styles.smallText}>(Requires YouTube login. Creates an unsaved playlist.)</p>
                                                 </div>
                                              )}
                                              <ul className={styles.linksList}>
                                                  {links.map((link, index) => (
                                                      <li key={`${link.videoId}-${index}`}>
                                                          <a href={`https://www.youtube.com/watch?v=${link.videoId}`} target="_blank" rel="noopener noreferrer">
                                                              {link.title || `Video ${index + 1}`}
                                                          </a>
                                                          <span> (Score: {link.score?.toFixed(2) ?? 'N/A'})</span>
                                                          <span> - From: <a href={`https://www.discogs.com${link.releaseUrl}`} target="_blank" rel="noopener noreferrer">{link.releaseTitle}</a></span>
                                                      </li>
                                                  ))}
                                              </ul>
                                          </div>
                                      )}
                                  </div>
                               )}
                           </div>
                       );
                  })}
              </div>
          </div>
        )}


        {/* Playlist Creation/Management Section (Optional based on auth) */}
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

        {/* New Extract Images Section */}
        <div className={styles.section}>
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

          {/* Video Title Suggestions */}
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
        </div>

      </div>
    </>
  );
}

