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
var gmailAppPassword = "";

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
      gmailAppPassword = process.env.GMAIl_APP_PASSWORD;
    } else {
      const secrets = await getAwsSecret("algoliaDbDetails");
      const secretsJson = JSON.parse(secrets);
      algoliaApplicationId = secretsJson.ALGOLIA_APPLICATION_ID;
      algoliaApiKey = secretsJson.ALGOLIA_API_KEY;
      algoliaIndex = secretsJson.ALGOLIA_INDEX;
      gmailAppPassword = secretsJson.GMAIl_APP_PASSWORD;
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
