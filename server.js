require('dotenv').config();
const { GetSecretValueCommand, SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const express = require('express');
const cors = require('cors');
const app = express();
const port = 3030;

app.use(cors());
app.use(express.json()); // To parse JSON bodies

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

async function setSecrets() {
  console.log('setSecrets()')
  try {
    const isLocal = process.env.HOSTNAME === 'localhost';
    console.log('isLocal=', isLocal)
    if (isLocal) {
      algoliaApplicationId = process.env.ALGOLIA_APPLICATION_ID;
      algoliaApiKey = process.env.ALGOLIA_API_KEY;
      algoliaIndex = process.env.ALGOLIA_INDEX;
    } else {
      const secrets = await getAwsSecret("algoliaDbDetails");
      const secretsJson = JSON.parse(secrets);
      algoliaApplicationId = secretsJson.ALGOLIA_APPLICATION_ID;
      algoliaApiKey = secretsJson.ALGOLIA_API_KEY;
      algoliaIndex = secretsJson.ALGOLIA_INDEX;
    }
    console.log("Secrets set successfully");
  } catch (error) {
    console.error("Error setting secrets:", error);
    throw error;
  }
}

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
    throw error;
  }
}

async function fetchDataFromAlgolia(searchTerm, pageNum = 0) {
  return new Promise(async function (resolve, reject) {
    console.log(`fetchDataFromAlgolia(${searchTerm})`)
    try {
      const algoliasearch = await import('algoliasearch');
      const client = algoliasearch.default(algoliaApplicationId, algoliaApiKey);
      const index = client.initIndex(algoliaIndex);

      const response = await index.search(`${searchTerm}`, {
        hitsPerPage: 100,
        page: pageNum
      });

      var hits = response.hits
      var numberHits = response.nbHits
      var currentPage = response.page + 1
      var numberPages = response.nbPages

      console.log(`\nReceived ${hits.length} hits out of ${numberHits} total from page ${currentPage}/${numberPages}`);

      resolve({
        hits: hits,
        numberHits: numberHits,
        currentPage: currentPage,
        numberPages: numberPages,

        rawResponse: response
      })

    } catch (error) {
      console.log("fetchDataFromAlgolia() Error: ", error);
      reject(error)
    }
  })
}

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

app.post('/emailContactFormSubmission', async (req, res) => {
  const { body, email } = req.body;
  console.log('Contact form submission received:');
  console.log('Body:', body);
  console.log('Email:', email);

  try {
    const { SMTPClient } = await import("emailjs");

    const client = new SMTPClient({
      user: 'lknsdmartinsxdcn@gmail.com',
      password: 'kwgt dpff mvpc thcv', // Replace with your app password
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
