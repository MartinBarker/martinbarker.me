require('dotenv').config();
const { GetSecretValueCommand, SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const algoliasearch = require("algoliasearch");
const express = require('express');
const cors = require('cors');
const app = express();
const port = 3030;

console.log("begin server.js run");

// Enable CORS for all routes
app.use(cors());

var algoliaApplicationId = null;
var algoliaApiKey = "";
var algoliaIndex = "";

// Start server and set secrets
app.listen(port, async () => {
  try {
    await setSecrets();
    console.log(`Server is running on port ${port}`);
  } catch (error) {
    console.error("Failed to start server:", error);
  }
});

// Retrieve secrets from AWS or .env file
async function setSecrets() {
  console.log('setSecrets()')
  try {
    const isLocal = process.env.HOSTNAME === 'localhost';
    console.log('isLocal=', isLocal)
    if (isLocal) {
      // Set secrets using local .env file
      algoliaApplicationId = process.env.ALGOLIA_APPLICATION_ID;
      algoliaApiKey = process.env.ALGOLIA_API_KEY;
      algoliaIndex = process.env.ALGOLIA_INDEX;
    } else {
      // Set secrets using aws connection (only from inside EC2 instance)
      const secrets = await getAwsSecret("algoliaDbDetails");
      const secretsJson = JSON.parse(secrets);
      algoliaApplicationId = secretsJson.ALGOLIA_APPLICATION_ID;
      algoliaApiKey = secretsJson.ALGOLIA_API_KEY;
      algoliaIndex = secretsJson.ALGOLIA_INDEX;
    }
    console.log("Secrets set successfully");
  } catch (error) {
    console.error("Error setting secrets:", error);
    throw error; // Rethrow to handle it in the caller
  }
}

// Fetch secret from AWS secret storage
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
    console.error(`Error getting aws secret: ${error}`);
    throw error; // Rethrow to handle it in the caller
  }
}


// Fetch data from Algolia database
async function fetchDataFromAlgolia(searchTerm) {
  return new Promise(async function (resolve, reject) {
    console.log(`fetchDataFromAlgolia(${searchTerm})`)
    try {

      // Setup Algolia DB connection creds
      const client = algoliasearch(algoliaApplicationId, algoliaApiKey);
      const index = client.initIndex(algoliaIndex);

      // Perform the search
      const { hits } = await index.search(`${searchTerm}`, {
        hitsPerPage: 1000,
      });
      console.log(`Found ${hits.length} hits.`);
      resolve(hits)

    } catch (error) {
      console.log("fetchDataFromAlgolia() Error: ", error);
      reject(error)

    }
  })
}

// Handle get request to algolia search route
app.get('/algolia/search/*', async (req, res) => {
  try {
    let searchTerm = req.path.split('/search/')[1];
    console.log('/algolia/search searchTerm = ', searchTerm);
    let searchResults = await fetchDataFromAlgolia(searchTerm)
    res.send(searchResults);
  } catch (error) {
    res.reject(error)
  }
});