// When running locally, make sure to set 'NODE_ENV=development' in the .env file

require('dotenv').config();

// Helper function for development-only logging
const devLog = (...args) => {
  if (isDev) {
    console.log(...args);
  }
};
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
const { Vibrant } = require('node-vibrant/node');
const JSZip = require('jszip');

// --- Determine if we are in dev or production environment ---
var isDev = process.env.NODE_ENV === 'development' ? true : false;

// Enhanced logging configuration for production
const logLevel = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

// Custom logger function for consistent logging
const logger = {
  info: (...args) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO]`, ...args);
  },
  error: (...args) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR]`, ...args);
  },
  warn: (...args) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN]`, ...args);
  },
  debug: (...args) => {
    if (logLevel === 'debug' || isDev) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [DEBUG]`, ...args);
    }
  }
};

// Log startup information
logger.info('🚀 Server starting...');
logger.info(`Environment: ${isDev ? 'development' : 'production'}`);
logger.info(`Log Level: ${logLevel}`);
logger.info(`Node Version: ${process.version}`);
logger.info(`Platform: ${process.platform}`);
logger.info(`Memory Usage: ${JSON.stringify(process.memoryUsage())}`);
/*
Difference between dev and prod:
  In dev we can access api route directly on port 3030 such as 'http://localhost:3030/listogs/discogs/getURL'
  In prod we access the api route through the main domain but with '/internal-api/' such as 'https://martinbarker.me/internal-api/listogs/discogs/getURL'
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
    domain: process.env.NODE_ENV === 'production' ? '.martinbarker.me' : undefined, // Set domain for prod
  }
});
app.use(sessionMiddleware);

// Define allowed origins for both local and production
const allowedOrigins = [
  'http://localhost:3030',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://martinbarker.me',
  'https://www.martinbarker.me'
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
// Track active API jobs by socketId to allow cancellation on disconnect
const activeJobs = new Map();
// Track disconnected sockets to avoid spam logging
const disconnectedSockets = new Set();
// Track rate-limit retry state per socket for exponential backoff
const socketRateLimitState = new Map();

// Helper function to check if socket is still connected
function isSocketConnected(socketId) {
  if (!socketId) return false;
  const target = io.sockets.sockets.get(socketId);
  return target && target.connected;
}

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
  socket.emit('sessionLog', `✅ Ready `);

  if (sessionID) {
    if (!sessionSocketMap.has(sessionID)) sessionSocketMap.set(sessionID, new Set());
    sessionSocketMap.get(sessionID).add(socket);
  }
  console.log('[Socket.IO] connect  id=%s  sid=%s', socket.id, sessionID);

  socket.on('disconnect', () => {
    // Cancel any active jobs for this socket
    if (activeJobs.has(socket.id)) {
      const job = activeJobs.get(socket.id);
      if (job && job.cancel) {
        job.cancel();
        console.log(`[Socket.IO] Cancelled active job for socket ${socket.id}`);
      }
      activeJobs.delete(socket.id);
    }
    
    // Mark socket as disconnected to avoid spam logging
    disconnectedSockets.add(socket.id);
    
    if (sessionID && sessionSocketMap.has(sessionID)) {
      const set = sessionSocketMap.get(sessionID);
      set.delete(socket);
      if (set.size === 0) sessionSocketMap.delete(sessionID);
    }
    console.log('[Socket.IO] disconnect id=%s sid=%s', socket.id, sessionID);
  });
});
// --- Socket.IO connection logic end---

// Clean up disconnectedSockets set periodically to prevent memory leaks
setInterval(() => {
  // Keep only the last 100 disconnected socket IDs to prevent memory leaks
  if (disconnectedSockets.size > 100) {
    const socketIds = Array.from(disconnectedSockets);
    disconnectedSockets.clear();
    // Keep only the most recent 50
    socketIds.slice(-50).forEach(id => disconnectedSockets.add(id));
  }
}, 60000); // Clean up every minute

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
  return 'https://martinbarker.me/internal-api/listogs/youtube/callback'; // Updated production redirect URL
}

// Function to determine the YouTube redirect URL based on the environment
function getYouTubeRedirectUrl() {
  if (isDev) {
    return 'http://localhost:3030/youtube/callback';
  }
  return 'https://martinbarker.me/internal-api/youtube/callback';
}

function getDiscogsRediurectUrl() {
  if (isDev) {
    return 'http://localhost:3030/listogs/callback/discogs';
  }
  return 'https://martinbarker.me/internal-api/listogs/callback/discogs';
}

function getDiscogsFrontendRedirectUrl() {
  if (isDev) {
    return 'http://localhost:3001/listogs?discogsAuth=success';
  }
  return 'https://martinbarker.me/listogs?discogsAuth=success';
}

// Centralized function to initialize the OAuth2 client
function initializeOAuthClient(clientId, clientSecret) {
  const redirectUri = getRedirectUrl();
  console.log('youtube redirectUri = ', redirectUri);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Centralized function to initialize the YouTube OAuth2 client
function initializeYouTubeOAuthClient(clientId, clientSecret) {
  const redirectUri = getYouTubeRedirectUrl();
  console.log('YouTube redirectUri = ', redirectUri);
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
  console.log('gcpClientId:', gcpClientId ? 'SET' : 'NOT SET');
  console.log('gcpClientSecret:', gcpClientSecret ? 'SET' : 'NOT SET');
  oauth2Client = initializeYouTubeOAuthClient(gcpClientId, gcpClientSecret);
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
  logger.info("🔑 [GET /oauth2callback] Hit:", req.originalUrl);
  logger.info('Full URL received:', req.protocol + '://' + req.get('host') + req.originalUrl);

  const { code } = req.query;
  if (code) {
    oauth2Client.getToken(code, (err, tokens) => {
      if (err) {
        logger.error('Error getting tokens:', err.message);
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

app.post('/listogs/stop', (req, res) => {
  try {
    const { socketId } = req.body || {};

    if (!socketId) {
      return res.status(400).json({ error: 'socketId is required' });
    }

    const job = activeJobs.get(socketId);
    if (job && job.cancel) {
      try {
        job.cancel();
      } catch (err) {
        logger.warn(`[Stop Job] Error while cancelling job for socket ${socketId}:`, err.message);
      }
      activeJobs.delete(socketId);
      sendLogMessageToSession('🛑 Job cancelled by user.', socketId);
      sendStatusToSession({
        task: job.type || 'discogs',
        status: 'Stopped by user',
        progress: null
      }, socketId);
      return res.json({ stopped: true });
    }

    return res.json({ stopped: false, message: 'No active job for this socket.' });
  } catch (err) {
    logger.error('[Stop Job] Unexpected error:', err);
    return res.status(500).json({ error: 'Failed to stop job.' });
  }
});

// Endpoint to get authentication status
app.get('/authStatus', (req, res) => {
  logger.info("🔍 [GET /authStatus] Hit");
  logger.debug('Auth status:', authStatus);
  res.status(200).json(authStatus);
});

// Handle YouTube OAuth2 callback
app.get('/listogs/youtube/callback', async (req, res) => {
  logger.info("📺 [GET /listogs/youtube/callback] Hit:", req.originalUrl);

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
    const redirectUrl = isDev ? 'http://localhost:3001/listogs' : 'https://martinbarker.me/listogs';
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Error during YouTube authentication:', error.message);
    res.status(500).send('Authentication failed.');
  }
});

// Route to handle the production callback URL
app.get('/youtube/callback', (req, res) => {
  console.log("📺 [GET /youtube/callback] Hit:", req.originalUrl);

  const { code, scope } = req.query;
  if (code) {
    // Redirect to frontend with query parameters (like Discogs does)
    const redirectUrl = isDev 
      ? `http://localhost:3001/youtube?code=${encodeURIComponent(code)}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`
      : `https://martinbarker.me/youtube?code=${encodeURIComponent(code)}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`;
    
    console.log('Redirecting to frontend:', redirectUrl);
    res.redirect(redirectUrl);
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
    logger.error('Error generating sign-in URL:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Route to handle Discogs search
app.post('/discogsAuth', async (req, res) => {
  logger.info("🎶 [POST /discogsAuth] Hit", req.body);
  const { query } = req.body;

  if (!query) {
    logger.error("❌ No query provided in the request body.");
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
    logger.debug(`🔍 [fetchDiscogsData] Starting fetch for type=${type}, id=${id}`);
    
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
      const errorMsg = `Invalid type provided: ${type}. Valid types are: label, artist, list, release, master`;
      logger.error(`❌ [fetchDiscogsData] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    logger.debug(`🌐 [fetchDiscogsData] Making request to URL: ${url}`);
    logger.debug(`📋 [fetchDiscogsData] Request headers:`, { 'User-Agent': USER_AGENT });
    
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 30000, // 30 second timeout
    });

    logger.debug(`📊 [fetchDiscogsData] Response status: ${response.status}`);
    logger.debug(`📊 [fetchDiscogsData] Response headers:`, response.headers);
    logger.debug(`📊 [fetchDiscogsData] Response data keys:`, Object.keys(response.data || {}));

    // For release/master, return full JSON
    if (type === 'release' || type === 'master') {
      logger.debug(`✅ [fetchDiscogsData] Returning full data for ${type}`);
      return response.data;
    }
    
    // Return only the first item from the response for other types
    if (response.data.releases && response.data.releases.length > 0) {
      logger.debug(`✅ [fetchDiscogsData] Found ${response.data.releases.length} releases, returning first one`);
      return response.data.releases[0];
    } else if (response.data.items && response.data.items.length > 0) {
      logger.debug(`✅ [fetchDiscogsData] Found ${response.data.items.length} items, returning first one`);
      return response.data.items[0];
    } else {
      logger.warn(`⚠️ [fetchDiscogsData] No items found in response`);
      return { message: 'No items found.' };
    }
  } catch (error) {
    logger.error(`❌ [fetchDiscogsData] Detailed error information:`);
    logger.error(`   - Error type: ${error.constructor.name}`);
    logger.error(`   - Error message: ${error.message}`);
    logger.error(`   - Error code: ${error.code || 'N/A'}`);
    logger.error(`   - Error status: ${error.response?.status || 'N/A'}`);
    logger.error(`   - Error statusText: ${error.response?.statusText || 'N/A'}`);
    logger.error(`   - Request URL: ${error.config?.url || 'N/A'}`);
    logger.error(`   - Request method: ${error.config?.method || 'N/A'}`);
    logger.error(`   - Request headers:`, error.config?.headers || 'N/A');
    logger.error(`   - Response data:`, error.response?.data || 'N/A');
    logger.error(`   - Stack trace:`, error.stack);
    
    // Create a more detailed error message
    let detailedMessage = `Failed to fetch Discogs data for ${type}/${id}`;
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      detailedMessage += ` - Network connection failed. Check internet connectivity and Discogs API availability.`;
    } else if (error.code === 'ETIMEDOUT') {
      detailedMessage += ` - Request timed out after 30 seconds. Discogs API may be slow or unavailable.`;
    } else if (error.response?.status === 401) {
      detailedMessage += ` - Authentication failed. Check Discogs API credentials.`;
    } else if (error.response?.status === 403) {
      detailedMessage += ` - Access forbidden. Check Discogs API permissions.`;
    } else if (error.response?.status === 404) {
      detailedMessage += ` - Resource not found. The ${type} with ID ${id} may not exist.`;
    } else if (error.response?.status === 429) {
      detailedMessage += ` - Rate limit exceeded. Too many requests to Discogs API.`;
    } else if (error.response?.status >= 500) {
      detailedMessage += ` - Discogs API server error (${error.response.status}). Try again later.`;
    } else if (error.response?.status >= 400) {
      detailedMessage += ` - Client error (${error.response.status}). Check request parameters.`;
    } else {
      detailedMessage += ` - ${error.message}`;
    }
    
    const enhancedError = new Error(detailedMessage);
    enhancedError.originalError = error;
    enhancedError.type = type;
    enhancedError.id = id;
    enhancedError.url = error.config?.url;
    enhancedError.statusCode = error.response?.status;
    
    throw enhancedError;
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

// Helper function to extract release type from Discogs formats
function extractReleaseType(releaseData) {
  let releaseType = '';
  if (releaseData.formats && releaseData.formats.length > 0) {
    const format = releaseData.formats[0];
    if (format.descriptions && format.descriptions.length > 0) {
      // Check for common release types in descriptions
      const descriptions = format.descriptions.join(' ').toLowerCase();
      
      // Look for specific release types (case insensitive)
      if (descriptions.includes('album')) {
        releaseType = 'Album';
      } else if (descriptions.includes('single')) {
        releaseType = 'Single';
      } else if (descriptions.includes('ep')) {
        releaseType = 'EP';
      } else if (descriptions.includes('lp')) {
        releaseType = 'Album'; // LP is typically an album
      } else if (descriptions.includes('compilation')) {
        releaseType = 'Compilation';
      } else if (descriptions.includes('mixtape')) {
        releaseType = 'Mixtape';
      } else {
        // If no specific type found, use the first non-format description
        // Skip technical formats like MP3, FLAC, WAV, CD, Vinyl, etc.
        const technicalFormats = ['mp3', 'flac', 'wav', 'aac', 'ogg', 'wma', 'm4a', 'cd', 'vinyl', 'cassette', '7"', '12"', '10"', 'file', 'digital', 'download', 'streaming'];
        for (const desc of format.descriptions) {
          if (!technicalFormats.includes(desc.toLowerCase())) {
            releaseType = desc;
            break;
          }
        }
        
        // If still no type found, use format name as fallback
        if (!releaseType) {
          releaseType = format.name || '';
        }
      }
    } else {
      releaseType = format.name || '';
    }
  }
  return releaseType;
}

function extractLabelsAndCompanies(releaseData) {
  const labels = Array.isArray(releaseData.labels)
    ? releaseData.labels
        .map((label) => (typeof label === 'string' ? label : label?.name))
        .filter((name) => typeof name === 'string' && name.trim().length > 0)
        .map((name) => name.trim())
    : [];

  const companies = Array.isArray(releaseData.companies)
    ? releaseData.companies
        .map((company) => (typeof company === 'string' ? company : company?.name))
        .filter((name) => typeof name === 'string' && name.trim().length > 0)
        .map((name) => name.trim())
    : [];

  const combined = [...labels, ...companies];
  return Array.from(new Set(combined));
}

function sanitizeForFilename(name, fallback = 'file') {
  if (!name || typeof name !== 'string') {
    return fallback;
  }
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, 120);
  return sanitized || fallback;
}

function getExtensionFromContentType(contentType, fallbackUri = '') {
  if (contentType) {
    const map = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg'
    };
    const normalized = contentType.split(';')[0].trim().toLowerCase();
    if (map[normalized]) {
      return map[normalized];
    }
  }

  if (fallbackUri) {
    try {
      const parsed = new URL(fallbackUri);
      const ext = path.extname(parsed.pathname).replace('.', '');
      if (ext) {
        return ext.toLowerCase();
      }
    } catch (err) {
      // Ignore URL parsing errors
    }
  }

  return 'jpg';
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

    // Extract release type from formats
    const releaseType = extractReleaseType(response.data);

    const labelsAndCompanies = extractLabelsAndCompanies(response.data);
    const country = response.data.country || '';
    const genres = Array.isArray(response.data.genres) ? response.data.genres : [];
    const styles = Array.isArray(response.data.styles) ? response.data.styles : [];
    const masterId = typeof response.data.master_id === 'number' ? response.data.master_id : (response.data.master_id || null);
    const isMasterRelease = !response.data.master_id;

    const videos = response.data.videos?.map((video) => ({
      videoId: video.uri.split("v=")[1],
      fullUrl: video.uri, // Include full YouTube URL
      artist,
      releaseName: title,
      releaseId: releaseId,
      year,
      releaseType: releaseType,
      labelsAndCompanies,
      country,
      genres,
      styles,
      masterId,
      isMasterRelease,
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
  const requestId = Math.random().toString(36).substr(2, 9);
  logger.info(`📡 [POST /discogsFetch] Request ${requestId} started`, {
    body: req.body,
    headers: req.headers,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  const { type, id } = req.body;

  // Validate input parameters
  if (!type || !id) {
    const errorMsg = `Missing required parameters. Received: type=${type}, id=${id}`;
    logger.error(`❌ [POST /discogsFetch] Request ${requestId} - ${errorMsg}`);
    return res.status(400).json({ 
      error: 'Type and ID are required.',
      details: errorMsg,
      requestId,
      received: { type, id }
    });
  }

  // Validate type parameter
  const validTypes = ['label', 'artist', 'list', 'release', 'master'];
  if (!validTypes.includes(type)) {
    const errorMsg = `Invalid type '${type}'. Valid types are: ${validTypes.join(', ')}`;
    logger.error(`❌ [POST /discogsFetch] Request ${requestId} - ${errorMsg}`);
    return res.status(400).json({ 
      error: 'Invalid type parameter.',
      details: errorMsg,
      requestId,
      validTypes
    });
  }

  // Check if secrets are initialized
  if (!secretsInitialized) {
    const errorMsg = 'Server secrets not initialized. AWS secrets may not be loaded.';
    logger.error(`❌ [POST /discogsFetch] Request ${requestId} - ${errorMsg}`);
    logger.error(`   - secretsInitialized: ${secretsInitialized}`);
    logger.error(`   - secretsLastRefresh: ${secretsLastRefresh}`);
    return res.status(503).json({ 
      error: 'Server not ready. Secrets not initialized.',
      details: errorMsg,
      requestId,
      secretsStatus: {
        initialized: secretsInitialized,
        lastRefresh: secretsLastRefresh
      }
    });
  }

  // Check if Discogs credentials are available
  if (!discogsConsumerKey || !discogsConsumerSecret) {
    const errorMsg = 'Discogs API credentials not available. Check AWS Secrets Manager configuration.';
    logger.error(`❌ [POST /discogsFetch] Request ${requestId} - ${errorMsg}`);
    logger.error(`   - discogsConsumerKey exists: ${!!discogsConsumerKey}`);
    logger.error(`   - discogsConsumerSecret exists: ${!!discogsConsumerSecret}`);
    logger.error(`   - discogsConsumerKey length: ${discogsConsumerKey?.length || 0}`);
    logger.error(`   - discogsConsumerSecret length: ${discogsConsumerSecret?.length || 0}`);
    return res.status(500).json({ 
      error: 'Discogs credentials not configured.',
      details: errorMsg,
      requestId,
      credentialsStatus: {
        hasKey: !!discogsConsumerKey,
        hasSecret: !!discogsConsumerSecret,
        keyLength: discogsConsumerKey?.length || 0,
        secretLength: discogsConsumerSecret?.length || 0
      }
    });
  }

  try {
    logger.info(`🔍 [POST /discogsFetch] Request ${requestId} - Starting fetchDiscogsData for type=${type}, id=${id}`);
    logger.debug(`📋 [POST /discogsFetch] Request ${requestId} - Environment:`, {
      NODE_ENV: process.env.NODE_ENV,
      DISCOGS_API_URL: DISCOGS_API_URL,
      USER_AGENT: USER_AGENT
    });
    
    const startTime = Date.now();
    const data = await fetchDiscogsData(type, id);
    const duration = Date.now() - startTime;
    
    logger.info(`✅ [POST /discogsFetch] Request ${requestId} - Success in ${duration}ms`);
    
    // Log response summary
    if (data && data.id) {
      logger.info(`📊 [POST /discogsFetch] Request ${requestId} - Response summary:`, {
        type,
        id,
        responseId: data.id,
        responseType: typeof data,
        hasTracklist: !!(data.tracklist && data.tracklist.length > 0),
        trackCount: data.tracklist?.length || 0,
        duration: `${duration}ms`
      });
    } else if (data && data.message) {
      logger.info(`📊 [POST /discogsFetch] Request ${requestId} - Response message:`, {
        type,
        id,
        message: data.message,
        duration: `${duration}ms`
      });
    } else {
      logger.info(`📊 [POST /discogsFetch] Request ${requestId} - Response received:`, {
        type,
        id,
        responseType: typeof data,
        duration: `${duration}ms`
      });
    }
    
    res.status(200).json(data);
  } catch (error) {
    const duration = Date.now() - Date.now(); // This will be 0, but shows the pattern
    
    logger.error(`❌ [POST /discogsFetch] Request ${requestId} - Detailed error information:`);
    logger.error(`   - Request parameters: type=${type}, id=${id}`);
    logger.error(`   - Error type: ${error.constructor.name}`);
    logger.error(`   - Error message: ${error.message}`);
    logger.error(`   - Error code: ${error.code || 'N/A'}`);
    logger.error(`   - Error status: ${error.statusCode || error.response?.status || 'N/A'}`);
    logger.error(`   - Request URL: ${error.url || error.config?.url || 'N/A'}`);
    logger.error(`   - Stack trace:`, error.stack);
    logger.error(`   - Original error:`, error.originalError?.message || 'N/A');
    
    // Create comprehensive error response
    const errorResponse = {
      error: 'Failed to fetch data from Discogs.',
      details: error.message,
      requestId,
      request: { type, id },
      errorInfo: {
        type: error.constructor.name,
        code: error.code || null,
        statusCode: error.statusCode || error.response?.status || null,
        url: error.url || error.config?.url || null,
        originalMessage: error.originalError?.message || null
      },
      timestamp: new Date().toISOString(),
      serverInfo: {
        nodeEnv: process.env.NODE_ENV,
        secretsInitialized,
        hasDiscogsCredentials: !!(discogsConsumerKey && discogsConsumerSecret)
      }
    };
    
    res.status(500).json(errorResponse);
  }
});

// DEBUG_generateDiscogsAuthUrl: returns the Discogs auth URL (no session logic, just for debug)
async function DEBUG_generateDiscogsAuthUrl() {
  try {
    // Get fresh OAuth tokens
    const tokens = await getDiscogsOAuthTokens();
    
    // Generate auth URL using the fresh tokens
    const url = `${DISCOGS_AUTHORIZE_URL}?oauth_token=${tokens.accessToken}`;
    console.log('✅ Generated fresh Discogs auth URL');
    return { data: `oauth_token=${tokens.accessToken}&oauth_token_secret=${tokens.accessTokenSecret}` };
  } catch (error) {
    console.error('❌ Failed to generate Discogs auth URL:', error.message || error);
    throw error;
  }
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

// Discogs OAuth token management
let discogsOAuthTokens = {
  accessToken: null,
  accessTokenSecret: null,
  expiresAt: null,
  refreshInterval: null
};

// Discogs OAuth token auto-refresh mechanism
function startDiscogsTokenAutoRefresh() {
  const REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes (tokens typically last 1 hour)
  
  console.log('🔄 Starting Discogs OAuth token auto-refresh every 45 minutes...');
  
  discogsOAuthTokens.refreshInterval = setInterval(async () => {
    console.log('🔄 Auto-refreshing Discogs OAuth tokens...');
    try {
      await refreshDiscogsOAuthTokens();
      console.log('✅ Discogs OAuth tokens auto-refreshed successfully');
    } catch (error) {
      console.error('❌ Failed to auto-refresh Discogs OAuth tokens:', error.message || error);
    }
  }, REFRESH_INTERVAL_MS);
}

// Refresh Discogs OAuth tokens by generating new ones
async function refreshDiscogsOAuthTokens() {
  try {
    console.log('🔄 Refreshing Discogs OAuth tokens...');
    
    // Generate new OAuth tokens
    const oauthNonce = generateNonce();
    const oauthTimestamp = Math.floor(Date.now() / 1000);
    const callbackUrl = getDiscogsRediurectUrl();
    
    const authHeader = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_nonce="${oauthNonce}", oauth_signature="${discogsConsumerSecret}&", oauth_signature_method="PLAINTEXT", oauth_timestamp="${oauthTimestamp}", oauth_callback="${callbackUrl}"`;
    
    const response = await axios.get(DISCOGS_REQUEST_TOKEN_URL, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
        'User-Agent': USER_AGENT,
      },
    });
    
    const { oauth_token, oauth_token_secret } = querystring.parse(response.data);
    
    // Store new tokens
    discogsOAuthTokens.accessToken = oauth_token;
    discogsOAuthTokens.accessTokenSecret = oauth_token_secret;
    discogsOAuthTokens.expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    
    // Store in request tokens mapping for callback handling
    discogsRequestTokens[oauth_token] = oauth_token_secret;
    
    console.log('✅ Discogs OAuth tokens refreshed successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to refresh Discogs OAuth tokens:', error.message || error);
    return false;
  }
}

// Check if Discogs OAuth tokens are valid and not expired
function areDiscogsTokensValid() {
  if (!discogsOAuthTokens.accessToken || !discogsOAuthTokens.accessTokenSecret) {
    return false;
  }
  
  if (discogsOAuthTokens.expiresAt && new Date() > discogsOAuthTokens.expiresAt) {
    console.log('⚠️ Discogs OAuth tokens have expired');
    return false;
  }
  
  return true;
}

// Get current Discogs OAuth tokens, refreshing if needed
async function getDiscogsOAuthTokens() {
  if (!areDiscogsTokensValid()) {
    console.log('🔄 Discogs OAuth tokens invalid or expired, refreshing...');
    await refreshDiscogsOAuthTokens();
  }
  
  return {
    accessToken: discogsOAuthTokens.accessToken,
    accessTokenSecret: discogsOAuthTokens.accessTokenSecret
  };
}

// Stop Discogs token auto-refresh
function stopDiscogsTokenAutoRefresh() {
  if (discogsOAuthTokens.refreshInterval) {
    clearInterval(discogsOAuthTokens.refreshInterval);
    discogsOAuthTokens.refreshInterval = null;
    console.log('🛑 Discogs OAuth token auto-refresh stopped');
  }
}

// Middleware to ensure secrets are initialized before handling requests
async function ensureSecretsInitialized(req, res, next) {
  if (!secretsInitialized) {
    console.log('🔄 Secrets not initialized, attempting refresh...');
    const refreshSuccess = await refreshSecrets();
    if (!refreshSuccess) {
      return res.status(503).json({ error: 'Secrets are not initialized yet. Please try again later.' });
    }
  }
  
  // Check if secrets are stale (older than 1 hour) and refresh if needed
  if (secretsLastRefreshed && (Date.now() - secretsLastRefreshed.getTime()) > 60 * 60 * 1000) {
    console.log('🔄 Secrets are stale, refreshing...');
    await refreshSecrets();
  }
  
  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    secretsInitialized: secretsInitialized,
    secretsLastRefreshed: secretsLastRefreshed ? secretsLastRefreshed.toISOString() : null,
    secretsAgeMinutes: secretsLastRefreshed ? Math.round((Date.now() - secretsLastRefreshed.getTime()) / (1000 * 60)) : null,
    discogsConfigured: !!(discogsConsumerKey && discogsConsumerSecret),
    discogsTokensValid: areDiscogsTokensValid(),
    discogsTokensExpiresAt: discogsOAuthTokens.expiresAt ? discogsOAuthTokens.expiresAt.toISOString() : null,
    discogsTokensAgeMinutes: discogsOAuthTokens.expiresAt ? Math.round((discogsOAuthTokens.expiresAt.getTime() - Date.now()) / (1000 * 60)) : null,
    youtubeConfigured: !!(gcpClientId && gcpClientSecret),
    environment: process.env.NODE_ENV || 'unknown',
    discogsTokenRefreshActive: !!discogsOAuthTokens.refreshInterval
  };
  
  console.log('🏥 [GET /health] Health check:', health);
  
  if (!secretsInitialized) {
    return res.status(503).json({ ...health, status: 'not_ready' });
  }
  
  res.status(200).json(health);
});

// Discogs configuration check endpoint
app.get('/discogs/config', (req, res) => {
  const config = {
    secretsInitialized: secretsInitialized,
    hasConsumerKey: !!discogsConsumerKey,
    hasConsumerSecret: !!discogsConsumerSecret,
    consumerKeyLength: discogsConsumerKey ? discogsConsumerKey.length : 0,
    consumerSecretLength: discogsConsumerSecret ? discogsConsumerSecret.length : 0,
    environment: process.env.NODE_ENV || 'unknown',
    secretsLastRefreshed: secretsLastRefreshed ? secretsLastRefreshed.toISOString() : null,
    secretsAgeMinutes: secretsLastRefreshed ? Math.round((Date.now() - secretsLastRefreshed.getTime()) / (1000 * 60)) : null,
    timestamp: new Date().toISOString()
  };
  
  console.log('🔧 [GET /discogs/config] Configuration check:', config);
  
  if (!secretsInitialized) {
    return res.status(503).json({ ...config, error: 'Secrets not initialized' });
  }
  
  if (!discogsConsumerKey || !discogsConsumerSecret) {
    return res.status(500).json({ ...config, error: 'Discogs credentials not configured' });
  }
  
  res.status(200).json(config);
});

// Manual secrets refresh endpoint
app.post('/admin/refresh-secrets', async (req, res) => {
  console.log('🔄 [POST /admin/refresh-secrets] Manual refresh requested');
  
  try {
    const success = await refreshSecrets();
    
    if (success) {
      res.status(200).json({
        success: true,
        message: 'Secrets refreshed successfully',
        timestamp: new Date().toISOString(),
        secretsLastRefreshed: secretsLastRefreshed ? secretsLastRefreshed.toISOString() : null
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to refresh secrets',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ [POST /admin/refresh-secrets] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing secrets',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Manual Discogs OAuth tokens refresh endpoint
app.post('/admin/refresh-discogs-tokens', async (req, res) => {
  console.log('🔄 [POST /admin/refresh-discogs-tokens] Manual refresh requested');
  
  try {
    const success = await refreshDiscogsOAuthTokens();
    
    if (success) {
      res.status(200).json({
        success: true,
        message: 'Discogs OAuth tokens refreshed successfully',
        timestamp: new Date().toISOString(),
        tokensExpiresAt: discogsOAuthTokens.expiresAt ? discogsOAuthTokens.expiresAt.toISOString() : null,
        tokensValid: areDiscogsTokensValid()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to refresh Discogs OAuth tokens',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ [POST /admin/refresh-discogs-tokens] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing Discogs OAuth tokens',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

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
let secretsLastRefreshed = null; // Track when secrets were last refreshed
let secretsRefreshInterval = null; // Store the interval ID for cleanup

async function initializeSecrets() {
  console.log('Initializing secrets...');
  try {
    await setSecrets();
    secretsInitialized = true;
    secretsLastRefreshed = new Date();
    console.log('Secrets initialized.');
    
    // Start auto-refresh mechanism for Discogs OAuth tokens
    startDiscogsTokenAutoRefresh();
  } catch (error) {
    console.error('Error during secrets initialization:', error.message || error);
    console.warn('Continuing with default/empty secret values.');
    secretsInitialized = false;
  }
}

// Auto-refresh secrets every 30 minutes to prevent AWS credential expiration
function startSecretsAutoRefresh() {
  // Removed - AWS secrets don't need auto-refresh as they don't expire
  console.log('ℹ️ AWS secrets auto-refresh disabled (secrets are permanent)');
}

// Manual refresh function for immediate use
async function refreshSecrets() {
  console.log('🔄 Manual secrets refresh requested...');
  try {
    await setSecrets();
    secretsLastRefreshed = new Date();
    secretsInitialized = true;
    console.log('✅ Manual secrets refresh successful');
    return true;
  } catch (error) {
    console.error('❌ Manual secrets refresh failed:', error.message || error);
    return false;
  }
}

// Cleanup function to stop auto-refresh
function stopSecretsAutoRefresh() {
  if (secretsRefreshInterval) {
    clearInterval(secretsRefreshInterval);
    secretsRefreshInterval = null;
    console.log('🛑 Secrets auto-refresh stopped');
  }
}

// Start server and initialize secrets
server.listen(port, async () => {
  try {
    await initializeSecrets();
    await initializeOAuth();
    if (loadTokens()) {
      logger.info('Using existing tokens for authentication.');
    } else {
      logger.info('No tokens found. Please visit the sign-in URL to authenticate.');
    }
    logger.info(`🚀 Server is running on port ${port}`);
    logger.info(`📊 Server ready to accept connections`);
  } catch (error) {
    logger.error("Failed to initialize server components:", error);
    logger.error("Server will continue running with limited functionality.");
    logger.warn(`Server is running on port ${port} (with initialization errors)`);
  }
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  stopSecretsAutoRefresh();
  stopDiscogsTokenAutoRefresh();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  if (isDev) {
    console.log('🛑 SIGINT received in development mode, exiting immediately...');
    process.exit(0);
  } else {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    stopSecretsAutoRefresh();
    stopDiscogsTokenAutoRefresh();
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
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

// Fetch AWS secret with retry mechanism
async function getAwsSecret(secretName, maxRetries = 3) {
  console.log(`\nFetching AWS secret: ${secretName}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries} for secret: ${secretName}`);
      const region = "us-west-2";
      const awsClient = new SecretsManagerClient({ region });
      console.log('AWS Secrets Manager client created');

      const command = new GetSecretValueCommand({
        SecretId: secretName,
        VersionStage: "AWSCURRENT", // Explicitly specify the version stage
      });
      console.log('GetSecretValueCommand created');

      const response = await awsClient.send(command);
      console.log(`✅ AWS secret ${secretName} retrieved successfully on attempt ${attempt}`);
      return response.SecretString;
    } catch (error) {
      console.error(`❌ Attempt ${attempt}/${maxRetries} failed for secret ${secretName}:`, error.message);
      
      if (attempt === maxRetries) {
        console.error(`❌ All ${maxRetries} attempts failed for secret ${secretName}`);
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

var discogsConsumerKey = '';
var discogsConsumerSecret = '';
var gcpClientId = '';
var gcpClientSecret = '';

async function setSecrets() {
  try {
    const envFilePath = `${__dirname}/.env`;
    var isLocalEnvFile = fs.existsSync(envFilePath);
    console.log('isLocalEnvFile=', isLocalEnvFile);
    console.log('NODE_ENV=', process.env.NODE_ENV);
    if (process.env.NODE_ENV === 'development' && isLocalEnvFile) {
      require('dotenv').config({ path: envFilePath });
      gcpClientId = process.env.GCP_CLIENT_ID || '';
      gcpClientSecret = process.env.GCP_CLIENT_SECRET || '';
      discogsConsumerKey = process.env.DISCOGS_CONSUMER_KEY || '';
      discogsConsumerSecret = process.env.DISCOGS_CONSUMER_SECRET || '';
      console.log('setSecrets() Local environment variables loaded.');
      console.log('gcpClientId loaded:', gcpClientId ? 'YES' : 'NO');
      console.log('gcpClientSecret loaded:', gcpClientSecret ? 'YES' : 'NO');
      console.log('discogsConsumerKey loaded:', discogsConsumerKey ? 'YES' : 'NO');
      console.log('discogsConsumerSecret loaded:', discogsConsumerSecret ? 'YES' : 'NO');
    } else {
      console.log('setSecrets() Loading AWS secrets for production...');
      try {
        console.log('setSecrets() Fetching YouTube secrets...');
        const youtubeSecrets = await getAwsSecret("youtubeAuth");
        const youtubeSecretsJson = JSON.parse(youtubeSecrets);
        gcpClientId = youtubeSecretsJson.GCP_CLIENT_ID || '';
        gcpClientSecret = youtubeSecretsJson.GCP_CLIENT_SECRET || '';
        console.log('setSecrets() YouTube secrets loaded successfully');

        console.log('setSecrets() Fetching Discogs secrets...');
        const discogsSecrets = await getAwsSecret("discogsAuth");
        const discogsSecretsJson = JSON.parse(discogsSecrets);
        discogsConsumerKey = discogsSecretsJson.DISCOGS_CONSUMER_KEY || '';
        discogsConsumerSecret = discogsSecretsJson.DISCOGS_CONSUMER_SECRET || '';
        console.log('setSecrets() Discogs secrets loaded successfully');

        console.log('setSecrets() AWS secrets loaded.');
        console.log('gcpClientId loaded:', gcpClientId ? 'YES' : 'NO');
        console.log('gcpClientSecret loaded:', gcpClientSecret ? 'YES' : 'NO');
        console.log('discogsConsumerKey loaded:', discogsConsumerKey ? 'YES' : 'NO');
        console.log('discogsConsumerSecret loaded:', discogsConsumerSecret ? 'YES' : 'NO');
      } catch (awsError) {
        console.error('setSecrets() ERROR: Failed to fetch AWS secrets:', awsError.message || awsError);
        console.error('setSecrets() AWS Error details:', awsError);
        console.warn('setSecrets() Warning: Defaulting to empty values.');
        gcpClientId = '';
        gcpClientSecret = '';
        discogsConsumerKey = '';
        discogsConsumerSecret = '';
      }
    }
  } catch (error) {
    console.error("setSecrets() Error setting secrets:", error);
    console.error("setSecrets() Error stack:", error.stack);
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

// YouTube OAuth2 Routes
// Get YouTube OAuth2 URL
app.get('/youtube/getAuthUrl', ensureSecretsInitialized, async (req, res) => {
  console.log("📺 [GET /youtube/getAuthUrl] Hit");
  try {
    if (!oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    console.log('OAuth2 client clientId:', oauth2Client._clientId ? 'SET' : 'NOT SET');
    console.log('OAuth2 client clientSecret:', oauth2Client._clientSecret ? 'SET' : 'NOT SET');
    console.log('Redirect URI:', getYouTubeRedirectUrl());

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
      prompt: 'consent',
      redirect_uri: getYouTubeRedirectUrl()
    });

    console.log('Generated YouTube auth URL:', authUrl);
    res.status(200).json({ url: authUrl });
  } catch (error) {
    console.error('Error generating YouTube auth URL:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get YouTube OAuth2 URL (production route)
app.get('/internal-api/youtube/getAuthUrl', ensureSecretsInitialized, async (req, res) => {
  console.log("📺 [GET /internal-api/youtube/getAuthUrl] Hit");
  try {
    if (!oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
      prompt: 'consent',
      redirect_uri: getYouTubeRedirectUrl()
    });

    console.log('Generated YouTube auth URL:', authUrl);
    res.status(200).json({ url: authUrl });
  } catch (error) {
    console.error('Error generating YouTube auth URL:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// YouTube OAuth2 callback
app.get('/youtube/callback', async (req, res) => {
  console.log("📺 [GET /youtube/callback] Hit:", req.originalUrl);

  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No code found in the request.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log('YouTube User authenticated. Tokens:', tokens);

    // Store tokens in session
    req.session.youtubeAuth = {
      tokens: tokens,
      isAuthenticated: true,
      authenticatedAt: new Date().toISOString()
    };

    // Update global auth status
    authStatus.isAuthenticated = true;

    // Redirect to the frontend route
    const redirectUrl = isDev ? 'http://localhost:3001/youtube' : 'https://martinbarker.me/youtube';
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error during YouTube authentication:', error.message);
    res.status(500).send('Authentication failed.');
  }
});

// YouTube OAuth2 callback for production (with /internal-api prefix)
app.get('/internal-api/youtube/callback', async (req, res) => {
  console.log("📺 [GET /internal-api/youtube/callback] Hit:", req.originalUrl);

  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No code found in the request.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log('YouTube User authenticated. Tokens:', tokens);

    // Store tokens in session
    req.session.youtubeAuth = {
      tokens: tokens,
      isAuthenticated: true,
      authenticatedAt: new Date().toISOString()
    };

    // Update global auth status
    authStatus.isAuthenticated = true;

    // Redirect to the frontend route
    const redirectUrl = 'https://martinbarker.me/youtube';
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error during YouTube authentication:', error.message);
    res.status(500).send('Authentication failed.');
  }
});

// Get YouTube authentication status
app.get('/youtube/authStatus', (req, res) => {
  logger.info("🔍 [GET /youtube/authStatus] Hit");
  
  const youtubeAuth = req.session?.youtubeAuth;
  const isAuthenticated = youtubeAuth?.isAuthenticated || false;
  
  let userInfo = null;
  if (isAuthenticated && youtubeAuth?.tokens) {
    // Set credentials for the request
    oauth2Client.setCredentials(youtubeAuth.tokens);
    
    // Try to get user info from YouTube API
    // Note: This is a simplified response - you might want to make an actual API call
    userInfo = {
      authenticatedAt: youtubeAuth.authenticatedAt,
      hasValidTokens: !!youtubeAuth.tokens
    };
  }

  res.status(200).json({
    isAuthenticated,
    userInfo
  });
});

// Get YouTube authentication status (production route)
app.get('/internal-api/youtube/authStatus', (req, res) => {
  logger.info("🔍 [GET /internal-api/youtube/authStatus] Hit");
  
  const youtubeAuth = req.session?.youtubeAuth;
  const isAuthenticated = youtubeAuth?.isAuthenticated || false;
  
  let userInfo = null;
  if (isAuthenticated && youtubeAuth?.tokens) {
    // Set credentials for the request
    oauth2Client.setCredentials(youtubeAuth.tokens);
    
    // Try to get user info from YouTube API
    // Note: This is a simplified response - you might want to make an actual API call
    userInfo = {
      authenticatedAt: youtubeAuth.authenticatedAt,
      hasValidTokens: !!youtubeAuth.tokens
    };
  }

  res.status(200).json({
    isAuthenticated,
    userInfo
  });
});

// Clear YouTube authentication
app.post('/youtube/clearAuth', (req, res) => {
  logger.info("🧹 [POST /youtube/clearAuth] Hit");
  
  try {
    // Clear session data
    if (req.session) {
      delete req.session.youtubeAuth;
    }
    
    // Update global auth status
    authStatus.isAuthenticated = false;
    
    // Clear OAuth2 client credentials
    if (oauth2Client) {
      oauth2Client.setCredentials({});
    }
    
    res.status(200).json({ message: 'YouTube authentication cleared successfully.' });
  } catch (error) {
    console.error('Error clearing YouTube auth:', error.message);
    res.status(500).json({ error: 'Failed to clear authentication.' });
  }
});

// Clear YouTube authentication (production route)
app.post('/internal-api/youtube/clearAuth', (req, res) => {
  console.log("🧹 [POST /internal-api/youtube/clearAuth] Hit");
  
  try {
    // Clear session data
    if (req.session) {
      delete req.session.youtubeAuth;
    }
    
    // Update global auth status
    authStatus.isAuthenticated = false;
    
    // Clear OAuth2 client credentials
    if (oauth2Client) {
      oauth2Client.setCredentials({});
    }
    
    res.status(200).json({ message: 'YouTube authentication cleared successfully.' });
  } catch (error) {
    console.error('Error clearing YouTube auth:', error.message);
    res.status(500).json({ error: 'Failed to clear authentication.' });
  }
});

// Exchange auth code for tokens
app.post('/youtube/exchangeCode', (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    logger.info("🔄 [POST /youtube/exchangeCode] Hit");
  }
  
  try {
    const { code, scope } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Auth code is required' });
    }

    // Exchange code for tokens
    oauth2Client.getToken(code, (err, tokens) => {
      if (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error exchanging code for tokens:', err);
        }
        return res.status(400).json({ error: 'Invalid auth code' });
      }

      // Store tokens in session
      req.session.youtubeAuth = {
        isAuthenticated: true,
        tokens: tokens,
        authenticatedAt: new Date().toISOString()
      };

      if (process.env.NODE_ENV === 'development') {
        console.log('Auth code exchanged successfully for tokens');
      }
      res.status(200).json({ 
        message: 'Auth code exchanged successfully',
        isAuthenticated: true
      });
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error exchanging auth code:', error.message);
    }
    res.status(500).json({ error: 'Failed to exchange auth code' });
  }
});

// Exchange auth code for tokens (production route)
app.post('/internal-api/youtube/exchangeCode', (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    console.log("🔄 [POST /internal-api/youtube/exchangeCode] Hit");
  }
  
  try {
    const { code, scope } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Auth code is required' });
    }

    // Exchange code for tokens
    oauth2Client.getToken(code, (err, tokens) => {
      if (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error exchanging code for tokens:', err);
        }
        return res.status(400).json({ error: 'Invalid auth code' });
      }

      // Store tokens in session
      req.session.youtubeAuth = {
        isAuthenticated: true,
        tokens: tokens,
        authenticatedAt: new Date().toISOString()
      };

      if (process.env.NODE_ENV === 'development') {
        console.log('Auth code exchanged successfully for tokens');
      }
      res.status(200).json({ 
        message: 'Auth code exchanged successfully',
        isAuthenticated: true
      });
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error exchanging auth code:', error.message);
    }
    res.status(500).json({ error: 'Failed to exchange auth code' });
  }
});

// Create YouTube playlist
app.post('/youtube/createPlaylist', (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    logger.info("🎵 [POST /youtube/createPlaylist] Hit");
  }
  
  try {
    const youtubeAuth = req.session?.youtubeAuth;
    
    if (!youtubeAuth?.isAuthenticated || !youtubeAuth?.tokens) {
      return res.status(401).json({ error: 'Not authenticated with YouTube' });
    }

    const { title, description, privacyStatus } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Playlist title is required' });
    }

    // Set credentials for the authenticated user
    oauth2Client.setCredentials(youtubeAuth.tokens);

    // Create the playlist
    youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: title.trim(),
          description: description || ''
        },
        status: {
          privacyStatus: privacyStatus || 'private'
        }
      }
    }, (err, response) => {
      if (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error creating playlist:', err);
        }
        
        // Extract detailed error information
        let errorMessage = 'Failed to create playlist';
        let errorCode = null;
        let errorReason = null;
        
        if (err.code) {
          errorCode = err.code;
        }
        
        if (err.message) {
          errorMessage = err.message;
        }
        
        if (err.errors && err.errors.length > 0) {
          const firstError = err.errors[0];
          if (firstError.message) {
            errorMessage = firstError.message;
          }
          if (firstError.reason) {
            errorReason = firstError.reason;
          }
        }
        
        // Determine appropriate HTTP status code
        let statusCode = 500;
        if (err.code === 403) {
          statusCode = 429; // Rate limited
        } else if (err.code === 401) {
          statusCode = 401; // Unauthorized
        } else if (err.code === 400) {
          statusCode = 400; // Bad request
        }
        
        const errorResponse = {
          error: errorMessage,
          code: errorCode,
          reason: errorReason
        };
        
        return res.status(statusCode).json(errorResponse);
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('Playlist created successfully:', response.data);
      }
      res.status(200).json(response.data);
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error creating playlist:', error.message);
    }
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// Create YouTube playlist (production route)
app.post('/internal-api/youtube/createPlaylist', (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    console.log("🎵 [POST /internal-api/youtube/createPlaylist] Hit");
  }
  
  try {
    const youtubeAuth = req.session?.youtubeAuth;
    
    if (!youtubeAuth?.isAuthenticated || !youtubeAuth?.tokens) {
      return res.status(401).json({ error: 'Not authenticated with YouTube' });
    }

    const { title, description, privacyStatus } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Playlist title is required' });
    }

    // Set credentials for the authenticated user
    oauth2Client.setCredentials(youtubeAuth.tokens);

    // Create the playlist
    youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: title.trim(),
          description: description || ''
        },
        status: {
          privacyStatus: privacyStatus || 'private'
        }
      }
    }, (err, response) => {
      if (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error creating playlist:', err);
        }
        
        // Extract detailed error information
        let errorMessage = 'Failed to create playlist';
        let errorCode = null;
        let errorReason = null;
        
        if (err.code) {
          errorCode = err.code;
        }
        
        if (err.message) {
          errorMessage = err.message;
        }
        
        if (err.errors && err.errors.length > 0) {
          const firstError = err.errors[0];
          if (firstError.message) {
            errorMessage = firstError.message;
          }
          if (firstError.reason) {
            errorReason = firstError.reason;
          }
        }
        
        // Determine appropriate HTTP status code
        let statusCode = 500;
        if (err.code === 403) {
          statusCode = 429; // Rate limited
        } else if (err.code === 401) {
          statusCode = 401; // Unauthorized
        } else if (err.code === 400) {
          statusCode = 400; // Bad request
        }
        
        const errorResponse = {
          error: errorMessage,
          code: errorCode,
          reason: errorReason
        };
        
        return res.status(statusCode).json(errorResponse);
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('Playlist created successfully:', response.data);
      }
      res.status(200).json(response.data);
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error creating playlist:', error.message);
    }
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// Add video to YouTube playlist
app.post('/youtube/addVideoToPlaylist', async (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    console.log("🎵 [POST /youtube/addVideoToPlaylist] Hit");
  }
  
  try {
    const youtubeAuth = req.session?.youtubeAuth;
    
    if (!youtubeAuth?.isAuthenticated || !youtubeAuth?.tokens) {
      return res.status(401).json({ error: 'Not authenticated with YouTube' });
    }

    const { playlistId, videoId } = req.body;
    
    if (!playlistId || !videoId) {
      return res.status(400).json({ error: 'Playlist ID and Video ID are required' });
    }

    // Set credentials for the authenticated user
    oauth2Client.setCredentials(youtubeAuth.tokens);

    // Add video to playlist with retry logic
    try {
      const response = await retryWithExponentialBackoff(async () => {
        return new Promise((resolve, reject) => {
          youtube.playlistItems.insert({
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
          }, (err, response) => {
            if (err) {
              reject(err);
            } else {
              resolve(response);
            }
          });
        });
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('Video added to playlist successfully:', response.data);
      }
      res.status(200).json(response.data);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error adding video to playlist after retries:', error);
      }
      
      // Check if it's a quota error
      const isQuotaError = error.code === 403 && 
        error.errors && 
        error.errors.some(err => err.reason === 'quotaExceeded');
      
      if (isQuotaError) {
        return res.status(429).json({ 
          error: 'YouTube API quota exceeded. Please try again later.',
          retryAfter: 3600 // 1 hour in seconds
        });
      }
      
      res.status(500).json({ error: 'Failed to add video to playlist' });
    }

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error adding video to playlist:', error.message);
    }
    res.status(500).json({ error: 'Failed to add video to playlist' });
  }
});

// Add video to YouTube playlist (production route)
app.post('/internal-api/youtube/addVideoToPlaylist', async (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    console.log("🎵 [POST /internal-api/youtube/addVideoToPlaylist] Hit");
  }
  
  try {
    const youtubeAuth = req.session?.youtubeAuth;
    
    if (!youtubeAuth?.isAuthenticated || !youtubeAuth?.tokens) {
      return res.status(401).json({ error: 'Not authenticated with YouTube' });
    }

    const { playlistId, videoId } = req.body;
    
    if (!playlistId || !videoId) {
      return res.status(400).json({ error: 'Playlist ID and Video ID are required' });
    }

    // Set credentials for the authenticated user
    oauth2Client.setCredentials(youtubeAuth.tokens);

    // Add video to playlist with retry logic
    try {
      const response = await retryWithExponentialBackoff(async () => {
        return new Promise((resolve, reject) => {
          youtube.playlistItems.insert({
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
          }, (err, response) => {
            if (err) {
              reject(err);
            } else {
              resolve(response);
            }
          });
        });
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('Video added to playlist successfully:', response.data);
      }
      res.status(200).json(response.data);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error adding video to playlist after retries:', error);
      }
      
      // Check if it's a quota error
      const isQuotaError = error.code === 403 && 
        error.errors && 
        error.errors.some(err => err.reason === 'quotaExceeded');
      
      if (isQuotaError) {
        return res.status(429).json({ 
          error: 'YouTube API quota exceeded. Please try again later.',
          retryAfter: 3600 // 1 hour in seconds
        });
      }
      
      res.status(500).json({ error: 'Failed to add video to playlist' });
    }

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error adding video to playlist:', error.message);
    }
    res.status(500).json({ error: 'Failed to add video to playlist' });
  }
});

// Fetch Discogs info for playlist metadata
app.post('/discogs/info', async (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    console.log("📋 [POST /discogs/info] Hit", req.body);
  }
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    let type, id, name, profile;
    
    // Parse the URL to determine type and ID
    if (url.includes('/artist/')) {
      const match = url.match(/\/artist\/(\d+)/);
      if (match) {
        type = 'artist';
        id = match[1];
        
        // Fetch artist info
        const artistUrl = `${DISCOGS_API_URL}/artists/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(artistUrl, { headers });
        name = response.data.name;
        profile = response.data.profile;
      }
    } else if (url.includes('/label/')) {
      const match = url.match(/\/label\/(\d+)/);
      if (match) {
        type = 'label';
        id = match[1];
        
        // Fetch label info
        const labelUrl = `${DISCOGS_API_URL}/labels/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(labelUrl, { headers });
        name = response.data.name;
        profile = response.data.profile;
      }
    } else if (url.includes('/lists/')) {
      const listId = url.split('/').pop();
      type = 'list';
      id = listId;
      
      // Fetch list info
      const listUrl = `${DISCOGS_API_URL}/lists/${id}`;
      const headers = { 'User-Agent': USER_AGENT };
      
      // Add OAuth if available
      const discogsAuth = req.session?.discogsAuth;
      if (discogsAuth?.accessToken) {
        const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
        headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
      }
      
      const response = await axios.get(listUrl, { headers });
      name = response.data.name;
      profile = response.data.description;
    } else if (url.includes('/release/')) {
      const match = url.match(/\/release\/(\d+)/);
      if (match) {
        type = 'release';
        id = match[1];
        
        // Fetch release info
        const releaseUrl = `${DISCOGS_API_URL}/releases/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(releaseUrl, { headers });
        name = response.data.title || response.data.artists?.[0]?.name || 'Unknown Release';
        profile = response.data.notes || response.data.profile || '';
      }
    } else if (url.includes('/master/')) {
      const match = url.match(/\/master\/(\d+)/);
      if (match) {
        type = 'master';
        id = match[1];
        
        // Fetch master info
        const masterUrl = `${DISCOGS_API_URL}/masters/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(masterUrl, { headers });
        name = response.data.title || response.data.artists?.[0]?.name || 'Unknown Master';
        profile = response.data.notes || response.data.profile || '';
      }
    }
    
    if (!type || !id) {
      return res.status(400).json({ error: 'Invalid Discogs URL' });
    }
    
    res.status(200).json({
      type,
      id,
      name,
      profile,
      url
    });
    
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching Discogs info:', error.message);
    }
    res.status(500).json({ error: 'Failed to fetch Discogs info' });
  }
});

// Fetch Discogs info for playlist metadata (production route)
app.post('/internal-api/discogs/info', async (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    console.log("📋 [POST /internal-api/discogs/info] Hit", req.body);
  }
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    let type, id, name, profile;
    
    // Parse the URL to determine type and ID
    if (url.includes('/artist/')) {
      const match = url.match(/\/artist\/(\d+)/);
      if (match) {
        type = 'artist';
        id = match[1];
        
        // Fetch artist info
        const artistUrl = `${DISCOGS_API_URL}/artists/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(artistUrl, { headers });
        name = response.data.name;
        profile = response.data.profile;
      }
    } else if (url.includes('/label/')) {
      const match = url.match(/\/label\/(\d+)/);
      if (match) {
        type = 'label';
        id = match[1];
        
        // Fetch label info
        const labelUrl = `${DISCOGS_API_URL}/labels/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(labelUrl, { headers });
        name = response.data.name;
        profile = response.data.profile;
      }
    } else if (url.includes('/lists/')) {
      const listId = url.split('/').pop();
      type = 'list';
      id = listId;
      
      // Fetch list info
      const listUrl = `${DISCOGS_API_URL}/lists/${id}`;
      const headers = { 'User-Agent': USER_AGENT };
      
      // Add OAuth if available
      const discogsAuth = req.session?.discogsAuth;
      if (discogsAuth?.accessToken) {
        const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
        headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
      }
      
      const response = await axios.get(listUrl, { headers });
      name = response.data.name;
      profile = response.data.description;
    } else if (url.includes('/release/')) {
      const match = url.match(/\/release\/(\d+)/);
      if (match) {
        type = 'release';
        id = match[1];
        
        // Fetch release info
        const releaseUrl = `${DISCOGS_API_URL}/releases/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(releaseUrl, { headers });
        name = response.data.title || response.data.artists?.[0]?.name || 'Unknown Release';
        profile = response.data.notes || response.data.profile || '';
      }
    } else if (url.includes('/master/')) {
      const match = url.match(/\/master\/(\d+)/);
      if (match) {
        type = 'master';
        id = match[1];
        
        // Fetch master info
        const masterUrl = `${DISCOGS_API_URL}/masters/${id}`;
        const headers = { 'User-Agent': USER_AGENT };
        
        // Add OAuth if available
        const discogsAuth = req.session?.discogsAuth;
        if (discogsAuth?.accessToken) {
          const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
          headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
        }
        
        const response = await axios.get(masterUrl, { headers });
        name = response.data.title || response.data.artists?.[0]?.name || 'Unknown Master';
        profile = response.data.notes || response.data.profile || '';
      }
    }
    
    if (!type || !id) {
      return res.status(400).json({ error: 'Invalid Discogs URL' });
    }
    
    res.status(200).json({
      type,
      id,
      name,
      profile,
      url
    });
    
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching Discogs info:', error.message);
    }
    res.status(500).json({ error: 'Failed to fetch Discogs info' });
  }
});

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

// Rate limiting for vibrant API
const vibrantRateLimit = new Map();
const VIBRANT_RATE_LIMIT_WINDOW = 60000; // 1 minute
const VIBRANT_MAX_REQUESTS = 10; // 10 requests per minute per IP

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, requests] of vibrantRateLimit.entries()) {
    const recentRequests = requests.filter(time => now - time < VIBRANT_RATE_LIMIT_WINDOW);
    if (recentRequests.length === 0) {
      vibrantRateLimit.delete(ip);
    } else {
      vibrantRateLimit.set(ip, recentRequests);
    }
  }
}, 5 * 60 * 1000); // 5 minutes

// Function to check rate limit
function checkVibrantRateLimit(ip) {
  const now = Date.now();
  const userRequests = vibrantRateLimit.get(ip) || [];
  
  // Remove old requests outside the window
  const recentRequests = userRequests.filter(time => now - time < VIBRANT_RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= VIBRANT_MAX_REQUESTS) {
    return false;
  }
  
  recentRequests.push(now);
  vibrantRateLimit.set(ip, recentRequests);
  return true;
}

// Function to validate image size
function validateImageSize(buffer) {
  const maxSize = 10 * 1024 * 1024; // 10MB limit
  if (buffer.length > maxSize) {
    throw new Error('Image size exceeds 10MB limit');
  }
  return true;
}

// Function to validate base64 data
function validateBase64Data(base64Data) {
  // Check if it's valid base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(base64Data)) {
    throw new Error('Invalid base64 data format');
  }
  
  // Check reasonable size (base64 is ~33% larger than binary)
  const maxBase64Size = 15 * 1024 * 1024; // ~10MB binary = ~13.3MB base64
  if (base64Data.length > maxBase64Size) {
    throw new Error('Base64 data too large');
  }
  
  return true;
}

// Function to sanitize and validate URL
function validateImageUrl(url) {
  try {
    const parsedUrl = new URL(url);
    
    // Only allow HTTPS (except localhost for development)
    if (parsedUrl.protocol !== 'https:' && !parsedUrl.hostname.includes('localhost')) {
      throw new Error('Only HTTPS URLs are allowed');
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /\.\./,  // Directory traversal
      /%2e%2e/i,  // URL encoded directory traversal
      /javascript:/i,  // JavaScript protocol
      /data:/i,  // Data URLs (should use imageData instead)
      /file:/i,  // File protocol
      /ftp:/i,  // FTP protocol
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url)) {
        throw new Error('URL contains suspicious patterns');
      }
    }
    
    // Validate file extension
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const pathname = parsedUrl.pathname.toLowerCase();
    const hasValidExtension = allowedExtensions.some(ext => pathname.endsWith(ext));
    
    if (!hasValidExtension) {
      throw new Error('URL must point to a valid image file');
    }
    
    return parsedUrl;
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

// Vibrant color extraction API endpoint
app.post('/vibrant/extract-colors', async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  console.log("🎨 [POST /vibrant/extract-colors] Hit", { ip: clientIP, body: req.body });
  
  try {
    // Rate limiting check
    if (!checkVibrantRateLimit(clientIP)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Maximum 10 requests per minute.',
        retryAfter: 60
      });
    }
    
    const { imageUrl, imageData } = req.body;
    
    // Validate input
    if (!imageUrl && !imageData) {
      return res.status(400).json({ error: 'Either imageUrl or imageData is required.' });
    }
    
    if (imageUrl && imageData) {
      return res.status(400).json({ error: 'Provide either imageUrl or imageData, not both.' });
    }
    
    let palette;
    
    if (imageData) {
      // Handle base64 image data
      try {
        // Validate base64 format and size
        validateBase64Data(imageData);
        
        const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Validate image size
        validateImageSize(buffer);
        
        palette = await Vibrant.from(buffer).getPalette();
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else {
      // Handle image URL
      try {
        const parsedUrl = validateImageUrl(imageUrl);
        
        // Check if URL is from allowed domains (security measure)
        const allowedDomains = [
          'amazon.com', 'amazonaws.com', 'discogs.com', 'imgur.com', 
          'github.com', 'githubusercontent.com', 'unsplash.com',
          'pixabay.com', 'pexels.com', 'flickr.com', 'localhost'
        ];
        
        const urlDomain = parsedUrl.hostname.toLowerCase();
        const isAllowed = allowedDomains.some(domain => urlDomain.includes(domain));
        
        if (!isAllowed) {
          return res.status(400).json({ 
            error: 'Image URL must be from an allowed domain for security reasons.' 
          });
        }
        
        // Set timeout for image fetching
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        try {
          palette = await Vibrant.from(imageUrl).getPalette();
          clearTimeout(timeoutId);
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            throw new Error('Image fetch timeout');
          }
          throw fetchError;
        }
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }
    
    // Extract color data
    const colors = {};
    const colorNames = {
      Vibrant: 'Vibrant',
      LightVibrant: 'Light Vibrant', 
      DarkVibrant: 'Dark Vibrant',
      Muted: 'Muted',
      LightMuted: 'Light Muted',
      DarkMuted: 'Dark Muted'
    };
    
    Object.entries(palette).forEach(([key, color]) => {
      if (color) {
        colors[key] = {
          hex: color.hex,
          population: color.population,
          name: colorNames[key] || key
        };
      }
    });
    
    console.log("✅ Successfully extracted colors:", Object.keys(colors));
    res.status(200).json({ 
      success: true, 
      colors,
      extractedAt: new Date().toISOString(),
      requestId: crypto.randomBytes(8).toString('hex') // For tracking
    });
    
  } catch (error) {
    console.error("❌ Error extracting colors:", { 
      error: error.message, 
      ip: clientIP, 
      timestamp: new Date().toISOString() 
    });
    
    // Don't expose internal error details
    const safeError = error.message.includes('timeout') ? 'Image processing timeout' :
                     error.message.includes('size') ? 'Image too large' :
                     error.message.includes('format') ? 'Invalid image format' :
                     'Failed to extract colors from image';
    
    res.status(500).json({ 
      error: safeError,
      requestId: crypto.randomBytes(8).toString('hex')
    });
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
  console.log("🔗 [GET /listogs/discogs/getURL] Hit");
  
  try {
    // Check if secrets are initialized
    if (!secretsInitialized) {
      console.error("❌ [GET /listogs/discogs/getURL] Secrets not initialized");
      return res.status(503).json({ error: 'Server not ready. Secrets not initialized.' });
    }

    // Check if Discogs credentials are available
    if (!discogsConsumerKey || !discogsConsumerSecret) {
      console.error("❌ [GET /listogs/discogs/getURL] Discogs credentials not available:", {
        hasKey: !!discogsConsumerKey,
        hasSecret: !!discogsConsumerSecret
      });
      return res.status(500).json({ error: 'Discogs credentials not configured.' });
    }

    console.log("🔍 [GET /listogs/discogs/getURL] Generating fresh auth URL...");
    const response = await DEBUG_generateDiscogsAuthUrl();
    const { oauth_token } = querystring.parse(response.data);
    const url = `${DISCOGS_AUTHORIZE_URL}?oauth_token=${oauth_token}`;
    console.log("✅ [GET /listogs/discogs/getURL] Success:", { url: url.substring(0, 50) + "..." });
    res.status(200).json({ url });
  } catch (error) {
    console.error("❌ [GET /listogs/discogs/getURL] Error:", {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Failed to generate Discogs auth URL.',
      details: error.message
    });
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
      redirectBaseURL = 'https://martinbarker.me/listogs';
    }

    const redirectUrl = `${redirectBaseURL}?oauth_token=${encodeURIComponent(oauth_token)}&oauth_verifier=${encodeURIComponent(oauth_verifier)}`;
    res.redirect(redirectUrl);

  } catch (err) {
    console.error('[Discogs Callback] Handler error:', err);
    res.status(500).send('Caught error: ' + err.message);
  }
});


function sendLogMessageToSession(message, socketId) {
  // Early return if socket is not connected
  if (!isSocketConnected(socketId)) {
    // If socket is disconnected, remove from active jobs silently
    if (socketId && activeJobs.has(socketId)) {
      activeJobs.delete(socketId);
    }
    // Only log once per socketId to avoid spam
    if (socketId && !disconnectedSockets.has(socketId)) {
      console.warn('[sendLogMessageToSession] No target socket found for socketId:', socketId);
      disconnectedSockets.add(socketId);
    }
    return;
  }
  
  const target = io.sockets.sockets.get(socketId);
  target.emit('sessionLog', message);
}

// Exponential backoff retry function for YouTube API quota errors
async function retryWithExponentialBackoff(operation, maxRetries = 5, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // Check if it's a quota exceeded error
      const isQuotaError = error.code === 403 && 
        error.errors && 
        error.errors.some(err => err.reason === 'quotaExceeded');
      
      if (!isQuotaError || attempt === maxRetries - 1) {
        throw error; // Re-throw if not quota error or max retries reached
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      
      console.log(`YouTube API quota exceeded, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
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

function sendVideosToSession(videos, socketId) {
  // Early return if socket is not connected
  if (!isSocketConnected(socketId)) {
    // If socket is disconnected, remove from active jobs silently
    if (socketId && activeJobs.has(socketId)) {
      activeJobs.delete(socketId);
    }
    // Only log once per socketId to avoid spam
    if (socketId && !disconnectedSockets.has(socketId)) {
      console.warn('[sendVideosToSession] No target socket found for socketId:', socketId);
      disconnectedSockets.add(socketId);
    }
    return;
  }
  
  const target = io.sockets.sockets.get(socketId);
  // Deduplicate videos by videoId before sending
  const deduplicatedVideos = deduplicateVideosByVideoId(videos);
  target.emit('sessionVideos', deduplicatedVideos);
}

// Helper function to deduplicate videos by videoId
function deduplicateVideosByVideoId(videos) {
  if (Array.isArray(videos)) {
    const seen = new Set();
    return videos.filter(video => {
      if (!video.videoId) return true;
      if (seen.has(video.videoId)) return false;
      seen.add(video.videoId);
      return true;
    });
  } else if (typeof videos === 'object' && videos !== null) {
    const seen = new Set();
    const result = {};
    
    // Handle special properties like totalVideoCount
    if ('totalVideoCount' in videos) {
      result.totalVideoCount = videos.totalVideoCount;
    }
    
    // Process each release
    Object.entries(videos).forEach(([releaseKey, releaseVideos]) => {
      if (releaseKey === 'totalVideoCount') return; // Skip totalVideoCount
      
      if (Array.isArray(releaseVideos)) {
        result[releaseKey] = releaseVideos.filter(video => {
          if (!video.videoId) return true;
          if (seen.has(video.videoId)) return false;
          seen.add(video.videoId);
          return true;
        });
      } else {
        result[releaseKey] = releaseVideos;
      }
    });
    
    // Update totalVideoCount based on deduplicated videos
    if ('totalVideoCount' in videos) {
      let totalCount = 0;
      Object.values(result).forEach(releaseVideos => {
        if (Array.isArray(releaseVideos)) {
          totalCount += releaseVideos.length;
        }
      });
      result.totalVideoCount = totalCount;
    }
    
    return result;
  }
  return videos;
}

function sendStatusToSession(status, socketId) {
  // Early return if socket is not connected
  if (!isSocketConnected(socketId)) {
    // If socket is disconnected, remove from active jobs silently
    if (socketId && activeJobs.has(socketId)) {
      activeJobs.delete(socketId);
    }
    // Only log once per socketId to avoid spam
    if (socketId && !disconnectedSockets.has(socketId)) {
      console.warn('[sendStatusToSession] No target socket found for socketId:', socketId);
      disconnectedSockets.add(socketId);
    }
    return;
  }
  
  const target = io.sockets.sockets.get(socketId);
  target.emit('sessionStatus', status);
}


// Make discogs api request with pagination
async function newDiscogsAPIRequest(discogsURL, oauthToken, socketId, cancelled = false) {
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

  // Pagination logic
  let url = discogsURL;
  let allReleases = [];
  let pageCount = 0;
  let firstResponse = null;
  let totalPages = 0;
  // Track last successful progress for rate limit display
  let lastSuccessfulPageCount = 0;
  let lastSuccessfulTotalPages = 0;

  while (url) {
    // Check for cancellation at the start of each iteration
    if (cancelled) {
      console.log(`[newDiscogsAPIRequest] Job cancelled for socket ${socketId}`);
      return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
    }
    
    // Also check if socket is still connected
    if (!isSocketConnected(socketId)) {
      console.log(`[newDiscogsAPIRequest] Socket ${socketId} disconnected, aborting`);
      return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
    }

    try {
      const response = await axios.get(url, { headers });
      
      // Check for cancellation after the request
      if (cancelled) {
        console.log(`[newDiscogsAPIRequest] Job cancelled for socket ${socketId}`);
        return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
      }
      
      if (!firstResponse) firstResponse = response.data;
      if (rateLimitStart !== null) {
        const seconds = ((Date.now() - rateLimitStart) / 1000).toFixed(1);
        const msg = `✅ Rate limit recovery: ${seconds} seconds since last 429 to first success.`;
        sendLogMessageToSession(msg, socketId);
        console.log(msg);
        if (typeof io !== "undefined") io.emit('progressLog', msg);
        rateLimitStart = null;
        if (socketRateLimitState.has(socketId)) {
          socketRateLimitState.set(socketId, { retry: 0 });
        }
      }
      // If paginated, collect all releases/items
      if (response.data && Array.isArray(response.data.releases)) {
        allReleases = allReleases.concat(response.data.releases);
        pageCount++;
        totalPages = response.data?.pagination?.pages || totalPages;
        
        // Update last successful progress
        lastSuccessfulPageCount = pageCount;
        lastSuccessfulTotalPages = totalPages;
        
        // Send status update
        sendStatusToSession({
          status: "In progress",
          progress: { currentIndex: pageCount, total: totalPages }
        }, socketId);

        if (response.data?.pagination?.page && response.data?.pagination?.pages) {
          sendLogMessageToSession(`Page ${response.data.pagination.page}/${response.data.pagination.pages} fetched (${allReleases.length} releases so far)`, socketId);
        }
        url = response.data?.pagination?.urls?.next || null;
      } else {
        // Not paginated, just return the data
        url = null;
      }
      retryCount = 0;
    } catch (err) {
      // Handle 429 (rate limit)
      if (err.response?.status === 429) {
        // Check for cancellation before processing rate limit
        if (cancelled) {
          console.log(`[newDiscogsAPIRequest] Job cancelled during rate limit handling for socket ${socketId}`);
          return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
        }

        const rateState = socketRateLimitState.get(socketId) || { retry: 0 };
        rateState.retry = (rateState.retry || 0) + 1;
        socketRateLimitState.set(socketId, rateState);

        retryCount = rateState.retry;
        if (rateLimitStart === null) rateLimitStart = Date.now();
        const waitTime = Math.min(2000 * Math.pow(2, rateState.retry - 1), 32000); // Cap at 32 seconds
        const logMsg = `⏳ Rate limit hit. Attempt ${rateState.retry}. Waiting ${waitTime / 1000} seconds...`;
        console.warn(logMsg);
        sendLogMessageToSession(logMsg, socketId);

        // Send waiting status
        // If waiting for rate limit, use the last successful progress values
        // If no successful progress yet, use current values
        const displayPageCount = lastSuccessfulPageCount > 0 ? lastSuccessfulPageCount : pageCount;
        const displayTotalPages = lastSuccessfulTotalPages > 0 ? lastSuccessfulTotalPages : totalPages;
        
        sendStatusToSession({
          status: "Waiting for rate limit",
          progress: { 
            currentIndex: displayPageCount, 
            total: displayTotalPages 
          }
          
        }, socketId);

        if (typeof io !== "undefined") io.emit('progressLog', logMsg);
        
        // Check for cancellation before waiting
        if (cancelled) {
          console.log(`[newDiscogsAPIRequest] Job cancelled before rate limit wait for socket ${socketId}`);
          return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
        }
        
        // Use a timeout with cancellation checks during rate limit wait
        await new Promise(resolve => {
          const timeoutId = setTimeout(resolve, waitTime);
          // Check for cancellation every 100ms during the wait
          const checkInterval = setInterval(() => {
            if (cancelled || !isSocketConnected(socketId)) {
              clearTimeout(timeoutId);
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          
          // Clean up interval when timeout completes
          setTimeout(() => clearInterval(checkInterval), waitTime);
        });
        
        // Check for cancellation after waiting
        if (cancelled || !isSocketConnected(socketId)) {
          console.log(`[newDiscogsAPIRequest] Job cancelled after rate limit wait for socket ${socketId}`);
          return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
        }
        
        continue;
      }
      // Handle 500 (server error)
      if (err.response?.status === 500 && error500Count < max500Retries) {
        // Check for cancellation before processing 500 error
        if (cancelled) {
          console.log(`[newDiscogsAPIRequest] Job cancelled during 500 error handling for socket ${socketId}`);
          return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
        }

        error500Count++;
        const waitTime = 1000 * error500Count; // Linear backoff for 500s
        const logMsg = `⏳ Discogs 500 error. Retry ${error500Count}/${max500Retries}. Waiting ${waitTime / 1000} seconds...`;
        console.warn(logMsg);
        sendLogMessageToSession(logMsg, socketId);

        // Still in progress, but could also send a special status if desired
        const displayPageCount = lastSuccessfulPageCount > 0 ? lastSuccessfulPageCount : pageCount;
        const displayTotalPages = lastSuccessfulTotalPages > 0 ? lastSuccessfulTotalPages : totalPages;
        
        sendStatusToSession({
          status: "In progress",
          progress: { currentIndex: displayPageCount, total: displayTotalPages }
        }, socketId);

        if (typeof io !== "undefined") io.emit('progressLog', logMsg);
        
        // Check for cancellation before waiting
        if (cancelled) {
          console.log(`[newDiscogsAPIRequest] Job cancelled before 500 error wait for socket ${socketId}`);
          return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
        }
        
        // Use a timeout with cancellation checks during 500 error wait
        await new Promise(resolve => {
          const timeoutId = setTimeout(resolve, waitTime);
          // Check for cancellation every 100ms during the wait
          const checkInterval = setInterval(() => {
            if (cancelled || !isSocketConnected(socketId)) {
              clearTimeout(timeoutId);
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          
          // Clean up interval when timeout completes
          setTimeout(() => clearInterval(checkInterval), waitTime);
        });
        
        // Check for cancellation after waiting
        if (cancelled || !isSocketConnected(socketId)) {
          console.log(`[newDiscogsAPIRequest] Job cancelled after 500 error wait for socket ${socketId}`);
          return firstResponse || { releases: allReleases, pagination: { pages: totalPages } };
        }
        
        continue;
      }

      sendLogMessageToSession(`Discogs API error: ${err.response?.data?.message || err.message}`, socketId);
      throw new Error(`Discogs API error: ${err.response?.data?.message || err.message}`);
    }
  }

  // If we paginated, return all releases as an array
  if (allReleases.length > 0) {
    // Final status update (done)
    sendStatusToSession({
      status: "in progress",
      progress: { currentIndex: totalPages, total: totalPages }
    }, socketId);
    return { releases: allReleases };
  }
  // Otherwise, return the first response (non-paginated)
  return firstResponse;
}

async function getAllArtistReleaseVideos(discogsId, oauthToken, oauthVerifier, socketId, cancelled = false) {
  // Check if socket is still connected before starting
  if (!isSocketConnected(socketId)) {
    console.log(`[getAllArtistReleaseVideos] Socket ${socketId} disconnected, aborting`);
    return;
  }

  let artistReleases = [];
  try {
    artistReleases = await getAllArtistReleases(artistId = discogsId, oauthToken, oauthVerifier, socketId, cancelled);
    sendLogMessageToSession(`getAllArtistReleases returned ${Array.isArray(artistReleases) ? artistReleases.length : 'unknown'} releases`, socketId);
  } catch (error) {
    sendLogMessageToSession(`Error fetching artist releases: ${error.message}`, socketId);
    return res.status(500).json({ error: error.message });
  }

  // Check again before proceeding to video fetching
  if (!isSocketConnected(socketId)) {
    console.log(`[getAllArtistReleaseVideos] Socket ${socketId} disconnected during video fetching, aborting`);
    return;
  }

  let artistVideos = [];
  try {
    artistVideos = await getAllReleaseVideos(artistReleases, oauthToken, socketId, cancelled);
    sendLogMessageToSession(`Fetched artist videos: ${artistVideos['totalVideoCount']} videos`, socketId);
  } catch (error) {
    sendLogMessageToSession(`Error fetching artist videos: ${error.message}`, socketId);
  }
  sendResultsToSession(artistVideos, socketId);
  
  // Clean up the job when completed
  if (activeJobs.has(socketId)) {
    activeJobs.delete(socketId);
  }
}

async function getAllArtistReleases(artistId, oauthToken, oauthVerifier, socketId, cancelled = false) {
  try {
    devLog(`[getAllArtistReleases] Start: artistId=${artistId}, oauthToken=${oauthToken ? '[provided]' : '[none]'}, oauthVerifier=${oauthVerifier ? '[provided]' : '[none]'}`);
    let allReleases = [];
    let url = `${DISCOGS_API_URL}/artists/${artistId}/releases`;
    let retryCount = 0;

    try {
      // Check for cancellation before making the request
      if (cancelled) {
        console.log(`[getAllArtistReleases] Job cancelled for socket ${socketId}`);
        return allReleases;
      }

      devLog(`[getAllArtistReleases] Fetching: ${url}`);
      const response = await newDiscogsAPIRequest(url, oauthToken, socketId, cancelled);

      // Check for cancellation after the request
      if (cancelled) {
        console.log(`[getAllArtistReleases] Job cancelled for socket ${socketId}`);
        return allReleases;
      }

      if (response && response.releases) {
        devLog(`[getAllArtistReleases] Fetched ${response.releases.length} releases from current page.`);
        allReleases = allReleases.concat(response.releases);
      } else {
        devLog(`[getAllArtistReleases] No releases found in response.`);
      }

      url = response.pagination?.urls?.next || null;
      if (url) {
        devLog(`[getAllArtistReleases] Next page URL: ${url}`);
      } else {
        devLog(`[getAllArtistReleases] No more pages.`);
      }
      retryCount = 0;
    } catch (error) {
      console.error(`[getAllArtistReleases] Error: ${error.message}`);
      throw error;
    }
    devLog(`[getAllArtistReleases] Done. Total releases fetched: ${allReleases.length}`);
    return allReleases;
  } catch (err) {
    console.error('[getAllArtistReleases] error:', err.message);
    return [];
  }
}

async function getAllReleaseVideos(artistReleases, oauthToken, socketId, cancelled = false) {

  // Map all videos by releaseId and videoId 
  const allVideos = {};
  let addedCount = 0;

  // Process releases sequentially, not in parallel
  for (let i = 0; i < artistReleases.length; i++) {
    // Check for cancellation at the start of each iteration
    if (cancelled) {
      console.log(`[getAllReleaseVideos] Job cancelled for socket ${socketId}`);
      return allVideos;
    }
    
    // Also check if socket is still connected
    if (!isSocketConnected(socketId)) {
      console.log(`[getAllReleaseVideos] Socket ${socketId} disconnected, aborting`);
      return allVideos;
    }

    const release = artistReleases[i];
    sendLogMessageToSession(`${i + 1}/${artistReleases.length} Fetching videos for release ${release.main_release || release.id}`, socketId);

    // Send status update before fetching videos for this release
    sendStatusToSession({
      status: "In progress",
      progress: {
        currentVideoIndex: i + 1,
        totalVideoPages: artistReleases.length,
        videos: addedCount
      }
    }, socketId);

    try {
      // get release ID
      const releaseId = release.main_release || release.id;
      if (!releaseId) continue;

      // get release URL and data
      const releaseUrl = `${DISCOGS_API_URL}/releases/${releaseId}`;
      const releaseData = await newDiscogsAPIRequest(releaseUrl, oauthToken, socketId, cancelled);

      // If release has videos, process them
      if (releaseData && Array.isArray(releaseData.videos) && releaseData.videos.length > 0) {

        // If releaseId is not already in allVideos, create it
        if (!allVideos[releaseId]) {
          allVideos[releaseId] = {};
        }

        const labelsAndCompanies = extractLabelsAndCompanies(releaseData);
        const country = releaseData.country || '';
        const genres = Array.isArray(releaseData.genres) ? releaseData.genres : [];
        const styles = Array.isArray(releaseData.styles) ? releaseData.styles : [];
        const masterId = typeof releaseData.master_id === 'number' ? releaseData.master_id : (releaseData.master_id || null);
        const isMasterRelease = !releaseData.master_id;

        // Loop through each video in the release
        for (const video of releaseData.videos) {
          // Extract videoId from the video URI
          const videoId = video.uri.split("v=")[1];

          // Only add if this videoId is not already present for this release
          if (!allVideos[releaseId][videoId]) {
            // Extract release type from formats
            const releaseType = extractReleaseType(releaseData);

            allVideos[releaseId][videoId] = {
              releaseId,
              releaseTitle: releaseData.title,
              artist: releaseData.artists_sort || (releaseData.artists && releaseData.artists[0]?.name) || '',
              year: releaseData.year || '',
              releaseType: releaseType,
              discogsUrl: releaseData.uri || `https://www.discogs.com/release/${releaseId}`,
              videoId,
              fullUrl: video.uri,
              title: video.title,
              labelsAndCompanies,
              country,
              genres,
              styles,
              masterId,
              isMasterRelease,
            };
            addedCount++;
            // Send updated allVideos to session after each addition
            sendVideosToSession(allVideos, socketId);
          }
        }

        sendLogMessageToSession(`Found ${addedCount} new videos for ${releaseId}`, socketId);
      } else {
        sendLogMessageToSession(`[Found 0 videos for ${releaseId}`, socketId);
      }

    } catch (err) {
      console.error(`[getAllReleaseVideos] Error fetching release ${release.id}: ${err}`);
      sendLogMessageToSession(`Error fetching release ${release.id}: ${err.message}`, socketId);
      throw err;
    }
  }

  // Final status update after all releases processed
  sendStatusToSession({
    status: "Done",
    progress: {
      currentVideoIndex: artistReleases.length,
      totalVideoPages: artistReleases.length,
      videos: addedCount
    }
  }, socketId);

  // Add total addedCount of videos to allVideos object
  allVideos['totalVideoCount'] = addedCount

  // Send final allVideos object to session
  sendVideosToSession(allVideos, socketId);

  return allVideos;
}

async function getAllLabelReleaseVideos(discogsId, oauthToken, oauthVerifier, socketId, cancelled = false){
  // Check if socket is still connected before starting
  if (!isSocketConnected(socketId)) {
    console.log(`[getAllLabelReleaseVideos] Socket ${socketId} disconnected, aborting`);
    return;
  }

  // Get all releases from the label
  let labelReleases = [];
  try {
    labelReleases = await getAllDiscogsLabelReleases(discogsId, oauthToken, oauthVerifier, socketId, cancelled);
    sendLogMessageToSession(`getAllDiscogsLabelReleases returned ${Array.isArray(labelReleases) ? labelReleases.length : 'unknown'} releases`, socketId);
  } catch (error) {
    sendLogMessageToSession(`Error fetching label releases: ${error.message}`, socketId);
    return res.status(500).json({ error: error.message });
  }
  
  // Check again before proceeding to video fetching
  if (!isSocketConnected(socketId)) {
    console.log(`[getAllLabelReleaseVideos] Socket ${socketId} disconnected during video fetching, aborting`);
    return;
  }
  
  // Get all videos from all label releases
  let labelVideos = [];
  try {
    labelVideos = await getAllReleaseVideos(labelReleases, oauthToken, socketId, cancelled);
    sendLogMessageToSession(`Fetched label videos: ${labelVideos['totalVideoCount']} videos`, socketId);
  } catch (error) {
    sendLogMessageToSession(`Error fetching label videos: ${error.message}`, socketId);
    return res.status(500).json({ error: error.message });
  }
  sendResultsToSession(labelVideos, socketId);
  
  // Clean up the job when completed
  if (activeJobs.has(socketId)) {
    activeJobs.delete(socketId);
  }
} 

async function getAllDiscogsLabelReleases(discogsId, oauthToken, oauthVerifier, socketId, cancelled = false) {
  // Check for cancellation before making the request
  if (cancelled) {
    console.log(`[getAllDiscogsLabelReleases] Job cancelled for socket ${socketId}`);
    return [];
  }

  const apiUrl = `https://api.discogs.com/labels/${discogsId}/releases`;
  const response = await newDiscogsAPIRequest(apiUrl, oauthToken, socketId, cancelled);
  
  // Check for cancellation after the request
  if (cancelled) {
    console.log(`[getAllDiscogsLabelReleases] Job cancelled for socket ${socketId}`);
    return [];
  }
  
  // Always return the releases array if present, otherwise fallback to response
  return response && Array.isArray(response.releases) ? response.releases : response;
}

async function getAllListVideos(discogsId, oauthToken, oauthVerifier, socketId) {
  try {
    // Fetch the list data from Discogs API
    const listUrl = `https://api.discogs.com/lists/${discogsId}`;
    const headers = { 'User-Agent': USER_AGENT };
    const response = await axios.get(listUrl, { headers });
    const listData = response.data;

    if (!listData.items || !Array.isArray(listData.items)) {
      sendLogMessageToSession(`No items found in list ${discogsId}`, socketId);
      sendVideosToSession({}, socketId);
      return {};
    }

    // Prepare to collect all videos
    const allVideos = {};
    let addedCount = 0;

    // Iterate over each item in the list
    for (let i = 0; i < listData.items.length; i++) {
      const item = listData.items[i];
      if (item.type === 'release' && item.id) {
        sendLogMessageToSession(`Fetching videos for release ${item.id} (${item.display_title})`, socketId);

        // Fetch release data
        try {
          const releaseUrl = `https://api.discogs.com/releases/${item.id}`;
          const releaseRes = await axios.get(releaseUrl, { headers });
          const releaseData = releaseRes.data;

          // If release has videos, process them
          if (releaseData.videos && Array.isArray(releaseData.videos) && releaseData.videos.length > 0) {
            if (!allVideos[item.id]) {
              allVideos[item.id] = {};
            }
            const labelsAndCompanies = extractLabelsAndCompanies(releaseData);
            const country = releaseData.country || '';
            const genres = Array.isArray(releaseData.genres) ? releaseData.genres : [];
            const styles = Array.isArray(releaseData.styles) ? releaseData.styles : [];
            const masterId = typeof releaseData.master_id === 'number' ? releaseData.master_id : (releaseData.master_id || null);
            const isMasterRelease = !releaseData.master_id;
            for (const video of releaseData.videos) {
              const videoId = video.uri.split("v=")[1];
              if (!allVideos[item.id][videoId]) {
                // Extract release type from formats
                const releaseType = extractReleaseType(releaseData);

                allVideos[item.id][videoId] = {
                  releaseId: item.id,
                  releaseTitle: releaseData.title,
                  artist: releaseData.artists_sort || (releaseData.artists && releaseData.artists[0]?.name) || '',
                  year: releaseData.year || '',
                  releaseType: releaseType,
                  discogsUrl: releaseData.uri || item.uri,
                  videoId,
                  fullUrl: video.uri,
                  title: video.title,
                  labelsAndCompanies,
                  country,
                  genres,
                  styles,
                  masterId,
                  isMasterRelease,
                };
                addedCount++;
              }
            }
            sendLogMessageToSession(`Found ${releaseData.videos.length} videos for release ${item.id}`, socketId);
          } else {
            sendLogMessageToSession(`No videos found for release ${item.id}`, socketId);
          }
        } catch (err) {
          sendLogMessageToSession(`Error fetching release ${item.id}: ${err.message}`, socketId);
        }
      }
      // Emit progress status
      sendStatusToSession({
        status: "In progress",
        progress: {
          currentVideoIndex: i + 1,
          totalVideoPages: listData.items.length,
          videos: addedCount
        }
      }, socketId);
      // Emit intermediate results
      sendVideosToSession(allVideos, socketId);
    }

    // Final status update
    sendStatusToSession({
      status: "Done",
      progress: {
        currentVideoIndex: listData.items.length,
        totalVideoPages: listData.items.length,
        videos: addedCount
      }
    }, socketId);

    // Add totalVideoCount to allVideos object
    allVideos['totalVideoCount'] = addedCount;
    sendVideosToSession(allVideos, socketId);

    return allVideos;
  } catch (err) {
    sendLogMessageToSession(`Error fetching list videos: ${err.message}`, socketId);
    sendVideosToSession({}, socketId);
    return {};
  }
}

// Fetch all videos from a single release
      async function fetchReleaseVideos(releaseId, oauthToken, socketId) {
        try {
          sendLogMessageToSession(`Fetching videos for release ${releaseId}`, socketId);

          // Fetch release data from Discogs API
          const releaseUrl = `${DISCOGS_API_URL}/releases/${releaseId}`;
          const releaseData = await newDiscogsAPIRequest(releaseUrl, oauthToken, socketId, false);

          const videos = [];
          if (releaseData && Array.isArray(releaseData.videos) && releaseData.videos.length > 0) {
        for (const video of releaseData.videos) {
          const videoId = video.uri.split("v=")[1];
          // Extract release type from formats
          const releaseType = extractReleaseType(releaseData);
          const labelsAndCompanies = extractLabelsAndCompanies(releaseData);
          const country = releaseData.country || '';
          const genres = Array.isArray(releaseData.genres) ? releaseData.genres : [];
          const styles = Array.isArray(releaseData.styles) ? releaseData.styles : [];
          const masterId = typeof releaseData.master_id === 'number' ? releaseData.master_id : (releaseData.master_id || null);
          const isMasterRelease = !releaseData.master_id;

          videos.push({
            releaseId,
            releaseTitle: releaseData.title,
            artist: releaseData.artists_sort || (releaseData.artists && releaseData.artists[0]?.name) || '',
            year: releaseData.year || '',
            releaseType: releaseType,
            discogsUrl: releaseData.uri || `https://www.discogs.com/release/${releaseId}`,
            videoId,
            fullUrl: video.uri,
            title: video.title,
            labelsAndCompanies,
            country,
            genres,
            styles,
            masterId,
            isMasterRelease,
          });
        }
        sendLogMessageToSession(`Found ${videos.length} videos for release ${releaseId}`, socketId);
          } else {
        sendLogMessageToSession(`No videos found for release ${releaseId}`, socketId);
          }

          sendVideosToSession({ [releaseId]: videos, totalVideoCount: videos.length }, socketId);
          return videos;
        } catch (err) {
          sendLogMessageToSession(`Error fetching release ${releaseId}: ${err.message}`, socketId);
          sendVideosToSession({ [releaseId]: [], totalVideoCount: 0 }, socketId);
          return [];
        }
      }

// Endpoint that receives discogs api request (requestId and auth info) from the frontend and returns results
app.post('/discogs/api', async (req, res) => {
  devLog("[POST /discogs/api] Hit: ", req.body);
  const { discogsType, discogsId, oauthToken, oauthVerifier, socketId } = req.body;
  devLog(`discogsType=${discogsType}, discogsId=${discogsId}, oauthToken=${oauthToken}, oauthVerifier=${oauthVerifier}, socketId=${socketId}`);

  // Check if socket is still connected
  const target = socketId && io.sockets.sockets.get(socketId);
  if (!target || !target.connected) {
    return res.status(400).json({ error: 'Socket not connected' });
  }

  // Create a cancellation token for this job
  let cancelled = false;
  const cancelJob = () => {
    cancelled = true;
    console.log(`[Discogs API] Job cancelled for socket ${socketId}`);
  };

  // Register the job
  activeJobs.set(socketId, { cancel: cancelJob, type: 'discogs', discogsType, discogsId });

  try {
    if (discogsType == 'artist') {
      sendLogMessageToSession(`Calling getAllArtistReleases with artistId=${discogsId}`, socketId);
      getAllArtistReleaseVideos(discogsId, oauthToken, oauthVerifier, socketId, cancelled);
    } else if (discogsType == 'label') {
      getAllLabelReleaseVideos(discogsId, oauthToken, oauthVerifier, socketId, cancelled);
    }else if(discogsType == 'release'){
      

      // Call the fetchReleaseVideos method
      fetchReleaseVideos(discogsId, oauthToken, socketId);
    }else if (discogsType == 'list'){
      getAllListVideos(discogsId, oauthToken, oauthVerifier, socketId);
    }
    res.status(200).json({ status: 'Processing started' });

  } catch (err) {
    sendLogMessageToSession(`Error: ${err.message}`, socketId);

    res.status(500).json({ error: err.message });
  }
});

app.post('/listogs/discogs/list-images', async (req, res) => {
  let cancelled = false;

  try {
    const { listId, socketId, oauthToken } = req.body || {};
    const sessionDiscogsAuth = req.session?.discogsAuth;
    const effectiveOauthToken = oauthToken || sessionDiscogsAuth?.accessToken || null;

    if (!listId) {
      return res.status(400).json({ error: 'listId is required' });
    }

    if (!socketId) {
      return res.status(400).json({ error: 'socketId is required for progress updates' });
    }

    if (!isSocketConnected(socketId)) {
      return res.status(400).json({ error: 'Socket not connected' });
    }

    const headers = { 'User-Agent': USER_AGENT };
    const listUrl = `https://api.discogs.com/lists/${listId}`;

    sendStatusToSession({
      task: 'imageZip',
      status: 'Fetching list metadata',
      progress: null,
      listId
    }, socketId);

    let listData;
    try {
      listData = await newDiscogsAPIRequest(listUrl, effectiveOauthToken, socketId, cancelled);
    } catch (error) {
      logger.error(`[List Images] Failed to fetch list ${listId}:`, error.message);
      sendStatusToSession({
        task: 'imageZip',
        status: 'Image extraction failed',
        error: `Failed to fetch list ${listId}`,
        listId
      }, socketId);
      return res.status(500).json({ error: 'Failed to fetch Discogs list metadata.' });
    }

    const listItems = Array.isArray(listData?.items)
      ? listData.items.filter(item => item && item.type === 'release' && item.id)
      : [];

    if (listItems.length === 0) {
      sendStatusToSession({
        task: 'imageZip',
        status: 'No releases found in list',
        progress: { current: 0, total: 0 },
        listId
      }, socketId);
      return res.status(400).json({ error: 'No releases found in the specified Discogs list.' });
    }

    const listName = listData.name || '';
    const totalReleases = listItems.length;

    sendStatusToSession({
      task: 'imageZip',
      status: 'Downloading release images',
      progress: { current: 0, total: totalReleases, downloaded: 0 },
      listId,
      listName
    }, socketId);

    let zip = null;
    let downloadedCount = 0;
    const cancelJob = () => {
      cancelled = true;
      console.log(`[List Images] Cancel requested for socket ${socketId}`);
    };

    if (socketId) {
      activeJobs.set(socketId, { cancel: cancelJob, type: 'imageZip', listId });
    }

    try {
      const tempZip = new JSZip();
      const usedNames = new Set();

      for (let index = 0; index < listItems.length; index++) {
        const item = listItems[index];

        if (!isSocketConnected(socketId)) {
          logger.warn(`[List Images] Socket ${socketId} disconnected during extraction, aborting.`);
          throw Object.assign(new Error('Socket disconnected during image extraction.'), { statusCode: 499 });
        }
        if (cancelled) {
          throw Object.assign(new Error('Image extraction cancelled.'), { statusCode: 499 });
        }

        sendStatusToSession({
          task: 'imageZip',
          status: `Processing release ${index + 1} of ${totalReleases}`,
          progress: { current: index, total: totalReleases, downloaded: downloadedCount },
          listId,
          listName,
          currentRelease: item.display_title || item.title || item.id
        }, socketId);

        try {
          const releaseUrl = `https://api.discogs.com/releases/${item.id}`;
          const releaseData = await newDiscogsAPIRequest(releaseUrl, effectiveOauthToken, socketId, cancelled) || {};
          if (cancelled) {
            throw Object.assign(new Error('Image extraction cancelled.'), { statusCode: 499 });
          }
          const images = Array.isArray(releaseData.images) ? releaseData.images : [];

          if (!images.length) {
            sendLogMessageToSession(`No images found for release ${item.id}`, socketId);
          } else {
            const primaryImage = images.find(img => img && img.type === 'primary' && img.uri) || images[0];

            if (primaryImage && primaryImage.uri) {
              try {
                const imageResponse = await axios.get(primaryImage.uri, {
                  responseType: 'arraybuffer',
                  headers
                });

                const contentType = imageResponse.headers['content-type'];
                const extension = getExtensionFromContentType(contentType, primaryImage.uri);
                const releaseTitle = sanitizeForFilename(releaseData.title || item.display_title || `release-${item.id}`, `release-${item.id}`);
                const baseName = `${item.id}-${releaseTitle}`;
                let filename = `${baseName}.${extension}`;
                let dedupeIndex = 1;
                while (usedNames.has(filename)) {
                  dedupeIndex += 1;
                  filename = `${baseName}-${dedupeIndex}.${extension}`;
                }
                usedNames.add(filename);

                tempZip.file(filename, imageResponse.data);
                downloadedCount += 1;
                sendLogMessageToSession(`Added image for ${releaseTitle} (${item.id})`, socketId);
              } catch (imageErr) {
                logger.warn(`[List Images] Failed to download image for release ${item.id}:`, imageErr.message);
                sendLogMessageToSession(`Failed to download image for release ${item.id}: ${imageErr.message}`, socketId);
              }
            } else {
              sendLogMessageToSession(`No downloadable image found for release ${item.id}`, socketId);
            }
          }
        } catch (releaseErr) {
          logger.warn(`[List Images] Failed to fetch release ${item.id}:`, releaseErr.message);
          sendLogMessageToSession(`Failed to fetch release ${item.id}: ${releaseErr.message}`, socketId);
        }

        sendStatusToSession({
          task: 'imageZip',
          status: `Processing release ${Math.min(index + 1, totalReleases)} of ${totalReleases}`,
          progress: { current: index + 1, total: totalReleases, downloaded: downloadedCount },
          listId,
          listName
        }, socketId);
      }

      zip = tempZip;
    } catch (loopError) {
      logger.error('[List Images] Extraction aborted:', loopError);
      sendStatusToSession({
        task: 'imageZip',
        status: 'Image extraction failed',
        error: loopError.message || 'Extraction interrupted',
        listId,
        listName
      }, socketId);
      const statusCode = loopError.statusCode || 500;
      return res.status(statusCode).json({ error: loopError.message || 'Failed to complete extraction.' });
    }

    if (downloadedCount === 0) {
      sendStatusToSession({
        task: 'imageZip',
        status: 'No images available to download',
        progress: { current: totalReleases, total: totalReleases, downloaded: downloadedCount },
        listId,
        listName
      }, socketId);
      return res.status(404).json({ error: 'No images were found for releases in this list.' });
    }

    sendStatusToSession({
      task: 'imageZip',
      status: 'Preparing download',
      progress: { current: totalReleases, total: totalReleases, downloaded: downloadedCount },
      listId,
      listName
    }, socketId);

    if (!zip) {
      throw new Error('Unable to prepare image archive.');
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    sendStatusToSession({
      task: 'imageZip',
      status: 'Image archive ready',
      progress: { current: totalReleases, total: totalReleases, downloaded: downloadedCount },
      listId,
      listName
    }, socketId);

    const safeListName = sanitizeForFilename(listName, `discogs-list-${listId}`);
    const listIdStr = String(listId);
    const baseName = safeListName && safeListName.includes(listIdStr)
      ? safeListName
      : `${safeListName || 'discogs-list'}-${listIdStr}`;
    const fileName = `${baseName}-images.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
    if (socketId) {
      activeJobs.delete(socketId);
    }
  } catch (err) {
    logger.error('[List Images] Unexpected error:', err);
    if (req.body && req.body.socketId) {
      sendStatusToSession({
        task: 'imageZip',
        status: 'Image extraction failed',
        error: err.message
      }, req.body.socketId);
    }
    res.status(500).json({ error: 'Failed to generate image archive.' });
  } finally {
    if (req.body?.socketId && activeJobs.get(req.body.socketId)?.type === 'imageZip') {
      activeJobs.delete(req.body.socketId);
    }
  }
});