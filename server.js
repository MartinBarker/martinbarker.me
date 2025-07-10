// When running locally, make sure to set 'NODE_ENV=development' in the .env file

require('dotenv').config();
const { GetSecretValueCommand, SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const express = require('express');
const fs = require('fs');
const path = require('path'); // Add path module for file operations
const { google } = require('googleapis');
const readline = require('readline');
const axios = require('axios'); // Ensure axios is imported
const crypto = require('crypto'); // For generating nonces
const querystring = require('querystring'); // For query string manipulation
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const session = require('express-session');
const sharedSession = require('express-socket.io-session');

// --- Determine if we are in dev or production environment ---
var isDev = process.env.NODE_ENV === 'development' ? true : false;
console.log('isDev = ', isDev);
/*
Difference between dev and prod:
  In dev we can access api route directly on port 3030 such as 'http://localhost:3030/listogs/discogs/getURL'
  In prod we access the api route through the main domain but with '/internal-api/' such as 'https://jermasearch.com/internal-api/listogs/discogs/getURL'
*/

// --- Start up express server on port 3030 ---
const port = 3030;
const app = express();
app.use(express.json());
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Only secure in prod
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-site cookies in prod
    domain: process.env.NODE_ENV === 'production' ? '.jermasearch.com' : undefined, // Set domain for prod
  }
});
app.use(sessionMiddleware);

// Define allowed origins for both local and production
const allowedOrigins = [
  'http://localhost:3030',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://jermasearch.com',
  'https://www.jermasearch.com'
];

// Use dynamic CORS middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// --- Socket.IO setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// --- Socket.IO connection logic start ---
const sessionSocketMap = new Map();

io.use(sharedSession(sessionMiddleware, { autoSave: true }));

io.on('connection', (socket) => {
  const { sessionID } = socket.handshake;

  if (sessionID) {
    if (!sessionSocketMap.has(sessionID)) {
      sessionSocketMap.set(sessionID, new Set());
    }
    sessionSocketMap.get(sessionID).add(socket);
  }
  console.log('[Socket.IO] connect  id=%s  sid=%s', socket.id, sessionID);
  socket.emit('sessionLog', `[server] ✅ socket connected (id=${socket.id}  sid=${sessionID})`);

  if (sessionID) {
    if (!sessionSocketMap.has(sessionID)) sessionSocketMap.set(sessionID, new Set());
    sessionSocketMap.get(sessionID).add(socket);
  }
  console.log('[Socket.IO] connect  id=%s  sid=%s', socket.id, sessionID);

  socket.on('disconnect', () => {
    if (sessionID && sessionSocketMap.has(sessionID)) {
      const set = sessionSocketMap.get(sessionID);
      set.delete(socket);
      if (set.size === 0) sessionSocketMap.delete(sessionID);
    }
    console.log('[Socket.IO] disconnect id=%s sid=%s', socket.id, sessionID);
  });
});
// --- Socket.IO connection logic end---


// Emit progress to all connected clients and log to server console
function emitProgressUpdate(extraLog) {
  const data = {
    progress: backgroundJob.progress,
    waitTime: backgroundJob.waitTime,
    isRunning: backgroundJob.isRunning,
    isPaused: backgroundJob.isPaused
  };
  io.emit('progress', data);
  if (extraLog) {
    io.emit('progressLog', extraLog);
    console.log('[Socket.IO] Emitting progressLog:', extraLog);
  }
  console.log('[Socket.IO] Emitting progress:', data);
}

// YouTube configuration
const TOKEN_PATH = 'tokens.json';
const LINKS_JSON_PATH = 'youtube_links.json';

let oauth2Client = null;
let youtube = null;
let signInUrl = null;

const authStatus = { isAuthenticated: false }; // Track authentication status

// Centralized function to generate the redirect URI
function getRedirectUri() {
  return prodCallback;
}

// Function to determine the redirect URL based on the environment
function getRedirectUrl() {
  if (isDev) {
    return 'http://localhost:3030/listogs/youtube/callback'; // Updated local redirect URL
  }
  return 'https://jermasearch.com/internal-api/listogs/youtube/callback'; // Updated production redirect URL
}

function getDiscogsRediurectUrl() {
  if (isDev) {
    return 'http://localhost:3030/listogs/callback/discogs';
  }
  return 'https://jermasearch.com/internal-api/listogs/callback/discogs';
}

function getDiscogsFrontendRedirectUrl() {
  if (isDev) {
    return 'http://localhost:3001/listogs?discogsAuth=success';
  }
  return 'https://jermasearch.com/listogs?discogsAuth=success';
}

// Centralized function to initialize the OAuth2 client
function initializeOAuthClient(clientId, clientSecret) {
  const redirectUri = getRedirectUrl();
  console.log('youtube redirectUri = ', redirectUri);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Centralized function to generate the sign-in URL
function generateSignInUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    prompt: 'consent',
  });
}

// Initialize OAuth2 client and YouTube API
async function initializeOAuth() {
  console.log('\nInitializing OAuth...');
  oauth2Client = initializeOAuthClient(gcpClientId, gcpClientSecret);
  youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client,
  });

  signInUrl = generateSignInUrl(oauth2Client);
}

// Load tokens from file
function loadTokens() {
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oauth2Client.setCredentials(tokens);
    console.log('Tokens loaded from file.');
    return true;
  } catch (error) {
    console.log('No tokens found, starting OAuth flow...');
    return false;
  }
}

// Save tokens to file (disabled to prevent creating tokens.json)
function saveTokens(tokens) {
  console.log('Tokens received:', tokens); // Log tokens instead of saving them
}

// Handle OAuth2 callback
app.get('/oauth2callback', (req, res) => {
  console.log("🔑 [GET /oauth2callback] Hit:", req.originalUrl);
  console.log('\nFull URL received:', req.protocol + '://' + req.get('host') + req.originalUrl); // Print full URL

  const { code } = req.query;
  if (code) {
    oauth2Client.getToken(code, (err, tokens) => {
      if (err) {
        console.error('\nError getting tokens:', err.message);
        res.status(500).send('Authentication failed.');
        return;
      }

      oauth2Client.setCredentials(tokens);

      console.log('\nUser authenticated. Tokens:', tokens);

      // Update authentication status
      authStatus.isAuthenticated = true;

      // Redirect to /listogs route
      const redirectUrl = getRedirectUrl();
      res.redirect(redirectUrl);
    });
  } else {
    res.status(400).send('No code found in the request.');
  }
});

// Endpoint to get authentication status
app.get('/authStatus', (req, res) => {
  console.log("🔍 [GET /authStatus] Hit");
  res.status(200).json(authStatus);
});

// Handle YouTube OAuth2 callback
app.get('/listogs/youtube/callback', async (req, res) => {
  console.log("📺 [GET /listogs/youtube/callback] Hit:", req.originalUrl);

  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No code found in the request.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log('\nYouTube User authenticated. Tokens:', tokens);

    // Update authentication status
    authStatus.isAuthenticated = true;

    // Redirect to the frontend route
    const redirectUrl = isDev ? 'http://localhost:3001/listogs' : 'https://jermasearch.com/listogs';
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('\nError during YouTube authentication:', error.message);
    res.status(500).send('Authentication failed.');
  }
});

// Route to handle the production callback URL
app.get('/youtube/callback', (req, res) => {
  console.log("📺 [GET /youtube/callback] Hit:", req.originalUrl);
  // if (envVar !== 'production') {
  //   return res.status(403).send('This route is only available in production.');
  // }

  const { code } = req.query;
  if (code) {
    oauth2Client.getToken(code, (err, tokens) => {
      if (err) {
        console.error('\nError getting tokens:', err.message);
        return res.status(500).send('Authentication failed.');
      }

      oauth2Client.setCredentials(tokens);

      console.log('\nUser authenticated in production. Tokens:', tokens);

      // Send a success response
      res.status(200).send('Your authentication info has been processed.');
    });
  } else {
    res.status(400).send('No code found in the request.');
  }
});

// Route to clear user auth info (no longer needed as no data is stored)
app.post('/clearAuth', (req, res) => {
  console.log("🧹 [POST /clearAuth] Hit");
  res.status(200).send('No authentication info to clear.');
});

// Generate sign-in URL endpoint
app.get('/generateURL', (req, res) => {
  console.log("🌐 [GET /generateURL] Hit");
  try {
    if (!signInUrl) {
      throw new Error('Sign-in URL not initialized');
    }
    res.status(200).json({ url: signInUrl });
  } catch (error) {
    console.error('Error generating sign-in URL:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Route to handle Discogs search
app.post('/discogsAuth', async (req, res) => {
  console.log("🎶 [POST /discogsAuth] Hit", req.body);
  const { query } = req.body;

  if (!query) {
    console.error("❌ No query provided in the request body.");
    return res.status(400).json({ error: 'No query provided.' });
  }

  console.log("🔍 Processing query:", query);

  if (query.startsWith('[l') && query.endsWith(']')) {
    // Label ID
    const labelId = query.slice(2, -1);
    console.log(`✅ Detected Label ID: ${labelId}`);
    res.status(200).json({ type: 'label', id: `label:${labelId}` });
  } else if (query.startsWith('[a') && query.endsWith(']')) {
    // Artist ID
    const artistId = query.slice(2, -1);
    console.log(`✅ Detected Artist ID: ${artistId}`);
    try {
      const url = `${DISCOGS_API_URL}/artists/${artistId}`;
      console.log(`🌐 Fetching Discogs artist data from URL: ${url}`);
      let headers = { 'User-Agent': USER_AGENT };

      // If user is signed in, include OAuth header
      const discogsAuth = req.session?.discogsAuth;
      if (discogsAuth?.accessToken) {
        console.log("🔑 User is authenticated. Adding OAuth headers.");
        const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
        headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
      } else {
        console.log("🔓 User is not authenticated. Proceeding without OAuth headers.");
      }

      const response = await axios.get(url, { headers });
      console.log("✅ Successfully fetched Discogs artist data:", response.data);

      res.status(200).json({
        type: 'artist',
        id: `artist:${artistId}`,
        apiResponse: response.data, // Include API response for UI display
      });
    } catch (error) {
      console.error("❌ Error fetching Discogs artist data:", error.message);
      res.status(500).json({ error: 'Failed to fetch artist data from Discogs.' });
    }
  } else if (query.startsWith('https://www.discogs.com/lists/')) {
    // List URL
    const listId = query.split('/').pop();
    console.log(`✅ Detected List URL. Extracted List ID: ${listId}`);
    res.status(200).json({ type: 'list', id: `list:${listId}` });
  } else {
    console.error("❌ Invalid query format. Query does not match expected patterns.");
    res.status(400).json({ error: 'Invalid query format.' });
  }
});

app.post('/discogsSearch', async (req, res) => {
  console.log("🎶 [POST /discogsSearch] Hit", req.body);

  const { artist, label, list, isDevMode } = req.body;
  let type, id;

  if (artist) {
    type = 'artist';
    id = artist;
  } else if (label) {
    type = 'label';
    id = label;
  } else if (list) {
    type = 'list';
    id = list;
  } else {
    return res.status(400).json({ error: 'Invalid query. Please provide an artist, label, or list ID.' });
  }

  try {
    if (type === 'artist' || type === 'label') {
      const url = `${DISCOGS_API_URL}/${type}s/${id}`;
      console.log(`🌐 Fetching Discogs ${type} data from URL: ${url}`);
      // Emit progress log to clients
      io.emit('progressLog', `Fetching Discogs ${type} data from URL: ${url}`);

      const headers = { 'User-Agent': USER_AGENT };

      const discogsAuth = req.session?.discogsAuth;
      if (discogsAuth?.accessToken) {
        const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
        headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
      }

      // Fetch artist/label info with retry
      const response = await fetchWithRetry(url, { headers });
      const name = response.data.name;
      console.log(`✅ ${type} data fetched for: ${name}`);
      io.emit('progressLog', `✅ ${type} data fetched for: ${name}`);

      // Initialize progress data
      const progressData = {
        isRunning: true,
        isPaused: false,
        waitTime: 0,
        progress: { current: 0, total: 0, uniqueLinks: 0 }
      };


      // Fetch all release IDs
      const releaseIds = type === 'artist'
        ? await fetchReleaseIds(id, isDevMode)
        : await fetchLabelReleaseIds(id, isDevMode);

      console.log(`🎵 Found ${releaseIds.length} releases to process`);
      io.emit('progressLog', `🎵 Found ${releaseIds.length} releases to process`);

      // Update progress total
      progressData.progress.total = releaseIds.length;
      io.emit('progress', progressData);


      // Fetch YouTube links for all releases with better error handling
      const allVideos = [];
      const errors = [];
      const uniqueVideoIds = new Set();

      for (let i = 0; i < releaseIds.length; i++) {
        const releaseId = releaseIds[i];
        try {
          const videos = await fetchVideoIds(releaseId);
          allVideos.push(...videos);

          // Count unique videos
          videos.forEach(video => {
            if (video.url) {
              uniqueVideoIds.add(video.url);
            }
          });

          // Update progress
          progressData.progress.current = i + 1;
          progressData.progress.uniqueLinks = uniqueVideoIds.size;

          const logMsg = `✅ Processed release ${i + 1}/${releaseIds.length}: Found ${videos.length} videos, Total unique: ${uniqueVideoIds.size}`;
          console.log(logMsg);
          io.emit('progressLog', logMsg);
          io.emit('progress', progressData);
        } catch (error) {
          console.error(`❌ Error processing release ${releaseId}:`, error.message);
          io.emit('progressLog', `❌ Error processing release ${releaseId}: ${error.message}`);

          errors.push({ releaseId, error: error.message });

          // Handle rate limiting
          if (error.response?.status === 429) {
            const waitTime = 5000;  // 5 seconds wait
            progressData.waitTime = waitTime;
            io.emit('progressLog', `⏳ Rate limit hit. Waiting ${waitTime / 1000} seconds...`);
            io.emit('progress', progressData);

            await new Promise(resolve => setTimeout(resolve, waitTime));
            progressData.waitTime = 0;
          }

          // Update progress even after error
          progressData.progress.current = i + 1;
          io.emit('progress', progressData);

          // Continue with next release instead of failing completely
          continue;
        }
      }

      // Mark job as completed
      progressData.isRunning = false;
      io.emit('progress', progressData);
      io.emit('progressLog', `✅ Processing complete! Found ${uniqueVideoIds.size} unique YouTube videos.`);

      // Return results with any errors encountered
      res.status(200).json({
        name,
        [`${type}Data`]: response.data,
        videos: allVideos,
        stats: {
          totalReleases: releaseIds.length,
          successfullyProcessed: releaseIds.length - errors.length,
          totalVideos: allVideos.length,
          errors: errors.length ? errors : undefined
        }
      });
    } else {
      res.status(400).json({ error: 'List type is not yet implemented.' });
    }
  } catch (error) {
    console.error(`❌ Error in /discogsSearch for type ${type}:`, error.message);
    io.emit('progressLog', `❌ Error in discogsSearch: ${error.message}`);
    io.emit('progress', { isRunning: false, isPaused: false, waitTime: 0, progress: { current: 0, total: 0, uniqueLinks: 0 } });
    res.status(500).json({
      error: `Failed to fetch ${type} data from Discogs.`,
      details: error.message
    });
  }
});

async function startBackgroundJob({ artistId, labelId, isDevMode, artistName }) {
  if (backgroundJob.isRunning) {
    throw new Error('A job is already running.');
  }

  backgroundJob.isRunning = true;
  backgroundJob.isPaused = false;
  backgroundJob.artistId = artistId || null;
  backgroundJob.labelId = labelId || null;
  backgroundJob.artistName = artistName || null; // Store artist/label name
  backgroundJob.progress = { current: 0, total: 0, uniqueLinks: 0 };
  backgroundJob.uniqueLinks.clear();
  backgroundJob.waitTime = 0;

  emitProgressUpdate();
  const processReleases = async () => {
    try {
      const releaseIds = artistId
        ? await fetchReleaseIds(artistId, isDevMode)
        : await fetchLabelReleaseIds(labelId, isDevMode);

      backgroundJob.progress.total = releaseIds.length;
      emitProgressUpdate();

      for (let i = 0; i < releaseIds.length; i++) {
        if (!backgroundJob.isRunning) break;
        while (backgroundJob.isPaused || backgroundJob.waitTime > 0) {
          emitProgressUpdate();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (backgroundJob.waitTime > 0) backgroundJob.waitTime -= 1000;
        }

        const releaseId = releaseIds[i];
        try {
          const videos = await fetchVideoIds(releaseId);
          videos.forEach((video) => backgroundJob.uniqueLinks.add(video));
          backgroundJob.progress.current = i + 1;
          backgroundJob.progress.uniqueLinks = backgroundJob.uniqueLinks.size;
          backgroundJob.waitTime = 0;
          const logMsg = `Processed release ${i + 1}/${releaseIds.length}: Release ID ${releaseId}, Found ${videos.length} videos, Total unique: ${backgroundJob.progress.uniqueLinks}`;
          emitProgressUpdate(logMsg);
        } catch (error) {
          if (error.response?.status === 429) {
            backgroundJob.waitTime = backgroundJob.waitTime > 0 ? backgroundJob.waitTime + 5000 : 5000;
            emitProgressUpdate('Rate limit hit. Waiting...');
          } else {
            throw error;
          }
        }
        if (isDevMode) break;
      }
      backgroundJob.progress.current = backgroundJob.progress.total;
      backgroundJob.isRunning = false;
      emitProgressUpdate('Background job completed.');
    } catch (error) {
      backgroundJob.isRunning = false;
      backgroundJob.error = error.message;
      emitProgressUpdate('Background job error: ' + error.message);
    }
  };
  processReleases();
}

app.post('/startBackgroundJob', async (req, res) => {
  const { artistId, labelId, isDevMode, taskId, artistName } = req.body;
  if (backgroundJob.isRunning) {
    return res.status(400).json({ error: 'A job is already running.' });
  }
  backgroundJob.isRunning = true;
  backgroundJob.isPaused = false;
  backgroundJob.artistId = artistId || null;
  backgroundJob.labelId = labelId || null;
  backgroundJob.artistName = artistName || null; // Store artist/label name
  backgroundJob.progress = { current: 0, total: 0, uniqueLinks: 0 };
  backgroundJob.uniqueLinks.clear();
  backgroundJob.waitTime = 0;

  const processReleases = async () => {
    try {
      const releaseIds = artistId
        ? await fetchReleaseIds(artistId, isDevMode)
        : await fetchLabelReleaseIds(labelId, isDevMode);

      backgroundJob.progress.total = releaseIds.length;
      console.log(`🎵 Total releases to process: ${releaseIds.length}`);

      for (let i = 0; i < releaseIds.length; i++) {
        if (!backgroundJob.isRunning) break;
        while (backgroundJob.isPaused || backgroundJob.waitTime > 0) {
          // Update status when paused or rate-limited
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (backgroundJob.waitTime > 0) backgroundJob.waitTime -= 1000;
        }

        const releaseId = releaseIds[i];
        console.log(`🎧 Processing release ${i + 1} of ${releaseIds.length}: Release ID ${releaseId}`);

        try {
          const videos = await fetchVideoIds(releaseId);
          videos.forEach((video) => backgroundJob.uniqueLinks.add(video));
          backgroundJob.progress.current = i + 1;
          backgroundJob.progress.uniqueLinks = backgroundJob.uniqueLinks.size;
          console.log(`🎥 Found ${videos.length} videos for release ${releaseId}. Total unique videos: ${backgroundJob.progress.uniqueLinks}`);
          backgroundJob.waitTime = 0; // Reset wait time on success
        } catch (error) {
          if (error.response?.status === 429) {
            backgroundJob.waitTime = backgroundJob.waitTime > 0 ? backgroundJob.waitTime + 5000 : 5000;
            console.error(`⏳ Rate limit hit. Retrying in ${backgroundJob.waitTime / 1000} seconds...`);
          } else {
            throw error;
          }
        }

        if (isDevMode) {
          console.log('🛠 Dev mode enabled: Skipping pagination.');
          break; // Skip pagination in Dev Mode
        }
      }

      console.log('✅ Background job completed.');
      // Ensure final stats are preserved
      backgroundJob.progress.current = backgroundJob.progress.total;
      backgroundJob.isRunning = false;
    } catch (error) {
      console.error('❌ Error processing releases:', error.message);
      backgroundJob.isRunning = false;
      backgroundJob.error = error.message;
    }
  };

  processReleases();
  // Add SSE update after state changes
  emitProgressUpdate();
  res.status(200).json({ message: 'Background job started.' });
});

async function fetchReleaseIds(artistId, isDevMode) {
  const url = `${DISCOGS_API_URL}/artists/${artistId}/releases`;
  const releases = await makeDiscogsRequest(url, isDevMode);
  return releases.map((release) => release.main_release || release.id);
}

async function fetchLabelReleaseIds(labelId, isDevMode) {
  const url = `${DISCOGS_API_URL}/labels/${labelId}/releases`;
  const releases = await makeDiscogsRequest(url, isDevMode);
  return releases.map((release) => release.id);
}

async function makeDiscogsRequest(url, isDevMode) {
  console.log(`makeDiscogsRequest: ${url}`);
  let allData = [];
  let retryCount = 0;

  try {
    while (url) {
      try {
        const response = await axios.get(url, {
          headers: { 'User-Agent': USER_AGENT },
        });
        allData = allData.concat(response.data.releases || []);
        if (isDevMode) {
          console.log('Dev mode enabled: Skipping pagination.');
          break; // Exit loop after the first request in Dev Mode
        }
        url = response.data.pagination?.urls?.next || null;
        retryCount = 0; // Reset retry count on success
      } catch (error) {
        if (error.response?.status === 429) {
          retryCount++;
          const waitTime = Math.pow(2, retryCount) * 1000;
          const logMsg = `⏳ Rate limit hit. Retrying in ${waitTime / 1000} seconds... (attempt ${retryCount})`;
          console.error(logMsg);
          io.emit('progressLog', logMsg); // Send logMsg to frontend
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('Error making Discogs request:', error.message);
    throw error;
  }
  return allData;
}

const DISCOGS_API_URL = 'https://api.discogs.com';
const USER_AGENT = 'MyDiscogsClient/1.0 +http://mydiscogsclient.org';
const DISCOGS_REQUEST_TOKEN_URL = 'https://api.discogs.com/oauth/request_token';
const DISCOGS_AUTHORIZE_URL = 'https://discogs.com/oauth/authorize';

// Function to make a single Discogs API request
async function fetchDiscogsData(type, id) {
  try {
    let url = '';
    if (type === 'label') {
      url = `${DISCOGS_API_URL}/labels/${id}/releases`;
    } else if (type === 'artist') {
      url = `${DISCOGS_API_URL}/artists/${id}/releases`;
    } else if (type === 'list') {
      url = `${DISCOGS_API_URL}/lists/${id}`;
    } else if (type === 'release') {
      url = `${DISCOGS_API_URL}/releases/${id}`;
    } else if (type === 'master') {
      url = `${DISCOGS_API_URL}/masters/${id}`;
    } else {
      throw new Error('Invalid type provided.');
    }

    console.log(`Fetching Discogs data from URL: ${url}`);
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    // For release/master, return full JSON
    if (type === 'release' || type === 'master') {
      return response.data;
    }
    // Return only the first item from the response for other types
    if (response.data.releases && response.data.releases.length > 0) {
      return response.data.releases[0];
    } else if (response.data.items && response.data.items.length > 0) {
      return response.data.items[0];
    } else {
      return { message: 'No items found.' };
    }
  } catch (error) {
    console.error('Error fetching Discogs data:', error.message);
    throw error;
  }
}

// Add this helper function for exponential backoff
async function fetchWithRetry(url, options, maxRetries = 15) {
  let retryCount = 0;
  let lastError = null;
  let rateLimitStart = null;

  while (retryCount < maxRetries) {
    try {
      const response = await axios.get(url, options);
      // If we were in a rate limit session, print how long it took
      if (rateLimitStart !== null) {
        const seconds = ((Date.now() - rateLimitStart) / 1000).toFixed(1);
        const msg = `✅ Rate limit recovery: ${seconds} seconds since last 429 to first success.`;
        console.log(msg);
        io.emit('progressLog', msg);
        rateLimitStart = null;
      }
      return response;
    } catch (error) {
      if (error.response?.status === 429) {
        retryCount++;
        if (rateLimitStart === null) rateLimitStart = Date.now();
        const waitTime = Math.min(1000 * Math.pow(2, retryCount), 32000); // Cap at 32 seconds
        const logMsg = `⏳ Rate limit hit. Attempt ${retryCount}/${maxRetries}. Waiting ${waitTime / 1000} seconds...`;
        console.log(logMsg);
        io.emit('progressLog', logMsg); // Send logMsg to frontend
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error; // For non-429 errors, throw immediately
      }
    }
  }
  throw lastError || new Error('Max retries exceeded');
}

// Update fetchVideoIds to use the retry logic
async function fetchVideoIds(releaseId) {
  const url = `${DISCOGS_API_URL}/releases/${releaseId}`;
  const options = {
    headers: { 'User-Agent': USER_AGENT },
  };

  try {
    const response = await fetchWithRetry(url, options);
    // Extract artist, title, year, and Discogs URL from the release data
    const artist = response.data.artists_sort || (response.data.artists && response.data.artists[0]?.name) || '';
    const title = response.data.title || '';
    const year = response.data.year || '';
    const discogsUrl = response.data.uri || `https://www.discogs.com/release/${releaseId}`;

    const videos = response.data.videos?.map((video) => ({
      videoId: video.uri.split("v=")[1],
      fullUrl: video.uri, // Include full YouTube URL
      artist,
      releaseName: title,
      releaseId: releaseId,
      year,
      discogsUrl,
    })) || [];

    // Print each fetched YouTube URL with emojis
    videos.forEach(video => {
      console.log(`🎥 Fetched YouTube URL: ${video.fullUrl}`);
    });

    // Emit all YouTube URLs to the front end in real-time as 'results'
    // Now send the full video objects (with artist/title/year/discogsUrl)
    io.emit("results", videos);

    return videos;
  } catch (error) {
    console.error(`❌ Error fetching videos for release ${releaseId}:`, error.message);
    throw error;
  }
}

// Route to handle Discogs API requests
app.post('/discogsFetch', async (req, res) => {
  console.log("📡 [POST /discogsFetch] Hit", req.body);
  const { type, id } = req.body;

  if (!type || !id) {
    return res.status(400).json({ error: 'Type and ID are required.' });
  }

  try {
    const data = await fetchDiscogsData(type, id);
    // Only log a summary, not the full response
    if (data && data.id) {
      console.log(`Discogs API Response: type=${type}, id=${id}, response.id=${data.id}`);
    } else if (data && data.message) {
      console.log(`Discogs API Response: type=${type}, id=${id}, message=${data.message}`);
    } else {
      console.log(`Discogs API Response: type=${type}, id=${id}, response received.`);
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from Discogs.' });
  }
});

// DEBUG_generateDiscogsAuthUrl: returns the Discogs auth URL (no session logic, just for debug)
function DEBUG_generateDiscogsAuthUrl() {
  const oauthNonce = crypto.randomBytes(16).toString('hex');
  const oauthTimestamp = Math.floor(Date.now() / 1000);
  const callbackUrl = getDiscogsRediurectUrl();
  const authHeader = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_nonce="${oauthNonce}", oauth_signature="${discogsConsumerSecret}&", oauth_signature_method="PLAINTEXT", oauth_timestamp="${oauthTimestamp}", oauth_callback="${callbackUrl}"`;
  return axios.get(DISCOGS_REQUEST_TOKEN_URL, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: authHeader,
      'User-Agent': USER_AGENT,
    },
  });
}

// DEBUG_discogsAuthUrl endpoint for frontend test page
app.get('/DEBUG_discogsAuthUrl', async (req, res) => {
  try {
    const response = await DEBUG_generateDiscogsAuthUrl();
    const { oauth_token } = querystring.parse(response.data);
    const url = `${DISCOGS_AUTHORIZE_URL}?oauth_token=${oauth_token}`;
    res.status(200).json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate Discogs auth URL.' });
  }
});

// Generate a random string for OAuth nonce
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

// Global variable to store mapping between oauth_token and oauth_token_secret
let discogsRequestTokens = {};

// Middleware to ensure secrets are initialized before handling requests
function ensureSecretsInitialized(req, res, next) {
  if (!secretsInitialized) {
    return res.status(503).json({ error: 'Secrets are not initialized yet. Please try again later.' });
  }
  next();
}

// Generate the Discogs sign-in URL
app.get('/discogs/generateURL', ensureSecretsInitialized, async (req, res) => {
  console.log("🔐 [GET /discogs/generateURL] Hit");
  try {
    const oauthNonce = generateNonce();
    const oauthTimestamp = Math.floor(Date.now() / 1000);
    const callbackUrl = getDiscogsRediurectUrl();
    console.log('discogs callback url = ', callbackUrl);

    const authHeader = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_nonce="${oauthNonce}", oauth_signature="${discogsConsumerSecret}&", oauth_signature_method="PLAINTEXT", oauth_timestamp="${oauthTimestamp}", oauth_callback="${callbackUrl}"`;

    const response = await axios.get(DISCOGS_REQUEST_TOKEN_URL, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
        'User-Agent': USER_AGENT,
      },
    });

    const { oauth_token, oauth_token_secret } = querystring.parse(response.data);

    discogsRequestTokens[oauth_token] = oauth_token_secret;

    res.status(200).json({
      url: `${DISCOGS_AUTHORIZE_URL}?oauth_token=${oauth_token}`,
      oauth_token,
      oauth_token_secret,
    });
  } catch (error) {
    console.error('Error generating Discogs URL:', error.message);
    res.status(500).json({ error: 'Failed to generate Discogs sign-in URL.' });
  }
});


// --- Discogs OAuth: Exchange request token for access token ---
async function getAccessToken(oauth_token, oauth_verifier) {
  // Find the request token secret from our in-memory store
  const oauth_token_secret = discogsRequestTokens[oauth_token];
  if (!oauth_token_secret) {
    throw new Error('Request token secret not found for provided oauth_token.');
  }

  const oauth_nonce = generateNonce();
  const oauth_timestamp = Math.floor(Date.now() / 1000);

  // PLAINTEXT signature: consumer_secret&token_secret
  const oauth_signature = `${discogsConsumerSecret}&${oauth_token_secret}`;

  const authHeader = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${oauth_token}", oauth_signature_method="PLAINTEXT", oauth_signature="${oauth_signature}", oauth_timestamp="${oauth_timestamp}", oauth_nonce="${oauth_nonce}", oauth_verifier="${oauth_verifier}"`;

  const url = 'https://api.discogs.com/oauth/access_token';

  try {
    const response = await axios.post(url, null, {
      headers: {
        'Authorization': authHeader,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    // Parse response: oauth_token=...&oauth_token_secret=...
    const parsed = querystring.parse(response.data);
    if (!parsed.oauth_token || !parsed.oauth_token_secret) {
      throw new Error('Invalid response from Discogs access_token endpoint.');
    }
    return {
      accessToken: parsed.oauth_token,
      accessTokenSecret: parsed.oauth_token_secret
    };
  } catch (error) {
    throw new Error('Failed to obtain Discogs access token: ' + (error.response?.data || error.message));
  }
}

// Handle the Discogs OAuth callback
app.post('/listogs/callback/discogs', async (req, res) => {
  try {
    // Accept oauth_token, oauth_verifier, and optionally oauth_token_secret from frontend
    const { oauth_token, oauth_verifier, oauth_token_secret } = req.body;
    console.log('[Discogs Callback] oauth_token:', oauth_token, 'oauth_verifier:', oauth_verifier, 'oauth_token_secret:', oauth_token_secret);

    if (!oauth_token || !oauth_verifier) {
      return res.status(400).json({ error: 'Missing oauth_token or oauth_verifier.' });
    }

    // Patch: if oauth_token_secret is provided, use it directly
    let tokenSecret = oauth_token_secret;
    if (!tokenSecret) {
      tokenSecret = discogsRequestTokens[oauth_token];
    }
    if (!tokenSecret) {
      return res.status(400).json({ error: 'Request token secret not found for provided oauth_token. Please POST oauth_token_secret as well.' });
    }

    try {
      // Inline getAccessToken logic to allow passing tokenSecret
      const oauth_nonce = generateNonce();
      const oauth_timestamp = Math.floor(Date.now() / 1000);
      const oauth_signature = `${discogsConsumerSecret}&${tokenSecret}`;
      const authHeader = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${oauth_token}", oauth_signature_method="PLAINTEXT", oauth_signature="${oauth_signature}", oauth_timestamp="${oauth_timestamp}", oauth_nonce="${oauth_nonce}", oauth_verifier="${oauth_verifier}"`;
      const url = 'https://api.discogs.com/oauth/access_token';

      const response = await axios.post(url, null, {
        headers: {
          'Authorization': authHeader,
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      const parsed = querystring.parse(response.data);
      if (!parsed.oauth_token || !parsed.oauth_token_secret) {
        return res.status(500).json({ error: 'Invalid response from Discogs access_token endpoint.' });
      }
      // Return tokens to frontend
      return res.status(200).json({
        accessToken: parsed.oauth_token,
        accessTokenSecret: parsed.oauth_token_secret
      });
    } catch (error) {
      console.error('[Discogs Callback] Error exchanging tokens:', error);
      return res.status(500).json({ error: 'Error during Discogs authentication.' });
    }
  } catch (err) {
    console.error('[Discogs Callback] Handler error:', err);
    res.status(500).json({ error: 'Caught error: ' + err.message });
  }
});

let secretsInitialized = false; // Flag to ensure secrets are initialized

async function initializeSecrets() {
  console.log('Initializing secrets...');
  try {
    await setSecrets();
    secretsInitialized = true;
    console.log('Secrets initialized.');
  } catch (error) {
    console.error('Error during secrets initialization:', error.message || error);
    console.warn('Continuing with default/empty secret values.');
    secretsInitialized = false;
  }
}

// Start server and initialize secrets
server.listen(port, async () => {
  try {
    await initializeSecrets();
    await initializeOAuth();
    if (loadTokens()) {
      console.log('Using existing tokens for authentication.');
    } else {
      console.log('No tokens found. Please visit the sign-in URL to authenticate.');
    }
    console.log(`Server is running on port ${port}`);
  } catch (error) {
    console.error("Failed to initialize server components:", error);
    console.error("Server will continue running with limited functionality.");
    console.log(`Server is running on port ${port} (with initialization errors)`);
  }
});

// Set global agent timeouts for HTTP and HTTPS (e.g., 10 minutes)
http.globalAgent.keepAlive = true;
http.globalAgent.timeout = 10 * 60 * 1000; // 10 minutes
https.globalAgent.keepAlive = true;
https.globalAgent.timeout = 10 * 60 * 1000; // 10 minutes

// Set server timeout (socket idle timeout) to 10 minutes
server.setTimeout(10 * 60 * 1000); // 10 minutes

// For all axios requests, set a default timeout (e.g., 8 minutes)
axios.defaults.timeout = 8 * 60 * 1000; // 8 minutes

// Fetch AWS secret
async function getAwsSecret(secretName) {
  console.log(`\nFetching AWS secret: ${secretName}`);
  try {
    const awsClient = new SecretsManagerClient({ region: "us-west-2" });
    console.log('AWS Secrets Manager client created');

    const command = new GetSecretValueCommand({
      SecretId: secretName,
      VersionStage: "AWSCURRENT", // Explicitly specify the version stage
    });
    console.log('GetSecretValueCommand created');

    const response = await awsClient.send(command);
    console.log('AWS secret retrieved successfully');

    return response.SecretString;
  } catch (error) {
    console.error('\nError getting AWS secret:', error.message);
    throw error;
  }
}

var discogsConsumerKey = '';
var discogsConsumerSecret = '';

async function setSecrets() {
  try {
    const envFilePath = `${__dirname}/.env`;
    var isLocalEnvFile = fs.existsSync(envFilePath);
    console.log('isLocalEnvFile=', isLocalEnvFile);
    if (process.env.NODE_ENV === 'development' && isLocalEnvFile) {
      require('dotenv').config({ path: envFilePath });
      gcpClientId = process.env.GCP_CLIENT_ID || '';
      gcpClientSecret = process.env.GCP_CLIENT_SECRET || '';
      discogsConsumerKey = process.env.DISCOGS_CONSUMER_KEY || '';
      discogsConsumerSecret = process.env.DISCOGS_CONSUMER_SECRET || '';
      console.log('setSecrets() Local environment variables loaded.');
    } else {
      try {
        const youtubeSecrets = await getAwsSecret("youtubeAuth");
        const youtubeSecretsJson = JSON.parse(youtubeSecrets);
        gcpClientId = youtubeSecretsJson.GCP_CLIENT_ID || '';
        gcpClientSecret = youtubeSecretsJson.GCP_CLIENT_SECRET || '';

        const discogsSecrets = await getAwsSecret("discogsAuth");
        const discogsSecretsJson = JSON.parse(discogsSecrets);
        discogsConsumerKey = discogsSecretsJson.DISCOGS_CONSUMER_KEY || '';
        discogsConsumerSecret = discogsSecretsJson.DISCOGS_CONSUMER_SECRET || '';

        console.log('setSecrets() AWS secrets loaded.');
      } catch (awsError) {
        console.warn('setSecrets() Warning: Failed to fetch AWS secrets. Defaulting to empty values.');
        console.warn('AWS Error:', awsError.message || awsError);
        gcpClientId = '';
        gcpClientSecret = '';
        discogsConsumerKey = '';
        discogsConsumerSecret = '';
      }
    }
  } catch (error) {
    console.error("setSecrets() Error setting secrets:", error);
  }
}

async function fetchQuoteData(searchTerm, pageNum = 0) {
  return new Promise(async function (resolve, reject) {
    console.log(`fetchDataFromElasticsearch(${searchTerm})`)
    try {
      const ec2Url = 'http://54.176.113.237:9200/quotes/_search?pretty'; // Replace <your-ec2-public-ip> with your actual EC2 instance public IP

      const requestBody = {
        query: {
          query_string: {
            default_field: "quote",
            query: `"${searchTerm}"`
          }
        },
        from: pageNum * 100, // for pagination
        size: 100
      };

      const response = await fetch(ec2Url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const hits = data.hits.hits;
      const numberHits = data.hits.total.value;
      const currentPage = pageNum + 1;
      const numberPages = Math.ceil(numberHits / 100);

      console.log(`\nReceived ${hits.length} hits out of ${numberHits} total from page ${currentPage}/${numberPages}`);

      resolve({
        hits: hits,
        numberHits: numberHits,
        currentPage: currentPage,
        numberPages: numberPages,
        rawResponse: data
      });

    } catch (error) {
      console.log("fetchDataFromElasticsearch() Error: ", error);
      reject(error);
    }
  });
}

app.get('/algolia/search/:searchPage/:searchTerm', async (req, res) => {
  console.log("🔎 [GET /algolia/search/:searchPage/:searchTerm] Hit", req.params);
  try {
    const { searchPage, searchTerm } = req.params;
    const decodedSearchTerm = decodeURIComponent(searchTerm);
    console.log('/algolia/search searchPage = ', searchPage);
    console.log('/algolia/search searchTerm = ', decodedSearchTerm);
    let searchResults = await fetchQuoteData(decodedSearchTerm, parseInt(searchPage, 10));
    res.send(searchResults);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.post('/emailContactFormSubmission', async (req, res) => {
  console.log("📧 [POST /emailContactFormSubmission] Hit", req.body);
  const { body, email } = req.body;
  console.log('Contact form submission received:');
  console.log('Body:', body);
  console.log('Email:', email);

  try {
    const { SMTPClient } = await import("emailjs");

    const client = new SMTPClient({
      user: 'lknsdmartinsxdcn@gmail.com',
      password: `${gmailAppPassword}`, // Replace with your app password
      host: 'smtp.gmail.com',
      ssl: true,
    });

    const message = await client.sendAsync({
      text: `Body: ${body}\nEmail: ${email}`,
      from: 'lknsdmartinsxdcn@gmail.com',
      to: 'lknsdmartinsxdcn@gmail.com',
      subject: 'Contact Form Submission',
    });

    //console.log('message = ', message);
    res.sendStatus(200);

  } catch (err) {
    //console.error('send email err: ', err);
    res.sendStatus(400);
  }
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// YouTube Auth Stuff Begin
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function initYouTubeOauth2ClientSetup() {
  console.log('initYouTubeOauth2ClientSetup()');
  initializeYouTubeAPI();
  if (loadTokens()) {
    console.log('Using existing tokens for authentication.');
    // Tokens are already loaded, no need to start OAuth flow
  } else {
    console.log('No tokens found. Call startOAuthFlow() to initiate authentication.');
  }
}

function promptForPlaylistId() {
  rl.question('Enter the YouTube playlist ID: ', async (playlistId) => {
    if (!playlistId) {
      console.log('Invalid playlist ID. Please try again.');
      return promptForPlaylistId();
    }

    const youtubeLinks = loadYouTubeLinks();
    if (youtubeLinks.length === 0) {
      console.log('No YouTube links found in the JSON file.');
      rl.close();
      return;
    }

    // Process each video in the JSON file
    for (let video of youtubeLinks) {
      if (!video.added) {
        const success = await addVideoToPlaylist(playlistId, video.url);
        if (success) {
          video.added = true; // Mark as added if successful
          saveYouTubeLinks(youtubeLinks); // Update the JSON file
        }
      } else {
        console.log(`Video ${video.url} already added to the playlist.`);
      }
    }

    rl.close();
  });
}

function loadYouTubeLinks() {
  if (fs.existsSync(LINKS_JSON_PATH)) {
    const data = fs.readFileSync(LINKS_JSON_PATH, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

function saveYouTubeLinks(links) {
  fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify(links, null, 2), 'utf-8');
  console.log('YouTube links saved to', LINKS_JSON_PATH);
}

async function addVideoToPlaylist(playlistId, videoId) {
  try {
    await youtube.playlistItems.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          playlistId: playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: videoId
          }
        }
      }
    });
    console.log(`Video ${videoId} added to playlist successfully!`);
    return true;
  } catch (error) {
    console.error(`Error adding video ${videoId}:`, error.message);
    return false;
  }
}

app.get('/getYtUrl', async function (req, res) {
  console.log("🎥 [GET /getYtUrl] Hit");
  try {
    if (!oauth2Client) {
      throw new Error('OAuth client not initialized');
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
      prompt: 'consent',
      redirect_uri: prodCallback // Use centralized variable
    });

    console.log('\nGenerated auth URL:', authUrl);
    res.status(200).json({ url: authUrl });
  } catch (err) {
    console.error('\nError generating auth URL:', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/getOauth2Client', async function (req, res) {
  console.log("🔑 [GET /getOauth2Client] Hit", req.originalUrl);
  try {
    const authToken = req.originalUrl.substring(req.originalUrl.indexOf('token=') + 'token='.length);
    var userOauth2client = await addTokenToOauth2client(authToken);
    userOauth2client._clientId = "NAH"
    userOauth2client._clientSecret = "NAH"
    res.status(200).json(userOauth2client);
  } catch (err) {
    res.status(400).json({ error: `${err}` });
  }
})

app.post('/submitCallbackCode', async function (req, res) {
  console.log("🔑 [POST /submitCallbackCode] Hit", req.body);
  try {
    const { code } = req.body;
    const userOauth2client = await addTokenToOauth2client(code);
    userOauth2client._clientId = "NAH";
    userOauth2client._clientSecret = "NAH";
    res.status(200).json(userOauth2client);
  } catch (err) {
    res.status(400).json({ error: `${err}` });
  }
});

async function addTokenToOauth2client(authToken) {
  return new Promise(async function (resolve, reject) {
    try {
      var clientoauth2Client = oauth2Client;
      clientoauth2Client.getToken(authToken, function (err, token) {
        if (err) {
          console.log('addTokenToOauth2client() Error trying to retrieve access token', err);
          reject(err);
        }
        clientoauth2Client.credentials = token;
        console.log('\n\n addTokenToOauth2client() done. clientoauth2Client=\n\n', clientoauth2Client, '\n\n')
        resolve(clientoauth2Client);
      })
    } catch (err) {
      console.log('addTokenToOauth2client() err:', err)
    }
  })
}

async function createOauth2Client() {
  return new Promise(async function (resolve, reject) {
    console.log('createOauth2Client()')
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GCP_CLIENT_ID,
        process.env.GCP_CLIENT_SECRET,
        prodCallback // Use centralized variable
      );

      console.log('createOauth2Client() done')
      resolve(oauth2Client);
    } catch (err) {
      console.error('Error creating Oauth2 Client:', err);
      reject(err);
    }
  });
}

async function generateUrl(callbackPort) {
  return new Promise(async function (resolve, reject) {
    try {
      console.log('generateUrl()')
      var redirectUrl = prodCallback;
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
        redirect_uri: redirectUrl
      });

      console.log('generateUrl() Authorize this app by visiting this url: ', authUrl);
      resolve(authUrl)
    } catch (err) {
      throw (`Error generating sign in url: ${err}`)
    }
  })
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// YouTube Auth Stuff End
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.post('/createPlaylist', async (req, res) => {
  console.log("🎵 [POST /createPlaylist] Hit", req.body);
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Playlist name is required.' });
  }

  try {
    const response = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: name,
          description: 'Created via Discogs2Youtube',
        },
        status: {
          privacyStatus: 'private', // Set playlist to private
        },
      },
    });

    console.log('Playlist created:', response.data);
    res.status(200).json({ id: response.data.id, title: response.data.snippet.title });
  } catch (error) {
    console.error('Error creating playlist:', error.message);
    res.status(500).json({ error: 'Failed to create playlist.' });
  }
});

app.post('/addVideoToPlaylist', async (req, res) => {
  console.log("➕ [POST /addVideoToPlaylist] Hit", req.body);
  const { playlistId, videoId } = req.body;

  if (!playlistId || !videoId) {
    return res.status(400).json({ error: 'Playlist ID and Video ID are required.' });
  }

  try {
    const response = await youtube.playlistItems.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          playlistId: playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: videoId,
          },
        },
      },
    });

    console.log('Video added to playlist:', response.data);
    res.status(200).json(response.data); // Return full response
  } catch (error) {
    console.error('Error adding video to playlist:', error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data); // Return error response
    } else {
      res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});

app.get('/ping', (req, res) => {
  console.log("🏓 [GET /ping] Hit");
  res.status(200).send({ message: 'pong' });
});

app.get('/', (req, res) => {
  res.status(200).send('hello world');
});

// Simplify background job object
let backgroundJob = {
  isRunning: false,
  isPaused: false,
  progress: { current: 0, total: 0, uniqueLinks: 0 },
  uniqueLinks: new Set(),
  waitTime: 0,
};

// Keep core endpoints
app.get('/backgroundJobStatus', (req, res) => {
  res.status(200).json({
    progress: backgroundJob.progress,
    error: backgroundJob.error || null,
    waitTime: backgroundJob.waitTime,
    isRunning: backgroundJob.isRunning,
    isPaused: backgroundJob.isPaused
  });
});

app.get('/backgroundJobLinks', (req, res) => {
  res.status(200).json({ links: Array.from(backgroundJob.uniqueLinks) });
});

// Create images directory if it doesn't exist
const IMAGES_DIR = path.join(__dirname, 'discogs_images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  console.log(`Created images directory: ${IMAGES_DIR}`);
}

// Function to download and save image
async function downloadImage(imageUrl, releaseId, imageIndex) {
  try {
    // Create release-specific directory
    const releaseDir = path.join(IMAGES_DIR, releaseId.toString());
    if (!fs.existsSync(releaseDir)) {
      fs.mkdirSync(releaseDir, { recursive: true });
      console.log(`📁 Created release directory: ${releaseDir}`);
    }

    // Extract file extension from URL
    const urlParts = imageUrl.split('.');
    const extension = urlParts[urlParts.length - 1].split('?')[0] || 'jpg';
    const filename = `${releaseId}_${imageIndex}.${extension}`;
    const filepath = path.join(releaseDir, filename);

    // Check if file already exists
    if (fs.existsSync(filepath)) {
      console.log(`🖼️ Image already exists: ${filename}`);
      console.log(`📁 Local filepath: ${filepath}`);
      return filepath;
    }

    console.log(`📥 Downloading image: ${filename} from ${imageUrl}`);

    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`✅ Image saved: ${filename}`);
        console.log(`📁 Local filepath: ${filepath}`);
        resolve(filepath);
      });
      writer.on('error', (error) => {
        console.error(`❌ Error saving image ${filename}:`, error.message);
        reject(error);
      });
    });
  } catch (error) {
    console.error(`❌ Error downloading image from ${imageUrl}:`, error.message);
    return null;
  }
}

app.post('/getDiscogsImgs', async (req, res) => {
  console.log('🖼️ [POST /getDiscogsImgs] Hit', req.body);

  try {
    const { query, enablePagination = true } = req.body; // Add enablePagination flag, default true
    if (!query) {
      throw new Error('Query is required.');
    }

    let labelId = null;

    // Extract label ID from URL or ID
    const labelMatch = query.match(/discogs\.com\/label\/(\d+)/);
    if (labelMatch && labelMatch[1]) {
      labelId = labelMatch[1];
    } else if (/^\d+$/.test(query)) {
      labelId = query; // Assume it's a numeric ID
    }

    if (!labelId) {
      throw new Error('Label ID is required.');
    }

    const labelUrl = `${DISCOGS_API_URL}/labels/${labelId}`;
    console.log(`🔍 [Discogs API Request] Route: /labels, ID: ${labelId}, URL: ${labelUrl}`);

    const labelResponse = await axios.get(labelUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });

    const { releases_url } = labelResponse.data;
    if (!releases_url) {
      throw new Error('Releases URL not found in label data.');
    }

    console.log(`📡 Fetching all releases from URL: ${releases_url}`);

    // If pagination is disabled, return the first request directly with first release details
    if (!enablePagination) {
      console.log('🛠 Pagination disabled. Returning first request in full with first release details.');
      const firstResponse = await axios.get(releases_url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      console.log(`✅ 1/1 Fetched first page with ${firstResponse.data.releases?.length || 0} releases from ${releases_url}`);

      let item_release = null;
      let items_images = {};

      // If there are releases, fetch the first release's detailed info
      if (firstResponse.data.releases && firstResponse.data.releases.length > 0) {
        const firstReleaseId = firstResponse.data.releases[0].id;
        try {
          console.log(`🔍 Fetching first release details for ID: ${firstReleaseId}`);
          const firstReleaseResponse = await axios.get(`${DISCOGS_API_URL}/releases/${firstReleaseId}`, {
            headers: { 'User-Agent': USER_AGENT },
          });
          item_release = firstReleaseResponse.data;

          // Extract images from the first release and download them
          if (item_release.images && item_release.images.length > 0) {
            items_images[firstReleaseId] = [];
            for (let i = 0; i < item_release.images.length; i++) {
              const image = item_release.images[i];
              items_images[firstReleaseId].push(image.resource_url);

              // Download image
              const savedPath = await downloadImage(image.resource_url, firstReleaseId, i);
              if (savedPath) {
                console.log(`🖼️ Image ${i + 1}/${item_release.images.length} processed for release ${firstReleaseId}`);
              }
            }
            console.log(`🖼️ Extracted ${item_release.images.length} images for release ID ${firstReleaseId}`);
          }

          console.log(`✅ Fetched first release info for ID ${firstReleaseId}`);
        } catch (error) {
          console.error(`❌ Failed to fetch first release info for ID ${firstReleaseId}:`, error.message);
        }
      }

      return res.status(200).json({
        paginationSummary: `Fetched first page only (pagination disabled). Total items available: ${firstResponse.data.pagination?.items || 'unknown'}.`,
        releases_info: firstResponse.data, // Return the full response
        item_release: item_release, // Return the first release's detailed info
        items_images: items_images, // Return image URLs for each release
      });
    }

    let url = releases_url;
    let allReleases = [];
    let retryCount = 0;
    let currentPage = 0;
    let totalPages = 0;

    while (url) {
      try {
        const releasesResponse = await axios.get(url, {
          headers: { 'User-Agent': USER_AGENT },
        });

        const { pagination, releases } = releasesResponse.data;
        allReleases = allReleases.concat(releases);
        currentPage = pagination.page;
        totalPages = pagination.pages;

        console.log(`✅ ${currentPage}/${totalPages} Fetched page with ${releases.length} releases from ${url}`);

        url = pagination.urls?.next || null; // Get the next page URL
        retryCount = 0; // Reset retry count on success
      } catch (error) {
        if (error.response?.status === 429) {
          retryCount++;
          const waitTime = Math.pow(2, retryCount) * 1000;
          const logMsg = `⏳ Rate limit hit. Retrying in ${waitTime / 1000} seconds... (attempt ${retryCount})`;
          console.error(logMsg);
          io.emit('progressLog', logMsg); // Send logMsg to frontend
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          console.error('❌ Error fetching releases:', error.message);
          throw error;
        }
      }
    }

    console.log(`✅ Total releases fetched: ${allReleases.length}`);

    // Fetch detailed release info for each release and extract images
    const releases_info = [];
    const items_images = {};
    retryCount = 0; // Reset retry count for detailed release fetching

    for (const release of allReleases) {
      try {
        const releaseResponse = await axios.get(release.resource_url, {
          headers: { 'User-Agent': USER_AGENT },
        });
        releases_info.push(releaseResponse.data);

        // Extract images from this release and download them
        if (releaseResponse.data.images && releaseResponse.data.images.length > 0) {
          items_images[release.id] = [];
          for (let i = 0; i < releaseResponse.data.images.length; i++) {
            const image = releaseResponse.data.images[i];
            items_images[release.id].push(image.resource_url);

            // Download image
            const savedPath = await downloadImage(image.resource_url, release.id, i);
            if (savedPath) {
              console.log(`🖼️ Image ${i + 1}/${releaseResponse.data.images.length} processed for release ${release.id}`);
            }
          }
          console.log(`🖼️ Extracted ${releaseResponse.data.images.length} images for release ID ${release.id}`);
        }

        console.log(`✅ ${releases_info.length}/${allReleases.length} Fetched release info for ${release.resource_url}`);
        retryCount = 0; // Reset retry count on success
      } catch (error) {
        if (error.response?.status === 429) {
          retryCount++;
          const waitTime = Math.pow(2, retryCount) * 1000;
          console.error(`⏳ Rate limit hit while fetching release info for ID ${release.id}. Retrying in ${waitTime / 1000} seconds... (attempt ${retryCount})`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          // Removed retry limit - will keep trying indefinitely
          // Don't increment the loop, retry the same release
          continue;
        } else {
          console.error(`❌ Failed to fetch release info for ID ${release.id}:`, error.message);
        }
      }
    }

    // Prepare response object
    const paginationSummary = `Fetched ${allReleases.length} releases in total.`;

    res.status(200).json({
      paginationSummary,
      releases_info, // Return detailed release info
      items_images, // Return image URLs for each release
    });

  } catch (error) {
    console.error('❌ Error in /getDiscogsImgs:', error.message);
    res.status(500).json({ error: 'Failed to fetch label data or releases from Discogs.' });
  }
});



// ###################################################################################################
// Discogs Auth Test routes:
// ###################################################################################################

// Endpoint to generate and return Discogs auth URL
app.get('/listogs/discogs/getURL', async (req, res) => {
  try {
    const response = await DEBUG_generateDiscogsAuthUrl();
    const { oauth_token } = querystring.parse(response.data);
    const url = `${DISCOGS_AUTHORIZE_URL}?oauth_token=${oauth_token}`;
    res.status(200).json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate Discogs auth URL.' });
  }
});


// Method to fetch and return Discogs sign-in URL to the frontend
function DEBUG_generateDiscogsAuthUrl() {
  const oauthNonce = crypto.randomBytes(16).toString('hex');
  const oauthTimestamp = Math.floor(Date.now() / 1000);
  const callbackUrl = getDiscogsRediurectUrl();
  const authHeader = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_nonce="${oauthNonce}", oauth_signature="${discogsConsumerSecret}&", oauth_signature_method="PLAINTEXT", oauth_timestamp="${oauthTimestamp}", oauth_callback="${callbackUrl}"`;
  return axios.get(DISCOGS_REQUEST_TOKEN_URL, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: authHeader,
      'User-Agent': USER_AGENT,
    },
  });
}

// Endpoint to handle Discogs OAuth callback, parse vars, and redirect to /listogs route
app.get('/listogs/callback/discogs', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.query;
    console.log('[Discogs Callback] oauth_token:', oauth_token, 'oauth_verifier:', oauth_verifier);

    if (!oauth_token || !oauth_verifier) {
      return res.status(400).send('Missing oauth_token or oauth_verifier.');
    }

    // Use isDev for environment
    let redirectBaseURL;
    if (isDev) {
      redirectBaseURL = 'http://localhost:3001/listogs';
    } else {
      redirectBaseURL = 'https://jermasearch.com/listogs';
    }

    const redirectUrl = `${redirectBaseURL}?oauth_token=${encodeURIComponent(oauth_token)}&oauth_verifier=${encodeURIComponent(oauth_verifier)}`;
    res.redirect(redirectUrl);

  } catch (err) {
    console.error('[Discogs Callback] Handler error:', err);
    res.status(500).send('Caught error: ' + err.message);
  }
});


function sendLogMessageToSession(message, socketId) {
  const target = socketId && io.sockets.sockets.get(socketId);
  if (target) {
    target.emit('sessionLog', `${socketId} |${message}`);       // talk straight to that socket
  } else {
    console.warn('[sendLogMessageToSession] No target socket found for socketId:', socketId);
  }
}

function sendResultsToSession(results, socketId) {
  const target = socketId && io.sockets.sockets.get(socketId);
  if (target) {
    target.emit('sessionResults', results);
  } else {
    console.warn('[sendResultsToSession] No target socket found for socketId:', socketId);
  }
}

// Helper to make Discogs API requests, using OAuth if tokens are provided
async function newDiscogsAPIRequest(discogsURL, oauthToken, socketId) {
  const headers = {
    'User-Agent': USER_AGENT
  };

  if (oauthToken) {
    const oauth_nonce = crypto.randomBytes(16).toString('hex');
    const oauth_timestamp = Math.floor(Date.now() / 1000);
    const oauth_signature = `${discogsConsumerSecret}&`;
    headers['Authorization'] =
      `OAuth oauth_consumer_key="${discogsConsumerKey}",` +
      ` oauth_token="${oauthToken}",` +
      ` oauth_signature_method="PLAINTEXT",` +
      ` oauth_signature="${oauth_signature}",` +
      ` oauth_timestamp="${oauth_timestamp}",` +
      ` oauth_nonce="${oauth_nonce}"`;
  }

  let retryCount = 0;
  let rateLimitStart = null;
  let error500Count = 0;
  const max500Retries = 3;

  while (true) {
    try {
      const response = await axios.get(discogsURL, { headers });
      if (rateLimitStart !== null) {
        const seconds = ((Date.now() - rateLimitStart) / 1000).toFixed(1);
        const msg = `✅ Rate limit recovery: ${seconds} seconds since last 429 to first success.`;
        sendLogMessageToSession(msg, socketId);
        console.log(msg);
        if (typeof io !== "undefined") io.emit('progressLog', msg);
        rateLimitStart = null;
      }
      return response.data;
    } catch (err) {
      // Handle 429 (rate limit)
      if (err.response?.status === 429) {
        retryCount++;
        if (rateLimitStart === null) rateLimitStart = Date.now();
        const waitTime = Math.min(1000 * Math.pow(2, retryCount), 32000); // Cap at 32 seconds
        const logMsg = `⏳ Rate limit hit. Attempt ${retryCount}. Waiting ${waitTime / 1000} seconds...`;
        console.warn(logMsg);
        sendLogMessageToSession(logMsg, socketId);

        if (typeof io !== "undefined") io.emit('progressLog', logMsg);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      // Handle 500 (server error)
      if (err.response?.status === 500 && error500Count < max500Retries) {
        error500Count++;
        const waitTime = 1000 * error500Count; // Linear backoff for 500s
        const logMsg = `⏳ Discogs 500 error. Retry ${error500Count}/${max500Retries}. Waiting ${waitTime / 1000} seconds...`;
        console.warn(logMsg);
        sendLogMessageToSession(logMsg, socketId);
        if (typeof io !== "undefined") io.emit('progressLog', logMsg);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      sendLogMessageToSession(`Discogs API error: ${err.response?.data?.message || err.message}`, socketId);
      throw new Error(`Discogs API error: ${err.response?.data?.message || err.message}`);
    }
  }
}

async function getAllDiscogsArtistReleases(artistId, oauthToken, oauthVerifier, socketId) {
  try {
    console.log(`[getAllDiscogsArtistReleases] Start: artistId=${artistId}, oauthToken=${oauthToken ? '[provided]' : '[none]'}, oauthVerifier=${oauthVerifier ? '[provided]' : '[none]'}`);
    let allReleases = [];
    let url = `${DISCOGS_API_URL}/artists/${artistId}/releases`;
    let retryCount = 0;

    try {
      console.log(`[getAllDiscogsArtistReleases] Fetching: ${url}`);
      const response = await newDiscogsAPIRequest(url, oauthToken, socketId);

      if (response && response.releases) {
        console.log(`[getAllDiscogsArtistReleases] Fetched ${response.releases.length} releases from current page.`);
        allReleases = allReleases.concat(response.releases);
      } else {
        console.log(`[getAllDiscogsArtistReleases] No releases found in response.`);
      }

      url = response.pagination?.urls?.next || null;
      if (url) {
        console.log(`[getAllDiscogsArtistReleases] Next page URL: ${url}`);
      } else {
        console.log(`[getAllDiscogsArtistReleases] No more pages.`);
      }
      retryCount = 0;
    } catch (error) {
      console.error(`[getAllDiscogsArtistReleases] Error: ${error.message}`);
      throw error;
    }
    console.log(`[getAllDiscogsArtistReleases] Done. Total releases fetched: ${allReleases.length}`);
    return allReleases;
  } catch (err) {
    console.error('[getAllDiscogsArtistReleases] error:', err.message);
    return [];
  }
}

// Fetch all videos for a Discogs artist's releases, make requests using oauthToken, and send updates to the frontend via socketId
async function getAllReleaseVideos(artistReleases, oauthToken, socketId) {

  // Map all videos by releaseId and videoId 
  const allVideos = {};
  let addedCount = 0;

  // Process releases sequentially, not in parallel
  for (const release of artistReleases) {
    sendLogMessageToSession(`${artistReleases.indexOf(release) + 1}/${artistReleases.length} Fetching videos for release ${release.main_release || release.id})`, socketId);

    try {
      // get release ID
      const releaseId = release.main_release || release.id;
      if (!releaseId) continue;

      // get release URL and data
      const releaseUrl = `${DISCOGS_API_URL}/releases/${releaseId}`;
      const releaseData = await newDiscogsAPIRequest(releaseUrl, oauthToken, socketId);

      // If release has videos, process them
      if (releaseData && Array.isArray(releaseData.videos) && releaseData.videos.length > 0) {

        // If releaseId is not already in allVideos, create it
        if (!allVideos[releaseId]) {
          allVideos[releaseId] = {};
        }

        // Loop through each video in the release
        for (const video of releaseData.videos) {
          // Extract videoId from the video URI
          const videoId = video.uri.split("v=")[1];

          // Only add if this videoId is not already present for this release
          if (!allVideos[releaseId][videoId]) {
            allVideos[releaseId][videoId] = {
              releaseId,
              releaseTitle: releaseData.title,
              artist: releaseData.artists_sort || (releaseData.artists && releaseData.artists[0]?.name) || '',
              year: releaseData.year || '',
              discogsUrl: releaseData.uri || `https://www.discogs.com/release/${releaseId}`,
              videoId,
              fullUrl: video.uri,
              title: video.title,
            };
            addedCount++;
          }
        }

        sendLogMessageToSession(`[getAllReleaseVideos] Found ${addedCount} new videos for ${releaseId}`, socketId);
      } else {
        sendLogMessageToSession(`[getAllReleaseVideos] Found 0 videos for ${releaseId}`, socketId);
      }

    } catch (err) {
      console.error(`[getAllReleaseVideos] Error fetching release ${release.id}: ${err}`);
      sendLogMessageToSession(`Error fetching release ${release.id}: ${err.message}`, socketId);
      throw err;
    }
  }
  // Add total addedCount of videos to allVideos object
  allVideos['totalVideoCount'] = addedCount
  return allVideos;
}



function sendLogMessageToSession(message, socketId) {
  const target = socketId && io.sockets.sockets.get(socketId);
  if (target) {
    target.emit('sessionLog', `${socketId} |${message}`);       // talk straight to that socket
  } else {
    sessionLog(req, message);                 // fall back to whole session
  }
}

async function getAllArtistReleaseVideos(discogsId, oauthToken, oauthVerifier, socketId) {
  let artistReleases = [];
  try {
    artistReleases = await getAllDiscogsArtistReleases(artistId = discogsId, oauthToken, oauthVerifier, socketId);
    sendLogMessageToSession(`[discogs/api] getAllDiscogsArtistReleases returned ${Array.isArray(artistReleases) ? artistReleases.length : 'unknown'} releases`, socketId);
  } catch (error) {
    sendLogMessageToSession(`[discogs/api] Error fetching artist releases: ${error.message}`, socketId);
    return res.status(500).json({ error: error.message });
  }

  let artistVideos = [];
  try {
    artistVideos = await getAllReleaseVideos(artistReleases, oauthToken, socketId);
    sendLogMessageToSession(`[discogs/api] Fetched artist videos: ${artistVideos['totalVideoCount']} videos`, socketId);
  } catch (error) {
    sendLogMessageToSession(`[discogs/api] Error fetching artist videos: ${error.message}`, socketId);
  }
  sendResultsToSession(artistVideos, socketId);
}


// Endpoint that receives discogs api request (requestId and auth info) from the frontend and returns results
app.post('/discogs/api', async (req, res) => {
  console.log("[POST /discogs/api] Hit: ", req.body);
  const { discogsType, discogsId, oauthToken, oauthVerifier, socketId } = req.body;
  console.log(`[discogs/api] discogsType=${discogsType}, discogsId=${discogsId}, oauthToken=${oauthToken}, oauthVerifier=${oauthVerifier}, socketId=${socketId}`);

  try {
    sendLogMessageToSession(`[discogs/api] Calling getAllDiscogsArtistReleases with artistId=${discogsId}`, socketId);

    getAllArtistReleaseVideos(discogsId, oauthToken, oauthVerifier, socketId);

    res.status(200).json({ status: 'Processing started' });

  } catch (err) {

    sendLogMessageToSession(`[discogs/api] Error: ${err.message}`, socketId);
    res.status(500).json({ error: err.message });
  }
});
