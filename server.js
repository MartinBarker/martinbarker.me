// To simulate production mode and fetch auth vars from AWS S3:
// On Windows Command Prompt: set NODE_ENV=production
// On Ubuntu/Linux: export NODE_ENV=production

require('dotenv').config();
const { GetSecretValueCommand, SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { google } = require('googleapis');
const readline = require('readline');
const axios = require('axios'); // Ensure axios is imported
const crypto = require('crypto'); // For generating nonces
const querystring = require('querystring'); // For query string manipulation
const app = express();
const port = 3030;

app.use(cors());
app.use(express.json()); // To parse JSON bodies

const localCallback = 'http://localhost:3030/oauth2callback'; // Centralized variable for local callback URI
const prodCallback = "https://www.jermasearch.com/internal-api/oauth2callback"

// Helper function to get the current timestamp in hh:mm:ss format
function getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0]; // Extract hh:mm:ss
}

// Override console.log to include timestamps
const originalLog = console.log;
console.log = (...args) => {
    originalLog(`[${getTimestamp()}]`, ...args);
};

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

var envVar = 'production'; //process.env.NODE_ENV;

// Function to determine the redirect URL based on the environment
function getRedirectUrl() {
  if (isLocal) {
    return 'http://localhost:3030/discogs2youtube/youtube/callback'; // Updated local redirect URL
  }
  return 'https://jermasearch.com/internal-api/discogs2youtube/youtube/callback'; // Updated production redirect URL
}

function getDiscogsRediurectUrl() {
  if (isLocal) {
    return 'http://localhost:3030/discogs2youtube/callback/discogs';
  }
  return 'https://jermasearch.com/internal-api/discogs2youtube/callback/discogs';
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

      // Redirect to /discogs2youtube route
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
app.get('/discogs2youtube/youtube/callback', async (req, res) => {
  console.log("📺 [GET /discogs2youtube/youtube/callback] Hit:", req.originalUrl);

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
    const redirectUrl = isLocal ? 'http://localhost:3001/discogs2youtube' : 'https://jermasearch.com/discogs2youtube';
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('\nError during YouTube authentication:', error.message);
    res.status(500).send('Authentication failed.');
  }
}); 

// Route to handle the production callback URL
app.get('/youtube/callback', (req, res) => {
  console.log("📺 [GET /youtube/callback] Hit:", req.originalUrl);
  if (envVar !== 'production') {
    return res.status(403).send('This route is only available in production.');
  }

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
      if (discogsAuth.accessToken) {
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
        if (type === 'artist') {
            const url = `${DISCOGS_API_URL}/artists/${id}`;
            console.log(`🌐 Fetching Discogs artist data from URL: ${url}`);
            const headers = { 'User-Agent': USER_AGENT };

            if (discogsAuth.accessToken) {
                const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
                headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
            }

            const response = await axios.get(url, { headers });
            const artistName = response.data.name; // Extract artist name
            console.log(`✅ Artist name fetched: ${artistName}`);

            // Start background job for artist
            await startBackgroundJob({ artistId: id, isDevMode, artistName });
            res.status(200).json({ message: `Successfully fetched artist data.`, artistName });
        } else if (type === 'label') {
            const url = `${DISCOGS_API_URL}/labels/${id}`;
            console.log(`🌐 Fetching Discogs label data from URL: ${url}`);
            const headers = { 'User-Agent': USER_AGENT };

            if (discogsAuth.accessToken) {
                const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
                headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
            }

            const response = await axios.get(url, { headers });
            const labelName = response.data.name; // Extract label name
            console.log(`✅ Label name fetched: ${labelName}`);

            // Start background job for label
            await startBackgroundJob({ labelId: id, isDevMode, artistName: labelName });
            res.status(200).json({ message: `Successfully fetched label data.`, labelName });
        } else {
            // Handle list type
            res.status(400).json({ error: 'List type is not yet implemented.' });
        }
    } catch (error) {
        console.error(`❌ Error in /discogsSearch for type ${type}:`, error.message);
        res.status(500).json({ error: `Failed to fetch ${type} data from Discogs.`, details: error.message });
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
                    console.error(`Rate limit hit. Retrying in ${waitTime / 1000} seconds...`);
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
    } else {
      throw new Error('Invalid type provided.');
    }

    console.log(`Fetching Discogs data from URL: ${url}`);
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    // Return only the first item from the response
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

// Function to fetch video IDs for a release
async function fetchVideoIds(releaseId) {
    const url = `${DISCOGS_API_URL}/releases/${releaseId}`;
    const response = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT },
    });
    const videos = response.data.videos?.map((video) => ({
        url: video.uri,
        artist: response.data.artists_sort,
        releaseName: response.data.title,
        releaseId: releaseId,
    })) || [];
    return videos;
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
    console.log('Discogs API Response:', data);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from Discogs.' });
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

let discogsAuth = { accessToken: null, accessTokenSecret: null }; // Store Discogs auth tokens

// Handle the Discogs OAuth callback
app.get('/discogs2youtube/callback/discogs', ensureSecretsInitialized, async (req, res) => {
  console.log("🎸 [GET /discogs2youtube/callback/discogs] Hit", req.originalUrl);
  const details = {
    full_url: req.protocol + '://' + req.get('host') + req.originalUrl,
    query_params: req.query
  };

  try {
    console.log('\n=== Discogs OAuth Flow ===');
    const { oauth_token, oauth_verifier } = req.query;

    if (!oauth_token || !oauth_verifier) {
      throw new Error('Missing oauth_token or oauth_verifier in request');
    }

    console.log('Received tokens:');
    console.log('OAuth Token:', oauth_token);
    console.log('OAuth Verifier:', oauth_verifier);

    // Retrieve the stored oauth_token_secret using the oauth_token
    const storedTokenSecret = discogsRequestTokens[oauth_token];
    if (!storedTokenSecret) {
      throw new Error('No matching token secret found for this oauth_token');
    }

    const oauthNonce = generateNonce();
    const oauthTimestamp = Math.floor(Date.now() / 1000);
    const authHeader = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_nonce="${oauthNonce}", oauth_token="${oauth_token}", oauth_signature="${discogsConsumerSecret}&${storedTokenSecret}", oauth_signature_method="PLAINTEXT", oauth_timestamp="${oauthTimestamp}", oauth_verifier="${oauth_verifier}"`;

    console.log('\nMaking request to Discogs for access token...');
    const DISCOGS_ACCESS_TOKEN_URL = "https://api.discogs.com/oauth/access_token";
    
    const response = await axios.post(DISCOGS_ACCESS_TOKEN_URL, null, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
        'User-Agent': USER_AGENT,
      },
    });

    const { oauth_token: accessToken, oauth_token_secret: accessTokenSecret } = querystring.parse(response.data);

    console.log('\nAccess token received!');
    console.log('Storing tokens and redirecting user...');
    
    // Optionally remove the used request token secret from storage
    delete discogsRequestTokens[oauth_token];

    // Store the tokens (for example, in a global variable or database)
    discogsAuth = { accessToken, accessTokenSecret };

    console.log('Authentication successful');
    console.log('================================\n');

    // Dynamically set the redirect URL based on the environment
    const redirectUrl = isLocal ? 'http://localhost:3001/discogs2youtube' : 'https://jermasearch.com/discogs2youtube';
    res.redirect(redirectUrl);
  } catch (error) {
    logError('Discogs OAuth Flow', error, details);
    
    // Redirect to error page or main page with error param
    const errorRedirectUrl = isLocal ? 'http://localhost:3001/discogs2youtube' : 'https://jermasearch.com/discogs2youtube';
    res.redirect(`${errorRedirectUrl}?error=${encodeURIComponent(error.message)}`);
  }
});

// Endpoint to check Discogs authentication status
app.get('/discogs/authStatus', (req, res) => {
  console.log("✅ [GET /discogs/authStatus] Hit");
  const isAuthenticated = !!discogsAuth.accessToken;
  res.status(200).json({ isAuthenticated });
});

// Add a /signOut endpoint to reset authentication data
app.post('/signOut', (req, res) => {
  console.log("🚪 [POST /signOut] Hit");
  authStatus.isAuthenticated = false;
  discogsAuth = { accessToken: null, accessTokenSecret: null };
  if (oauth2Client) {
    oauth2Client.setCredentials(null); // Clear YouTube credentials
    console.log("YouTube credentials cleared.");
  }
  console.log("Authentication data cleared.");
  res.status(200).send('Signed out successfully.');
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

// Check for local=true argument
const args = process.argv.slice(2);
const isLocal = args.includes('local=true');

if (isLocal) {
  console.log('Running in local mode, loading variables from .env file...');
  require('dotenv').config();
  gcpClientId = process.env.GCP_CLIENT_ID || '';
  gcpClientSecret = process.env.GCP_CLIENT_SECRET || '';
  discogsConsumerKey = process.env.DISCOGS_CONSUMER_KEY || '';
  discogsConsumerSecret = process.env.DISCOGS_CONSUMER_SECRET || '';
}

// Start server and initialize secrets
app.listen(port, async () => {
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
    if (isLocalEnvFile) {
      require('dotenv').config({ path: envFilePath });
      //algoliaApplicationId = process.env.ALGOLIA_APPLICATION_ID || '';
      //algoliaApiKey = process.env.ALGOLIA_API_KEY || '';
      //algoliaIndex = process.env.ALGOLIA_INDEX || '';
      //gmailAppPassword = process.env.GMAIl_APP_PASSWORD || '';
      gcpClientId = process.env.GCP_CLIENT_ID || '';
      gcpClientSecret = process.env.GCP_CLIENT_SECRET || '';
      discogsConsumerKey = process.env.DISCOGS_CONSUMER_KEY || '';
      discogsConsumerSecret = process.env.DISCOGS_CONSUMER_SECRET || '';
      console.log('setSecrets() Local environment variables loaded.');
    } else {
      try {
        //const algoliaSecrets = await getAwsSecret("algoliaDbDetails");
        //const algoliaSecretsJson = JSON.parse(algoliaSecrets);
        //algoliaApplicationId = algoliaSecretsJson.ALGOLIA_APPLICATION_ID || '';
        //algoliaApiKey = algoliaSecretsJson.ALGOLIA_API_KEY || '';
        //algoliaIndex = algoliaSecretsJson.ALGOLIA_INDEX || '';
        //gmailAppPassword = algoliaSecretsJson.GMAIl_APP_PASSWORD || '';

        const youtubeSecrets = await getAwsSecret("youtubeAuth");
        const youtubeSecretsJson = JSON.parse(youtubeSecrets);
        gcpClientId = youtubeSecretsJson.GCP_CLIENT_ID || '';
        gcpClientSecret = youtubeSecretsJson.GCP_CLIENT_SECRET || '';
        
        const discogsSecrets = await getAwsSecret("discogsAuth");
        const discogsSecretsJson = JSON.parse(discogsSecrets);
        discogsConsumerKey = discogsSecretsJson.DISCOGS_CONSUMER_KEY || '';
        discogsConsumerSecret = discogsSecretsJson.DISCOGS_CONSUMER_SECRET || '';

        console.log('setSecrets() AWS secrets loaded.');      } catch (awsError) {
        console.warn('setSecrets() Warning: Failed to fetch AWS secrets. Defaulting to empty values.');
        console.warn('AWS Error:', awsError.message || awsError);
        algoliaApplicationId = '';
        algoliaApiKey = '';
        algoliaIndex = '';
        gmailAppPassword = '';
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
  console.log("🏠 [GET /] Hit");
  res.status(200).send('hello world');
});

// Add this helper function at the top level
function logError(location, error, details = {}) {
  console.error('\n=== Error in', location, '===');
  console.error('Message:', error.message);
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Response data:', error.response.data);
  }
  if (Object.keys(details).length) {
    console.error('Additional details:', details);
  }
  console.error('Stack:', error.stack);
  console.error('================\n');
}

let backgroundJob = {
    isRunning: false,
    isPaused: false,
    progress: { current: 0, total: 0, uniqueLinks: 0 },
    artistId: null,
    labelId: null,
    artistName: null,
    uniqueLinks: new Set(),
    waitTime: 0, // Time to wait before resuming requests
};

app.post('/pauseBackgroundJob', (req, res) => {
    if (!backgroundJob.isRunning) {
        return res.status(400).json({ error: 'No job is currently running.' });
    }
    backgroundJob.isPaused = true;
    res.status(200).json({ message: 'Background job paused.' });
});

app.post('/resumeBackgroundJob', (req, res) => {
    if (!backgroundJob.isRunning) {
        return res.status(400).json({ error: 'No job is currently running.' });
    }
    backgroundJob.isPaused = false;
    res.status(200).json({ message: 'Background job resumed.' });
});

app.post('/stopBackgroundJob', (req, res) => {
    if (!backgroundJob.isRunning) {
        return res.status(400).json({ error: 'No job is currently running.' });
    }
    backgroundJob.isRunning = false;
    backgroundJob.isPaused = false;
    res.status(200).json({ message: 'Background job stopped.' });
});

app.get('/backgroundJobStatus', (req, res) => {
    res.status(200).json({
        progress: backgroundJob.progress,
        error: backgroundJob.error || null,
        waitTime: backgroundJob.waitTime,
        isRunning: backgroundJob.isRunning,
        isPaused: backgroundJob.isPaused,
        artistName: backgroundJob.artistName,
        artistId: backgroundJob.artistId,  // Added artistId to the response
        labelId: backgroundJob.labelId     // Added labelId to the response
    });
});

// Endpoint to fetch unique YouTube links
app.get('/backgroundJobLinks', (req, res) => {
    res.status(200).json({ links: Array.from(backgroundJob.uniqueLinks) });
})

// Enhanced function to return task with complete info even when finished
app.get('/backgroundTasks', (req, res) => {
    console.log("📋 [GET /backgroundTasks] Hit");
    try {
        let taskStatus = 'completed';
        if (backgroundJob.isRunning) {
            taskStatus = 'in-progress';
            if (backgroundJob.waitTime > 0) {
                taskStatus = 'rate-limited';
            } else if (backgroundJob.isPaused) {
                taskStatus = 'paused';
            }
        }
        
        const uniqueLinks = Array.from(backgroundJob.uniqueLinks);
        const tasks = backgroundJob.artistId || backgroundJob.labelId
            ? [
                  {
                      id: backgroundJob.artistId || backgroundJob.labelId,
                      name: backgroundJob.artistName 
                        ? `Artist/Label: ${backgroundJob.artistName}` 
                        : `Task for ${backgroundJob.artistId ? 'artist' : 'label'} ${backgroundJob.artistId || backgroundJob.labelId}`,
                      status: taskStatus,
                      youtubeLinks: uniqueLinks,
                      progress: {
                          current: backgroundJob.progress.current,
                          total: backgroundJob.progress.total,
                          uniqueLinks: uniqueLinks.length  // Use actual length of unique links
                      }
                  },
              ]
            : [];
        
        const shouldPoll = backgroundJob.isRunning;
        res.status(200).json({ tasks, shouldPoll });
    } catch (error) {
        console.error('Error fetching background tasks:', error.message);
        res.status(500).json({ error: 'Failed to fetch background tasks.' });
    }
});

app.post('/clearBackgroundTasks', (req, res) => {
    console.log("🧹 [POST /clearBackgroundTasks] Hit");
    try {
        // Reset the background job state
        backgroundJob = {
            isRunning: false,
            isPaused: false,
            progress: { current: 0, total: 0, uniqueLinks: 0 },
            artistId: null,
            labelId: null,
            artistName: null,
            uniqueLinks: new Set(),
            waitTime: 0,
        };
        res.status(200).json({ message: 'All background tasks cleared.' });
    } catch (error) {
        console.error('Error clearing background tasks:', error.message);
        res.status(500).json({ error: 'Failed to clear background tasks.' });
    }
});