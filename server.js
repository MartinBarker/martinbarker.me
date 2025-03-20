require('dotenv').config();
const { GetSecretValueCommand, SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const app = express();
const port = 3030;

app.use(cors());
app.use(express.json()); // To parse JSON bodies

var algoliaApplicationId = null;
var algoliaApiKey = "";
var algoliaIndex = "";
var gmailAppPassword = "";
var oauth2Client = null;

// Start server and set secrets
app.listen(port, async () => {
  try {
    await setSecrets();
    await initYouTubeOauth2ClientSetup();
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

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// YouTube Auth Stuff Begin
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

initYouTubeOauth2ClientSetup();

async function initYouTubeOauth2ClientSetup(){
  oauth2Client = await createOauth2Client()
}

//generate youtube api url. ex: http://localhost:8080/getYtUrl?port=3112
app.get('/getYtUrl', async function (req, res) {
  try{
    let callbackPort = req.query.port;
    //console.log('/getYtUrl callbackPort=',callbackPort)
    var ytApiUrl = await generateUrl(callbackPort);
    res.status(200).json({ url: ytApiUrl });
  }catch(err){
    res.status(400).json({ error: `${err}` });
  }
})

//auth with token, return sanitized oauth2client. ex: http://localhost:8080/getOauth2Client?token=4/0AAAAAA_AAAAA_AAA-AAAA-AAA_BBBB_UQ&scope=https://www.googleapis.com/auth/youtube.upload.
app.get('/getOauth2Client', async function (req, res) {
  try{
    //get token from url http request
    const authToken = req.originalUrl.substring(req.originalUrl.indexOf('token=') + 'token='.length);
    console.log('/getOauth2Client authToken=[',authToken,']')  
    //auth with token
    var userOauth2client = await addTokenToOauth2client(authToken);
    console.log('userOauth2client=',userOauth2client)
    //sanitize
    userOauth2client._clientId = "NAH"
    userOauth2client._clientSecret = "NAH"
    //return 
    res.status(200).json(userOauth2client);
    
  }catch(err){
    res.status(400).json({ error: `${err}` });
  }
})

//authenticate oauth2client with user token
async function addTokenToOauth2client(authToken){
  return new Promise(async function (resolve, reject) {
    try{
      //oauth2Client.redirectUri = 'http://localhost:3001/ytCode';
      var clientoauth2Client = oauth2Client;
      clientoauth2Client.getToken(authToken, function (err, token) {
        if (err) {
            console.log('addTokenToOauth2client() Error trying to retrieve access token', err);
            reject(err);
        }
        clientoauth2Client.credentials = token;
        console.log('\n\n addTokenToOauth2client() done. clientoauth2Client=\n\n',clientoauth2Client,'\n\n')
        resolve(clientoauth2Client);
    })
    }catch(err){
      console.log('addTokenToOauth2client() err:', err)
    }
  })
}

//create oauth2client using local auth.json file 
async function createOauth2Client() {
  return new Promise(async function (resolve, reject) {
    console.log('createOauth2Client()')
    try {
      fs.readFile(`${__dirname}/../static/assets/youtubeAuth/auth.json`, async function processClientSecrets(err, content) {
        if (err) {
          console.log('createOauth2Client() Error loading client secret file: ' + err);
          return;
        }
        console.log('createOauth2Client() read auth.json file fine')
        // Authorize a client with the loaded credentials
        let credentials = JSON.parse(content)
        const clientSecret = credentials.installed.client_secret;
        const clientId = credentials.installed.client_id;
        const redirect_uris = credentials.installed.redirect_uris;
        oauth2Client = new OAuth2(clientId, clientSecret, redirect_uris);
        console.log('createOauth2Client() done')
        resolve(oauth2Client)
      });
    } catch (err) {
      throw(`Error creating Oauth2 Client: ${err}`)
    }
  })
}

//generate youtube auth login url 
async function generateUrl(callbackPort) {
  return new Promise(async function (resolve, reject) {
    try {
      console.log('generateUrl()')
      var redirectUrl = `http://localhost:${callbackPort}/ytCode`
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.upload'],
        redirect_uri: redirectUrl
      });
     
      console.log('generateUrl() Authorize this app by visiting this url: ', authUrl);
      resolve(authUrl)
    } catch (err) {
      throw(`Error generating sign in url: ${err}`)
    }
  })
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// YouTube Auth Stuff End
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~