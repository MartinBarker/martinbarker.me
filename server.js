const algoliasearch = require("algoliasearch");
const express = require('express');
const cors = require('cors');
const app = express();
const port = 3030;

// Enable CORS for all routes
app.use(cors());

// Fetch data from Algolia database
async function fetchDataFromAlgolia() {
  return new Promise(async function (resolve, reject) {
    try {
      resolve("wip");
      /*
      // Setup DB connection creds
      const client = algoliasearch('', '');
      const index = client.initIndex('');

      // Perform the search
      index.search('super mario', {
        hitsPerPage: 1000,
      }).then(({ hits }) => {
        console.log(`Found ${hits.length} hits.`);
        resolve({ "search": "completed" });
      }).catch(error => {
        console.log("Error making query: ", error);
        resolve({ "error": error });
      });
      */
    } catch (error) {
      console.log("fetchDataFromAlgolia() Error: ", error);
      resolve({ "error": error });
    }
  });
}

app.get('/fetchSubtitles', async (req, res) => {
  let queryResults = await fetchDataFromAlgolia();
  res.send(queryResults);
});

app.get('/dbtest', async (req, res) => {
  res.send('dbTest route working');
});

// Retrieve secrets from AWS
async function retrieveSecretsFromAWS() {
  return new Promise(async function (resolve, reject) {
    let secretVal = "default";
    try {
        const {GetSecretValueCommand, SecretsManagerClient,} = require("@aws-sdk/client-secrets-manager");
        const client = new SecretsManagerClient();
        const response = await client.send(
          new GetSecretValueCommand({
            SecretId: "algoliaDbIndex_Secret_Name",
          }),
        );
        secretVal = response;
    
    } catch (error) {
      secretVal = `Error getting aws secret: ${error}`
    }
    resolve(secretVal); 
  })
}

app.get('/secretTest', async (req, res) => {
  let awsSecret = await retrieveSecretsFromAWS()
  res.send({ 'awsSecret': awsSecret });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  // Debugging environment variables
  console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID);
  console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY);
  console.log('AWS_REGION:', process.env.AWS_REGION);
});
