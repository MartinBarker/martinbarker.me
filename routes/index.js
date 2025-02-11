const express = require('express');
const app = express();
const cors = require('cors');
// Use the cors middleware to allow requests from all origins
app.use(cors({
  origin: '*'
}));

var router = express.Router();
//nodejs virbant color picker extension
var Vibrant = require('node-vibrant');
const { xyzToCIELab } = require('node-vibrant/lib/util');
const Post = require('../database/models/Post.js');
//connect to mongodb
var mongodbutil = require('../static/assets/js/mongodbutils');
var db = mongodbutil.getDb();
require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

var io = require("../server").io;

//spotify auth file
var spotifyAuth = require('../static/assets/js/spotifyAuth');

//global vars
allBlogPosts = []

//view single blog post
app.get('/posts/:id', async (req, res) => {

  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  console.log('displayPosts=', displayPosts)
  //create colorObj
  let colorsObj = await createColorObj(colorData);
  //get post
  let post = null;
  for (var i = 0; i < allBlogPosts.length; i++) {
    if (allBlogPosts[i]['_id'] == req.params.id) {
      post = allBlogPosts[i]
    }
  }

  let postTitle = "Blog Post"
  try {
    postTitle = post.title
  } catch (err) {
    console.log(err)
    postTitle = "Blog Post"
  }

  res.render('post', {
    layout: 'mainTemplate',
    post: post,
    pageTitle: post.title,
    blog: 'active',
    icon: 'https://cdn0.iconfinder.com/data/icons/picons-social/57/53-medium-512.png',
    previewCardTitle: 'Martin Barker',
    previewCardUrl: 'http://www.martinbarker.me',
    previewCardWebsite: 'website',
    previewCardDescription: 'Blog Post',
    previewCardImage: '../static/assets/img/headshot.jpg',
    pageBodyNavTitle: `${post.title}`,
    pageBodyNaavGithub: '',
    postTitle: post.title,
    postDescription: post.description,
    postContent: post.content,
    postDate: post.createdAt,
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,

  })

});

//home route
app.get('/', async function (req, res) {
  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('about', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'martinbarker.me',
    //page tab icon
    icon: "https://cdn0.iconfinder.com/data/icons/picons-social/57/53-medium-512.png",
    previewCardTitle: 'Martin Barker',
    previewCardUrl: 'http://www.martinbarker.me',
    previewCardWebsite: 'website',
    previewCardDescription: '',
    previewCardImage: '../static/assets/img/headshot.jpg',
    //set active current tab
    about: 'active',

    contact: 'active',

    //body content title 
    pageBodyNavTitle: 'martinbarker.me',
    //body content github link
    pageBodyNavGithub: 'https://github.com/MartinBarker/martinbarker.me',
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
})

//projects route
app.get('/projects', async function (req, res) {
  res.redirect('/');
})

//audio-archiver route
app.get('/audio-archiver', async function (req, res) {
  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('audio-archiver', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'audio-archiver',
    //page tab icon
    icon: "../static/assets/img/icon.png",
    previewCardTitle: 'audio-archiver',
    previewCardUrl: 'http://www.martinbarker.me/audio-archiver',
    previewCardWebsite: 'website',
    previewCardDescription: '',
    previewCardImage: '../static/assets/img/headshot.jpg',
    //expand projects tab
    projects: 'active',
    //set active current tab
    audioarchiver: 'active',
    //body content title 
    pageBodyNavTitle: 'audio-archiver',
    //body content github link
    pageBodyNavSrc: "https://github.com/MartinBarker/audio-archiver",
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
})


app.get('/api/:version', function (req, res) {
  res.send(req.params.version);
});

app.get('/login', function (req, res) {
  var scopes = 'user-read-playback-position user-read-currently-playing user-modify-playback-state user-read-playback-state streaming app-remote-control user-library-modify user-library-read playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative';
  var my_client_id = '199c96b7d70f4dd28f188f9c6bc86045';
  var redirect_uri = 'http://localhost:8080/betterspotify';

  res.redirect('https://accounts.spotify.com/authorize' +
    '?response_type=code' +
    '&client_id=' + my_client_id +
    (scopes ? '&scope=' + encodeURIComponent(scopes) : '') +
    '&redirect_uri=' + encodeURIComponent(redirect_uri));

});



//popularify route
app.get('/popularifyOld', async function (req, res) {
  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('popularify', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'popularify.site',
    //page tab icon
    icon: 'https://cdn4.iconfinder.com/data/icons/48-bubbles/48/06.Tags-512.png',
    //shareable preview-cart metadata
    previewCardTitle: 'Popularify',
    previewCardUrl: 'http://www.popularify.site',
    previewCardWebsite: 'website',
    previewCardDescription: '',
    previewCardImage: '../static/assets/img/headshot.jpg',
    //expand projects tab
    projects: 'active',
    //set active current tab
    popularify: 'active',
    //body content title 
    pageBodyNavTitle: 'Popularify',
    //body content github link
    pageBodyNavGithub: 'https://github.com/MartinBarker/martinbarker.me',
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
})

//redirect discogstagger to tagger
app.get('/discogstagger', async function (req, res) {
  res.redirect('/tagger');
})

//RenderTune route
app.get('/rendertune', async function (req, res) {
  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('RenderTune', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'RenderTune',
    //page tab icon
    icon: './static/assets/img/icon.png',
    //shareable preview-cart metadata

    previewCardTitle: 'RenderTune Free Video Rendering App',
    previewCardUrl: 'http://www.martinbarker.me/rendertune',
    previewCardWebsite: 'website',
    previewCardDescription: 'Combine audio + image file(s) into video files',
    previewCardImage: 'https://i.imgur.com/c3yaWWZ.png',

    //expand projects tab
    projects: 'active',
    //set active current tab
    RenderTune: 'active',
    //body content title 
    pageBodyNavTitle: 'RenderTune',
    //body content github link
    pageBodyNavGithub: 'https://github.com/MartinBarker/',
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
})

//legacy digify route
app.get('/digify', async function (req, res) {
  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('RenderTune', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'RenderTune',
    //page tab icon
    icon: './static/assets/img/icon.png',
    //shareable preview-cart metadata

    previewCardTitle: 'RenderTune Free Video Rendering App',
    previewCardUrl: 'http://www.martinbarker.me/rendertune',
    previewCardWebsite: 'website',
    previewCardDescription: 'Combine audio + image file(s) into video files',
    previewCardImage: 'https://i.imgur.com/c3yaWWZ.png',

    //expand projects tab
    projects: 'active',
    //set active current tab
    RenderTune: 'active',
    //body content title 
    pageBodyNavTitle: 'RenderTune',
    //body content github link
    pageBodyNavGithub: 'https://github.com/MartinBarker/',
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
})

initYouTubeOauth2ClientSetup();
var oauth2Client = null;
async function initYouTubeOauth2ClientSetup(){
  oauth2Client = await createOauth2Client()
}

//generate youtube api url 
// http://localhost:8080/getYtUrl?port=3112
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
        oauth2Client = new OAuth2(clientId, clientSecret, null);
        console.log('createOauth2Client() done')
        resolve(oauth2Client)
      });
    } catch (err) {
      throw(`Error creating Oauth2 Client: ${err}`)
    }
  })
}

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

//tagger route
app.get('/tagger', async function (req, res) {
  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('tagger', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'tagger.site',
    //page tab icon
    icon: 'https://cdn4.iconfinder.com/data/icons/48-bubbles/48/06.Tags-512.png',
    //shareable preview-cart metadata
    previewCardTitle: 'Timestamped Tracklist Generator',
    previewCardUrl: 'http://www.tagger.site',
    previewCardWebsite: 'website',
    previewCardDescription: 'Generate tags using files or a Discogs URL',
    previewCardImage: 'https://i.imgur.com/f0xepPT.jpg',
    //expand projects tab
    projects: 'active',
    //set active current tab
    tagger: 'active',
    //body content title 
    pageBodyNavTitle: 'tagger.site',
    //body content github link
    pageBodyNavGithub: 'https://github.com/MartinBarker/martinbarker/blob/master/views/tagger.handlebars',
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
})

async function getMostReadableTextColor(hex) {
  return new Promise(async function (resolve, reject) {
    console.log('getMostReadableTextColor() hex = ', hex)
    let rgb = convertHexToRGB(hex)
    console.log('getMostReadableTextColor() rgb = ', rgb)
    if (((rgb[0]) * 0.299 + (rgb[1]) * 0.587 + (rgb[2]) * 0.114) > 186) {
      console.log('getMostReadableTextColor() returning black')
      resolve("#000000")
    } else {
      console.log('getMostReadableTextColor() returning white')
      resolve("#ffffff")
    }
  })
}

async function convertHexToRGB(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : null;
}

//any route that starts with tagger
app.get(/^\/tagger\/(.*)/, async function (req, res) {
  let discogs_url = req.params[0];
  console.log('tagger any route discogs_url=', discogs_url)

  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('tagger', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'tagger.site',
    //discogs url
    discogs_url: discogs_url,
    //page tab icon
    icon: 'https://cdn4.iconfinder.com/data/icons/48-bubbles/48/06.Tags-512.png',
    //shareable preview-cart metadata
    previewCardTitle: 'Timestamped Tracklist Generator',
    previewCardUrl: 'http://www.tagger.site',
    previewCardWebsite: 'website',
    previewCardDescription: 'Generate tags using files or a Discogs URL',
    previewCardImage: 'https://i.imgur.com/f0xepPT.jpg',
    //expand projects tab
    projects: 'active',
    //set active current tab
    tagger: 'active',
    //body content title 
    pageBodyNavTitle: 'tagger.site',
    //body content github link
    pageBodyNavGithub: 'https://github.com/MartinBarker/martinbarker/blob/master/views/tagger.handlebars',
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
})

//any route that starts with unix
app.get('/unix', async function (req, res) {
  unixRoute(req, res)
})

//any route that starts with unix
app.get(/^\/unix\/(.*)/, async function (req, res) {
  unixRoute(req, res)
})

async function unixRoute(req, res) {
  let unxiTimestamp = req.params[0];

  //get color Data
  let colorData = await getColorData();
  //get blog posts
  let displayPosts = await getPostsDisplay(colorData.colors['LightMuted'].hex, req.params.id, getReadableTextColor(colorData.colors['LightMuted'].rgb))
  //create colorObj
  let colorsObj = await createColorObj(colorData);

  res.render('unix', {
    //template layout to use
    layout: 'mainTemplate',
    //page title of tab
    pageTitle: 'Unix Converter',
    //discogs url
    unxiTimestamp: unxiTimestamp,
    //page tab icon
    icon: 'https://cdn.iconscout.com/icon/free/png-512/unix-1-599990.png',
    //shareable preview-cart metadata
    previewCardTitle: 'Convert Unix Timestamp',
    previewCardUrl: 'http://www.martinbarker.me/unix',
    previewCardWebsite: 'website',
    previewCardDescription: 'Convert a Unix Timestamp to a Readable DateTime',
    previewCardImage: 'https://cdn.iconscout.com/icon/free/png-512/unix-1-599990.png',
    //expand projects tab
    projects: 'active',
    //set active current tab
    unix: 'active',
    //body content title 
    pageBodyNavTitle: 'Unix Timestamp Converter',
    //body content github link
    pageBodyNavGithub: 'https://github.com/MartinBarker/martinbarker/blob/master/views/unix.handlebars',
    //list to display for navbar 'Blog' options
    posts: displayPosts,
    //color info
    colorsObj: colorsObj,
    colorsStr: JSON.stringify(colorsObj),
    imgPath: '/' + colorData.imgPath,
    imgSrcUrl: colorData.imgSrc,
    imgListen: colorData.imgListen,
    Vibrant: colorData.colors['Vibrant'].hex,
    LightVibrant: colorData.colors['LightVibrant'].hex,
    DarkVibrant: colorData.colors['DarkVibrant'].hex,
    Muted: colorData.colors['Muted'].hex,
    LightMuted: colorData.colors['LightMuted'].hex,
    DarkMuted: colorData.colors['DarkMuted'].hex,
  });
}

//api route to return pageColors
app.post('/getColors', async function (req, res) {
  console.log("/getColors");
  let colorData = await getColorData();
  //create colorObj
  let colorsObj = await createColorObj(colorData);
  res.send(colorsObj)
});

/*
  Popularify / Spotify API routes
*/
//proxy ip debug ip route
app.post('/proxyiprequest', async function (req, res) {
  const https = require('https')
  try {

    //get access token
    let accessToken = await spotifyAuth.getAccessToken();

    //create data
    const data = JSON.stringify({
      offset: 0,
    })

    //create options data obj
    const options = {
      host: "220.135.165.38",
      port: 8080,

      hostname: 'api.spotify.com',
      path: '/v1/artists/1XqqyIQYMonHgllb1uysL3/albums',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
      },
    }

    const req = https.request(options, res => {
      console.log(`proxyiprequest() statusCode: ${res.statusCode}`)
      res.on('data', d => {
        process.stdout.write(d)
      })
    })

    req.on('error', error => {
      console.error('proxyiprequest() err=', error)
    })

    req.write(data)
    req.end()

    /*
    //get access token
    let accessToken = await spotifyAuth.getAccessToken();
    //set artist (surkin)
    let artistId='1XqqyIQYMonHgllb1uysL3'
    //make artist album request with proxy ip
    $.ajax({
      url: `https://api.spotify.com/v1/artists/${artistId}/albums`,
      type: 'GET',
      contentType: 'application/json',
      headers: {
          'Authorization': 'Bearer ' + accessToken,
      },
      data: {
          offset: 0,
      }
    }).done(function callback(response) {
      console.log(`index.js getArtistAlbums() success response=`,response)
      //if (onlyReturnTracks) {
        //    resolve(response.items)
        //} else {
        //    resolve(response)
        //}
    }).fail(async function (error) {
        console.log(`index.js getArtistAlbums() err=`,error)
        //await delay(retryIn*1000)
        //retryIn=retryIn+1;
        //resolve(await getArtistAlbums(artistId, offset, onlyReturnTracks))
    });
    */

    /*
    var options = {
      host: "165.227.35.11",
      port: 80,
      path: "http://www.google.com",
      headers: {
        Host: "www.google.com"
      }
    };
    http.get(options, function (res) {
      console.log('proxyiprequest() res.statusCode=', res.statusCode);
      res.pipe(process.stdout);
    });
    */
  } catch (err) {
    console.log('proxyiprequest() err=', err)
  }

  res.send('success')
})

//popularify route
app.get('/popularify', async function (req, res) {
  var fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
  console.log(`/popularify fullUrl=${fullUrl}`)

  res.render('popularifyBody', {
    layout: 'popularifyLayout',
  });
})

//popularify route
app.get('/popularify/callback', async function (req, res) {
  var fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
  console.log(`fullUrl=${fullUrl}`)
  res.status(200).send(fullUrl)

})

var querystring = require('querystring');
app.get('/createSpotifyRedirectURL', async function (req, res) {
  try {
    let redirectURL = 'https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: "0073a7f25706462a8850c97796960e87",
        scope: 'user-read-private user-read-email',
        redirect_uri: "http://localhost:8080/popularify",
        state: "random-state"
      })

    //let redirectURL = await spotifyAuth.createRedirectURL()
    res.status(200).send(redirectURL)
  } catch (err) {
    console.log(`/createSpotifyRedirectURL err=`, err)
    res.status(400).send(err)
  }

})

app.get('/spotifyLogin', async function (req, res) {
  let redirectURL = await spotifyAuth.createRedirectURL()
  res.redirect(redirectURL);
})

app.get('/getSpotifyLoginURL', async function (req, res) {
  try {
    let redirectURL = await spotifyAuth.createRedirectURL()
    res.status(200).send(redirectURL)
  } catch (err) {
    res.status(400).send(err)
  }
})

app.get('/callback', async (req, res) => {
  try {
    const error = req.query.error;
    const code = req.query.code;
    const state = req.query.state;

    //log user in, get access_token and refresh_code
    let resp = await spotifyAuth.authCallback(error, code, state)

    res.render('popularifyBody', {
      layout: 'popularifyLayout',
      loggedIn: 'true',
      access_token: resp.access_token
    });
  } catch (err) {
    console.log('/callback err=', err)
  }

});

//get colors for image
app.post('/getImageColors', async function (req, res) {
  //get vars 
  let imgURL = req.body.imgURL;
  let colors = {}

  if (imgURL.includes('spotifyArtistUnknown.jpg')) {
    colors = {
      DarkMuted: { hex: '#828282', rgb: [130, 130, 130] },
      DarkVibrant: { hex: '#828282', rgb: [130, 130, 130] },
      LightMuted: { hex: '#828282', rgb: [130, 130, 130] },
      Muted: { hex: '#828282', rgb: [130, 130, 130] },
      Vibrant: { hex: '#828282', rgb: [130, 130, 130] },
    }
  } else {
    try {
      //get color swatches
      var swatches = await Vibrant.from(imgURL).getPalette()
      //format rbg and swatch type into list
      for (const [key, value] of Object.entries(swatches)) {
        //get rgb color value
        let colorValue = value.rgb
        //convert to hex color value
        let hexColor = rgbToHex(colorValue)
        //construct object
        var keyName = `${key}`
        colors[keyName] = { 'hex': hexColor, 'rgb': colorValue }
      }
    } catch (err) {
      console.log('/getImageColors err getting img colors =', err);
    }
  }

  res.status(200).send(colors)
});

//spotifyAPI
app.post('/spotifyApi', async function (req, res) {
  //get vars 
  let uri = req.body.uri.replace('spotify:artist:', '');
  let access_token = req.body.access_token;
  //use api to get data
  let artistAlbums = []
  try {
    //uri='spotify:artist:0IbLwpihllhH3E9bRPCOmJ'
    artistAlbums = await spotifyApiLogic.getAllArtistAlbums(uri)
    //artistAlbums = await spotifyApiLogic.createPlaylist('myPlaylistName', "description", "public", access_token)
  } catch (err) {
    artistAlbums = [];
  }
  res.status(200).send(artistAlbums)
});

app.post('/getAccessToken', async function (req, res) {
  let accessToken = null;
  try {
    accessToken = await spotifyAuth.getAccessToken();
  } catch (err) {
    accessToken = null;
  }
  res.status(200).send(accessToken)
});

//search spotify for artist, return results
app.post('/spotifySearch', async function (req, res) {
  //get vars 
  let input = req.body.input;
  //use api to get data
  let searchResults = []
  try {
    //let spotifyApiSession = spotifyAuth.getSession()
    searchResults = await spotifyAuth.searchArtists(input);
  } catch (err) {
    searchResults = [];
    console.log('/spotifySearch err=', err)
  }
  res.status(200).send(searchResults)
});

//any route that starts with generatePopularifyData
app.get(/^\/generatePopularifyData\/(.*)/, async function (req, res) {
  res.connection.setTimeout(0);

  //emit event
  //io.emit('popularifyDataUpdate', { description: 'generatePopularifyData route called' });

  let id = req.params[0].split('/')[0];
  let globalAccesToken = req.params[0].split('/')[1];
  console.log(`/generatePopularifyData artistId=${id}, token=${globalAccesToken}`)
  //use api to get data
  let popularifyData = []
  try {
    console.log('/generatePopularifyData calling spotifyAuth.generatePopularifyData')
    popularifyData = await spotifyAuth.generatePopularifyData(id, globalAccesToken);
    console.log('/generatePopularifyData finished getting popularifyData sucesfully')
  } catch (err) {
    console.log('spotifyAuth.generatePopularifyData err=', err)
    popularifyData = null;
  }
  if (popularifyData) {
    res.status(200).send(popularifyData)
  }
})

var request = require('request');
app.post('/popularify/logUserIn', async function (req, res) {
  console.log('popularify/logUserIn')
  //get payload
  let payload = req.body.payload.split('&state')[0].trim();
  console.log(`/logUserIn payload=${payload}`)
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: payload,
      redirect_uri: "http://localhost:8080/popularify",
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': 'Basic ' + (new Buffer("0073a7f25706462a8850c97796960e87" + ':' + "99a48c817c6249da948ae83dcd513934").toString('base64'))
    },
    json: true
  };

  request.post(authOptions, function (error, response, body) {
    if (!error && response.statusCode === 200) {

      var access_token = body.access_token,
        refresh_token = body.refresh_token;

      var options = {
        url: 'https://api.spotify.com/v1/me',
        headers: { 'Authorization': 'Bearer ' + access_token },
        json: true
      };

      // use the access token to access the Spotify Web API
      request.get(options, function (error, response, body) {
        console.log('user info: ', body);
        res.status(200).send(body)
      });

      // we can also pass the token to the browser to make requests from there
      /*
      res.redirect('/#' +
        querystring.stringify({
          access_token: access_token,
          refresh_token: refresh_token
        }));
        */
    } else {
      res.status(200).send('err')
      res.redirect('/#' +
        querystring.stringify({
          error: 'invalid_token'
        }));
    }
  });

  //let logUserInRsp = await spotifyAuth.logUserIn(payload);


});


//get all tracks for an artist sorted by popularity
app.post('/generatePopularifyDatZ', async function (req, res) {
  console.log('/generatePopularifyData route called')
  //get artist id
  let id = req.body.artistId;
  let globalAccesToken = req.body.globalAccesToken
  //use api to get data
  let popularifyData = []
  try {
    console.log('/generatePopularifyData calling spotifyAuth.generatePopularifyData')
    popularifyData = await spotifyAuth.generatePopularifyData(id, globalAccesToken);
    console.log('/generatePopularifyData finished getting popularifyData sucesfully')
  } catch (err) {
    console.log('spotifyAuth.generatePopularifyData err=', err)
    popularifyData = [];
  }
  res.status(200).send(popularifyData)
});

//get discogs api info
app.post('/discogsAPI', async function (req, res) {
  //get vars 
  let code = req.body.code
  let type = req.body.type

  //setup using npm package 'disconnect' for getting discogs api data
  var Discogs = require('disconnect').Client;
  var db = new Discogs().database();

  console.log(`/discogsAPI code = ${code}, type = ${type}`)
  if (type == 'master') {
    //cant get master data 
    db.getMaster(code, function (err, resp) {

      //if err message is present return that, else return full response 
      if (resp.message) {
        res.status(400).send(resp.message)
      } else {
        res.status(200).send(resp)
      }
    });

  } else if (type == 'release') {

    //get discogs api data
    db.getRelease(code, function (err, resp) {
      //console.log('resp = ', resp)

      //if err message is present return that, else return full response 
      if (resp.message) {
        res.status(400).send(resp.message)
      } else {
        res.status(200).send(resp)
      }
    });

  } else if (type == 'artist') {
    console.log('get artist data')
    //get discogs artist api data
    try {
      db.getArtist(code, function (err, resp) {
        if (resp.message) {
          res.status(400).send({ err: resp.message })
        } else {
          res.status(200).send(resp)
        }
      });

    } catch (err) {
      console.log('err getting artist info from discogs')
    }

  }


});

//api audio file metadata tags
app.post('/getFileMetadataTags', async function (req, res) {
  var jsonResults = {
    'tags': {
      'releaseArtist': [],
      'releaseInfo': [],
      'tracklist': [],
      'combinations': []
    }
  };
  res.send(jsonResults)
});

async function getMainTemplateData(activeTabId) {
  return new Promise(async function (resolve, reject) {
    //get color data based on a random image from /static/assets/aesthetic-images
    let colorData = await getColorData()
    //get display title for each blog post
    let postsDisplay = await getPostsDisplay(colorData.colors['LightMuted'].hex, activeTabId, getReadableTextColor(colorData.colors['LightMuted'].rgb))

    let mainTemplateData = {
      colorDataRaw: colorData,
      colorData: {
        textColor1: getReadableTextColor(colorData.colors['DarkMuted'].rgb),
        backgroundColor1: colorData.colors['DarkMuted'].hex,
        textColor2: getReadableTextColor(colorData.colors['LightMuted'].rgb), //active tab text color
        backgroundColor2: colorData.colors['LightVibrant'].hex,
        textColor6: getReadableTextColor(colorData.colors['LightVibrant'].rgb),
        backgroundColor3: colorData.colors['LightMuted'].hex,
        textColor7: getReadableTextColor(colorData.colors['DarkVibrant'].rgb),
        backgroundColor7: colorData.colors['DarkVibrant'].hex,
        textColor3: getReadableTextColor(colorData.colors['Vibrant'].rgb), //navbar hover tab text color
        backgroundColor4: colorData.colors['Vibrant'].hex,
        textColor4: getReadableTextColor(colorData.colors['Muted'].rgb),
        backgroundColor6: colorData.colors['Muted'].hex,
        textColor5: getReadableTextColor(colorData.colors['LightMuted'].rgb),
        backgroundColor5: colorData.colors['LightMuted'].hex,
        Vibrant: colorData.colors['Vibrant'].hex,
        LightVibrant: colorData.colors['LightVibrant'].hex,
        DarkVibrant: colorData.colors['DarkVibrant'].hex,
        Muted: colorData.colors['Muted'].hex,
        LightMuted: colorData.colors['LightMuted'].hex,
        DarkMuted: colorData.colors['DarkMuted'].hex,
      },
      imgPath: colorData.imgPath,
      imgSrc: colorData.imgSrc,
      imgDesc: colorData.desc,
      imgListen: colorData.listen,

      postsDisplay: postsDisplay,
    }
    resolve(mainTemplateData)
  })
}

async function getPostsDisplay(activeTabColorHex, activeTabId, activeTabTextColor) {
  return new Promise(async function (resolve, reject) {
    let postsDisplay = []
    var cursor = db.collection('posts').find();
    cursor.each(function (err, item) {
      // If the item is null then the cursor is exhausted/empty and closed
      if (item == null) {
        //console.log('cursor item = null')
        resolve(postsDisplay)
        return;
      }
      // otherwise, do something with the item
      allBlogPosts.push(item)
      let tempObj = null;
      if (activeTabId == item._id) {
        tempObj = { 'title': item.title, 'id': item._id, 'activeTabTextColor': activeTabTextColor, 'activeTabColor': activeTabColorHex, 'activeTab': 'true' }
      } else {
        tempObj = { 'title': item.title, 'id': item._id }
      }
      //console.log('tempObj = ', tempObj)
      postsDisplay.push(tempObj)
    });

  })
}

async function createColorObj(colorData) {
  return new Promise(async function (resolve, reject) {
    let colorsObj = {

      'cssClassElements': {
        'sidebarStyle': [
          {
            "attribute": "background",
            "value": `${colorData.colors['LightVibrant'].hex}`
          },
          {
            "attribute": "color",
            "value": `${getReadableTextColor(colorData.colors['LightVibrant'].rgb)}`
          }
        ],
        'sidebarHeaderStyle': [
          {
            "attribute": 'background',
            "value": `${colorData.colors['DarkMuted'].hex}`
          }
        ],
        'sidebarHeaderText': [
          {
            "attribute": 'color',
            "value": `${getReadableTextColor(colorData.colors['DarkMuted'].rgb)}`
          }
        ],
        'sidebarItemsStyle': [
          {
            "attribute": 'background',
            "value": `${colorData.colors['DarkVibrant'].hex}`
          },
          {
            "attribute": 'color',
            "value": `${getReadableTextColor(colorData.colors['DarkVibrant'].hex)}`
          },
        ],
        'sidebarActiveItem': [
          {
            "attribute": 'background',
            "value": `${colorData.colors['LightMuted'].hex}`
          },
          {
            "attribute": 'color',
            "value": `${getReadableTextColor(colorData.colors['LightMuted'].rgb)}`
          },
        ],
        'pageContentStyle': [
          {
            "attribute": 'background',
            "value": `${colorData.colors['LightMuted'].hex}`
          }
        ],
        'pageContentBodyText': [
          {
            "attribute": 'color',
            "value": `${getReadableTextColor(colorData.colors['LightMuted'].rgb)}`
          },
        ],
        'pageContentTitleCardStyle': [
          {
            "attribute": 'background',
            "value": `${colorData.colors['Muted'].hex}`
          },
          {
            "attribute": 'color',
            "value": `${getReadableTextColor(colorData.colors['Muted'].rgb)}`
          }
        ]
      },
      'imgPath': `${colorData.imgPath}`,
      'filename': `${colorData.filename}`,
      'hoverColors': {
        'hoverUrl1': `${colorData.colors['DarkMuted'].hex}`,
        'hoverUrl2': `${colorData.colors['Vibrant'].hex}`,
        'sidebarHoverColor': `${colorData.colors['Vibrant'].hex}`,
        'sidebarHoverText': `${getReadableTextColor(colorData.colors['Vibrant'].rgb)}`,
      },
      'colors': {
        'Vibrant': `${colorData.colors['Vibrant'].hex}`,
        'LightVibrant': `${colorData.colors['LightVibrant'].hex}`,
        'DarkVibrant': `${colorData.colors['DarkVibrant'].hex}`,
        'Muted': `${colorData.colors['Muted'].hex}`,
        'LightMuted': `${colorData.colors['LightMuted'].hex}`,
        'DarkMuted': `${colorData.colors['DarkMuted'].hex}`,
      }

    }
    resolve(colorsObj)
  })
}

//return pageColors
async function getColorData() {
  return new Promise(async function (resolve, reject) {
    let randomImg = await getRandomImg('static/assets/aesthetic-images/')
    let imgPath = `static/assets/aesthetic-images/${randomImg}`
    console.log('img = ', imgPath)

    //get color swatches
    var swatches = await Vibrant.from(imgPath).getPalette()
    //format rbg and swatch type into list
    let colors = {}
    for (const [key, value] of Object.entries(swatches)) {
      //get rgb color value
      let colorValue = value.rgb
      //convert to hex color value
      let hexColor = rgbToHex(colorValue)
      //construct object
      var keyName = `${key}`
      colors[keyName] = { 'hex': hexColor, 'rgb': colorValue }
    }
    console.log('color stuff fine, now getting metadata')
    //get source info
    let imgMetadata = await getImgMetadata(randomImg)

    resolve({
      colors: colors,
      imgPath: imgPath,
      filename: randomImg,
      imgSrc: imgMetadata.title,
      listen: imgMetadata.listen,
    })
  })
}

/*
   Helper functions
*/

function getReadableTextColor(inputRGBcolor) {
  if (((inputRGBcolor[0]) * 0.299 + (inputRGBcolor[1]) * 0.587 + (inputRGBcolor[2]) * 0.114) > 186) {
    return ("#000000")
  } else {
    return ("#ffffff")
  }
}

function LightenDarkenColor(col, amt) {

  var usePound = false;

  if (col[0] == "#") {
    col = col.slice(1);
    usePound = true;
  }

  var num = parseInt(col, 16);

  var r = (num >> 16) + amt;

  if (r > 255) r = 255;
  else if (r < 0) r = 0;

  var b = ((num >> 8) & 0x00FF) + amt;

  if (b > 255) b = 255;
  else if (b < 0) b = 0;

  var g = (num & 0x0000FF) + amt;

  if (g > 255) g = 255;
  else if (g < 0) g = 0;

  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16);

}

function invertColor(hexTripletColor) {
  var color = hexTripletColor;
  color = color.substring(1);           // remove #
  color = parseInt(color, 16);          // convert to integer
  color = 0xFFFFFF ^ color;             // invert three bytes
  color = color.toString(16);           // convert to hex
  color = ("000000" + color).slice(-6); // pad with leading zeros
  color = "#" + color;                  // prepend #
  return color;
}

//convert rgb string to hex
function rgbToHex(color) {
  return "#" + componentToHex(parseInt(color[0])) + componentToHex(parseInt(color[1])) + componentToHex(parseInt(color[2]));
}

//convert to int to hex
function componentToHex(c) {
  var hex = c.toString(16);
  return hex.length == 1 ? "0" + hex : hex;
}

function getImgMetadata(imgFilename) {
  return new Promise(async function (resolve, reject) {
    try {
      const exif = require('exif-parser')
      const fs = require('fs')
      let pathOneFolderUp = __dirname.split('/')
      let filepath = `${__dirname}/../static/assets/aesthetic-images/${imgFilename}`
      console.log('get metadata')

      const buffer = fs.readFileSync(filepath)
      const parser = exif.create(buffer)
      const result = parser.parse()
      resolve({ 'title': result.tags.ImageDescription, 'listen': 'tempListenUrl' })
    } catch (err) {
      console.log('there was an err getting this img metadata, err = ', err)
      resolve({ 'title': "", 'listen': 'tempListenUrl' })
    }

  });
}

//return random image filename from path
function getRandomImg(path) {
  return new Promise(async function (resolve, reject) {
    var fs = require('fs');
    var files = fs.readdirSync('static/assets/aesthetic-images/')
    /* now files is an Array of the name of the files in the folder and you can pick a random name inside of that array */
    let chosenFile = files[Math.floor(Math.random() * files.length)]
    resolve(chosenFile)
  })
}

module.exports = app;

