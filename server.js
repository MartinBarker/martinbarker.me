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

// YouTube configuration
const TOKEN_PATH = 'tokens.json';
const LINKS_JSON_PATH = 'youtube_links.json';

let oauth2Client = null;
let youtube = null;
let signInUrl = null;

const authStatus = { isAuthenticated: false }; // Track authentication status

let discogsConsumerKey = '';
let discogsConsumerSecret = '';

// Centralized function to generate the redirect URI
function getRedirectUri() {
  return localCallback;
}

// Function to determine the redirect URL based on the environment
function getRedirectUrl() {
  if (process.env.NODE_ENV === 'production') {
    return 'https://jermasearch.com/discogs2youtube';
  }
  return 'http://localhost:3001/discogs2youtube'; // Redirect to local /discogs2youtube route
}

function getDiscogsRediurectUrl() {
  if (process.env.NODE_ENV === 'production') {
    return 'https://jermasearch.com/discogs2youtube/callback/discogs';
  }
  return 'http://localhost:3030/discogs2youtube/callback/discogs';
}

// Centralized function to initialize the OAuth2 client
function initializeOAuthClient(clientId, clientSecret) {
  const redirectUri = localCallback; // Use centralized variable
  console.log('\nClient ID:', clientId);
  console.log('\nClient Secret:', clientSecret);
  console.log('\nRedirect URI:', redirectUri);
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
  let clientId, clientSecret;

  if (process.env.NODE_ENV === 'production') {
    console.log('\nRunning in production, fetching GCP credentials from AWS Secrets Manager...');
    const secrets = await getAwsSecret("gcpCredentials");
    const secretsJson = JSON.parse(secrets);
    clientId = secretsJson.GCP_CLIENT_ID;
    clientSecret = secretsJson.GCP_CLIENT_SECRET;

    const youtubeSecretsJson = await getAwsSecret('youtubeSecrets');
    const discogsSecretsJson = await getAwsSecret('discogsAuth');
    
    process.env.GCP_CLIENT_ID = youtubeSecretsJson.GCP_CLIENT_ID;
    process.env.GCP_CLIENT_SECRET = youtubeSecretsJson.GCP_CLIENT_SECRET;

    discogsConsumerKey = discogsSecretsJson.DISCOGS_CONSUMER_KEY;
    discogsConsumerSecret = discogsSecretsJson.DISCOGS_CONSUMER_SECRET;
  } else {
    console.log('\nRunning locally, using GCP credentials from .env file...');
    clientId = process.env.GCP_CLIENT_ID;
    clientSecret = process.env.GCP_CLIENT_SECRET;

    process.env.GCP_CLIENT_ID = process.env.GCP_CLIENT_ID || '';
    process.env.GCP_CLIENT_SECRET = process.env.GCP_CLIENT_SECRET || '';

    discogsConsumerKey = process.env.DISCOGS_CONSUMER_KEY || '';
    discogsConsumerSecret = process.env.DISCOGS_CONSUMER_SECRET || '';
  }

  if (!clientId || !clientSecret) {
    throw new Error('Missing GCP_CLIENT_ID or GCP_CLIENT_SECRET');
  }

  oauth2Client = initializeOAuthClient(clientId, clientSecret);
  youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client,
  });

  signInUrl = generateSignInUrl(oauth2Client);
  console.log('\nSign-in URL generated:', signInUrl, '\n');
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

// Route to handle the production callback URL
app.get('/youtube/callback', (req, res) => {
  console.log("📺 [GET /youtube/callback] Hit:", req.originalUrl);
  if (process.env.NODE_ENV !== 'production') {
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
    return res.status(400).json({ error: 'No query provided.' });
  } 

  if (query.startsWith('[l') && query.endsWith(']')) {
    // Label ID
    const labelId = query.slice(2, -1);
    res.status(200).json({ type: 'label', id: `label:${labelId}` });
  } else if (query.startsWith('[a') && query.endsWith(']')) {
    // Artist ID
    const artistId = query.slice(2, -1);
    try {
      const url = `${DISCOGS_API_URL}/artists/${artistId}`;
      console.log(`Fetching Discogs artist data from URL: ${url}`);
      let headers = { 'User-Agent': USER_AGENT };
      // If user is signed in, include OAuth header
      if (discogsAuth.accessToken) {
        const oauthSignature = `${discogsConsumerSecret}&${discogsAuth.accessTokenSecret}`;
        headers['Authorization'] = `OAuth oauth_consumer_key="${discogsConsumerKey}", oauth_token="${discogsAuth.accessToken}", oauth_signature="${oauthSignature}", oauth_signature_method="PLAINTEXT"`;
      }
      const response = await axios.get(url, { headers });
      console.log('Discogs API Response:', response.data); // Log full response
      res.status(200).json({
        type: 'artist',
        id: `artist:${artistId}`,
        apiResponse: response.data, // Include API response for UI display
      });
    } catch (error) {
      console.error('Error fetching Discogs artist data:', error.message);
      res.status(500).json({ error: 'Failed to fetch artist data from Discogs.' });
    }
  } else if (query.startsWith('https://www.discogs.com/lists/')) {
    // List URL
    const listId = query.split('/').pop();
    res.status(200).json({ type: 'list', id: `list:${listId}` });
  } else {
    res.status(400).json({ error: 'Invalid query format.' });
  }
});

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

// Generate the Discogs sign-in URL
app.get('/discogs/generateURL', async (req, res) => {
  console.log("🔐 [GET /discogs/generateURL] Hit");
  try {
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
app.get('/discogs2youtube/callback/discogs', async (req, res) => {
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

    const redirectUrl = 'http://localhost:3001/discogs2youtube';
    res.redirect(redirectUrl);
  } catch (error) {
    logError('Discogs OAuth Flow', error, details);
    
    // Redirect to error page or main page with error param
    res.redirect('http://localhost:3001/discogs2youtube?error=' + encodeURIComponent(error.message));
  }
});

// Endpoint to check Discogs authentication status
app.get('/discogs/authStatus', (req, res) => {
  console.log("✅ [GET /discogs/authStatus] Hit");
  const isAuthenticated = !!discogsAuth.accessToken;
  res.status(200).json({ isAuthenticated });
});

// Start server and initialize OAuth
app.listen(port, async () => {
  try {
    await initializeOAuth();
    if (loadTokens()) {
      console.log('Using existing tokens for authentication.');
    } else {
      console.log('No tokens found. Please visit the sign-in URL to authenticate.');
    }
    console.log(`Server is running on port ${port}`);
  } catch (error) {
    console.error("Failed to start server:", error);
  }
});

// Fetch AWS secret
async function getAwsSecret(secretName) {
  try {
    const awsClient = new SecretsManagerClient({ region: "us-west-2" });
    const response = await awsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      }),
    );
    return response.SecretString;
  } catch (error) {
    console.error(`Error getting AWS secret: ${error}`);
    throw error;
  }
}

async function setSecrets() {
  console.log('setSecrets()');
  try {
    const envFilePath = `${__dirname}/.env`;
    const isLocalEnvFile = fs.existsSync(envFilePath);
    console.log('isLocalEnvFile=', isLocalEnvFile);

    if (isLocalEnvFile) {
      require('dotenv').config({ path: envFilePath });
      algoliaApplicationId = process.env.ALGOLIA_APPLICATION_ID || '';
      algoliaApiKey = process.env.ALGOLIA_API_KEY || '';
      algoliaIndex = process.env.ALGOLIA_INDEX || '';
      gmailAppPassword = process.env.GMAIl_APP_PASSWORD || '';
      gcpClientId = process.env.GCP_CLIENT_ID || '';
      gcpClientSecret = process.env.GCP_CLIENT_SECRET || '';
      console.log('Local environment variables loaded.');
    } else {
      try {
        const algoliaSecrets = await getAwsSecret("algoliaDbDetails");
        const algoliaSecretsJson = JSON.parse(algoliaSecrets);
        algoliaApplicationId = algoliaSecretsJson.ALGOLIA_APPLICATION_ID || '';
        algoliaApiKey = algoliaSecretsJson.ALGOLIA_API_KEY || '';
        algoliaIndex = algoliaSecretsJson.ALGOLIA_INDEX || '';
        gmailAppPassword = algoliaSecretsJson.GMAIl_APP_PASSWORD || '';

        const youtubeSecrets = await getAwsSecret("youtubeAuth");
        const youtubeSecretsJson = JSON.parse(youtubeSecrets);
        gcpClientId = youtubeSecretsJson.GCP_CLIENT_ID || '';
        gcpClientSecret = youtubeSecretsJson.GCP_CLIENT_SECRET || '';

        const discogsSecretsJson = await getAwsSecret('discogsAuth');
        discogsConsumerKey = discogsSecretsJson.DISCOGS_CONSUMER_KEY;
        discogsConsumerSecret = discogsSecretsJson.DISCOGS_CONSUMER_SECRET;

        console.log('AWS secrets loaded.');
      } catch (awsError) {
        console.warn('Warning: Failed to fetch AWS secrets. Defaulting to empty values.');
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
    console.log("Secrets set successfully.");
  } catch (error) {
    console.error("Error setting secrets:", error);
    // Do not throw the error to allow the server to start
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
      redirect_uri: localCallback // Use centralized variable
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
        localCallback // Use centralized variable
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
      var redirectUrl = localCallback;
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
