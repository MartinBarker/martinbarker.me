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
async function fetchDataFromAlgolia(searchTerm, pageNum=0) {
  return new Promise(async function (resolve, reject) {
    console.log(`fetchDataFromAlgolia(${searchTerm})`)
    try {
      // Setup Algolia DB connection creds
      const client = algoliasearch(algoliaApplicationId, algoliaApiKey);
      const index = client.initIndex(algoliaIndex);

      // Perform the search
      const response = await index.search(`${searchTerm}`, {
        hitsPerPage: 100,
        page: pageNum
      });

      // Fetch results and pagination info
      var hits = response.hits 
      var numberHits = response.nbHits
      var currentPage = response.page+1
      var numberPages = response.nbPages

      console.log(`Received ${hits.length} hits out of ${numberHits} total from page ${currentPage}/${numberPages}`);
      resolve({
        hits:hits,
        numberHits:numberHits,
        currentPage:currentPage,
        numberPages:numberPages
      })

    } catch (error) {
      console.log("fetchDataFromAlgolia() Error: ", error);
      reject(error)
    }
  })
}

// Handle get request to algolia search route
app.get('/algolia/search/:searchPage/:searchTerm', async (req, res) => {
  try {
    const { searchPage, searchTerm } = req.params;
    const decodedSearchTerm = decodeURIComponent(searchTerm);
    console.log('/algolia/search searchPage = ', searchPage);
    console.log('/algolia/search searchTerm = ', decodedSearchTerm);
    let searchResults = await fetchDataFromAlgolia(decodedSearchTerm, parseInt(searchPage, 10));
    res.send(searchResults);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});