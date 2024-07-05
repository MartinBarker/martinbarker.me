const algoliasearch = require("algoliasearch");
const express = require('express');
const cors = require('cors');
const app = express();
const port = 3030;

// Enable CORS for all routes
app.use(cors());

// Retrieve secrets from AWS
async function retrieveSecretsFromAWS() {
  const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
  const secret_name = "algoliaDbIndex_Secret_Name";
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-west-2",
  });
  let response;
  try {
    response = await client.send(
      new GetSecretValueCommand({
        SecretId: secret_name,
        VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
      })
    );
  } catch (error) {
    // For a list of exceptions thrown, see
    // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
    console.error('Error retrieving secret from AWS:', error);
    throw error;
  }
  const secret = response.SecretString;
  console.log('secret = ', secret);
}

retrieveSecretsFromAWS().catch(console.error);

// Fetch data from Algolia database
async function fetchDataFromAlgolia() {
  return new Promise(async function (resolve, reject) {
    try {
      // Setup DB connection creds
      const client = algoliasearch('A91VDJYTFI', 'b0888716139906d969a93dfc0f0aed64');
      const index = client.initIndex('SubtitlesDevIndex');

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
    } catch (error) {
      console.log("fetchDataFromAlgolia() Error: ", error);
      resolve({ "error": error });
    }
  });
}

app.get('/dbtest', async (req, res) => {
  console.log("Making test query");
  let queryResults = await fetchDataFromAlgolia();
  res.send(queryResults);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  // Debugging environment variables
  console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID);
  console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY);
  console.log('AWS_REGION:', process.env.AWS_REGION);
});
