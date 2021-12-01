////////////////////////////////////////
//init setup vars
////////////////////////////////////////
var SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
var spotifyTokens = require('../js/spotifyTokens');
let sessions = {}
let sessionsStatus = {}
let spotifyApps = {}
var io = require("../../../server").io;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

//testing: make proxy ip request 
async function proxyIPtest() {
    /*
    const axios = require("axios");
    let httpsProxyAgent = require("https-proxy-agent");
    let user=`buwbgsdl`
    let pass=`cu8ogpft3ipc`
    let host=`209.127.191.180`
    let port=`9279`
    const agent = new httpsProxyAgent(`http://${user}:${pass}@${host}:${port}`);
    const config = {
    method: "GET",
    url,
    httpsAgent: agent,
    };
    const resp = await axios.request(config);
    */
}

////////////////////////////////////////
//init authentication setup functions
////////////////////////////////////////

//create spotify applications
createSpotifyApplications()
async function createSpotifyApplications() {
    for (const [key, value] of Object.entries(spotifyTokens)) {
        let clientId = value.clientId
        let clientSecret = value.clientSecret
        var spotifyApp = await new SpotifyWebApi({
            clientId: clientId,
            clientSecret: clientSecret,
            redirectUri: 'http://localhost:8080/popularify'
        });
        spotifyApps[`${key}`] = spotifyApp
    }
    await authenticateAllSessions2()
}

//authenticate session for each app
async function authenticateAllSessions2() {
    return new Promise(async function (resolve, reject) {
        for (const [key, value] of Object.entries(spotifyTokens)) {
            console.log('authenticateAllSessions2() authenticate: ', key)
            await authSession(key, value['sessions']['martinbarker99']['refresh_token'], key)
        }
        console.log('spotifyAuth() authenticateAllSessions2() finished, sessionsStatus=', sessionsStatus)
        resolve()
    })
}

////////////////////////////////////////
///utility functions
////////////////////////////////////////

//authenticate a session and add it to sessions{} object as 'active'
async function authSession(spotifyAppName, refreshToken, sessionCredsName) {
    return new Promise(async function (resolve, reject) {
        try {
            //get spotifyApp
            let spotifyApp = spotifyApps[`${spotifyAppName}`]
            spotifyApp.setRefreshToken(refreshToken);
            const data = await spotifyApp.refreshAccessToken();
            var accessToken = data.body['access_token'];
            var expiresIn = data.body['expires_in'];
            expiresIn = expiresIn * 1000;

            spotifyApp.setAccessToken(accessToken);

            sessions[`${sessionCredsName}`] = spotifyApp;
            sessionsStatus[`${sessionCredsName}`] = 'active';
            console.log(`${new Date().getTime()} authSession() expiresIn: `, expiresIn)
            setInterval(async () => {
                console.log(`${new Date().getTime()} authSession() interval begin `)
                try {
                    const data = await spotifyApp.refreshAccessToken();
                    expiresIn = data.body['expires_in'];
                    accessToken = data.body['access_token'];
                    spotifyApp.setAccessToken(accessToken);
                    console.log('authSession() The access token has been refreshed! refresh in: ', expiresIn, ` new access_token=${accessToken}`);

                } catch (err) {
                    console.log('authSession() interval auth err=', err)
                }
            }, expiresIn);
            resolve()
        } catch (err) {
            console.log('authSession() initial auth err=', err)
        }
    })
}

async function getAccessToken() {
    return new Promise(async function (resolve, reject) {
        let accessToken = sessions['Popularify-app1']['_credentials']['accessToken']
        console.log('getAccessToken() accessToken=', accessToken)

        resolve(accessToken)
    })
}

//retrieve a session for making queries with 
async function getSession(dontUseTheseCreds = []) {
    return new Promise(async function (resolve, reject) {
        //console.log('getSession() sessionsStatus = \n', sessionsStatus)

        //find a session to use
        let activeSessionFound = false;
        for (const [key, value] of Object.entries(sessionsStatus)) {
            if (value == 'active') {
                //console.log(`       getSession() ${key} session is active, so return it`)
                activeSessionFound = true;
                //https://www.twitch.tv/tsm_imperialhal
                resolve({
                    session: sessions[`${key}`],
                    name: `${key}`
                })
            } else if (value == 'cooldown') {
                //console.log(`       getSession() ${key} session is cooldown, so DONT return it`)
            }
        }
        if (!activeSessionFound) {
            //console.log(`getSession() no active session found`)
        }

    })

}

//handle 429 error for when a spotify app session has had too many requests and needs to go into cooldown
async function handle429Err(sessionName, debugFunctionName) {
    return new Promise(async function (resolve, reject) {
        try {
            console.log(`handle429Err() ${debugFunctionName} too many requests, need to set this session as "cooldown" for 30 seconds`)
            //mark this session as in cooldown mode
            //console.log(`handle429Err() ${debugFunctionName} setting ${sessionName} session to cooldown`)
            sessionsStatus[`${sessionName}`] = 'cooldown';
            //after 30 seconds, mark session as 'active'
            console.log(`handle429Err() ${debugFunctionName} begin wait `)
            await delay(15000)
            console.log(`handle429Err() ${debugFunctionName} end wait `)
            //changeSessionStatus(sessionName, 'active', 1500)
            //setTimeout(function () {
            //    console.log(`handle429Err() ${debugFunctionName} setting ${sessionName} session to active`)
            sessionsStatus[`${sessionName}`] = 'active'
            //}, 3000);
            //console.log(`handle429Err() done`)
            resolve()
        } catch (err) {
            //console.log('handle429Err() err=',err)
            reject()
        }

    })
}

//change sesion status after waiting
async function changeSessionStatus(sessionName, status, delayTime) {
    //wait
    await delay(delayTime)
    //change
    sessionsStatus[`${sessionName}`] = status
    console.log(`changeSessionStatus() ${sessionName} set to ${status} `)
}

async function proxyIPtest(globalAccesToken) {
    return new Promise(async function (resolve, reject) {
        const axios = require("axios");

        let httpsProxyAgent = require("https-proxy-agent");

        let proxyuser = 'buwbgsdl';
        let proxypass = 'cu8ogpft3ipc';
        let proxyhost = '209.127.191.180';
        let proxyport = '9279';
        const agent = new httpsProxyAgent(`http://${proxyuser}:${proxypass}@${proxyhost}:${proxyport}`);
        let url = 'https://api.spotify.com/v1/search'
        const config = {
            method: "GET",
            url,
            httpsAgent: agent,

            contentType: 'application/json',
            headers: {
                'Authorization': 'Bearer ' + globalAccesToken,
            },
            data: {
                q: `gaga`,
                type: 'artist'
            }

        };

        const resp2 = null;
        try {
            resp2 = await axios.request(config);
        } catch (err) {
            console.log('err=', err)
        }
        resolve(resp2)
    })
}

async function getTracksFromAlbums(appearsOnAlbums, appearsOnCheck=false, artistURI){    
    return new Promise(async function (resolve, reject) {

            ////////////////////////////////////
            // make getTracklist api call for every appears_on album (20 albums at a time)
            ////////////////////////////////////
            let multipleAlbumsQueryLimit = 20;
            const appearsOnAlbumTracklistPromises = [];
            let slicedAlbumIds = []
            let slicedAlbumInfo = []
            let runningTally = 0;
            for(var x = 0; x < appearsOnAlbums.length; x++){
                //get data
                let albumId = appearsOnAlbums[x].id
                let albumArt = appearsOnAlbums[x].albumArt
                let albumGroup = appearsOnAlbums[x].album_group
                let albumType = appearsOnAlbums[x].album_type
                let albumArtist = appearsOnAlbums[x].artists[0].name ? appearsOnAlbums[x].artists[0].name : ""
                //push to lists
                slicedAlbumIds.push(albumId)
                slicedAlbumInfo.push({
                    albumId: albumId,
                    albumArt: albumArt,
                    albumGroup: albumGroup,
                    albumType: albumType,
                    albumArtist: albumArtist,
                })
                //if it is time to make an api call:
                if(slicedAlbumIds.length == multipleAlbumsQueryLimit){
                    runningTally=runningTally+slicedAlbumIds.length
                    //push spotify call
                    appearsOnAlbumTracklistPromises.push(getAlbums(slicedAlbumIds, slicedAlbumInfo));
                    //clear sliced lists
                    slicedAlbumIds = []
                    slicedAlbumInfo = []
                }
            }
            if(slicedAlbumIds.length > 0){
                console.log(`outside. pushing remaining ${slicedAlbumIds.length} slicedAlbumIds`)
                runningTally=runningTally+slicedAlbumIds.length
                //push spotify request for remaining values
                appearsOnAlbumTracklistPromises.push(getAlbums(slicedAlbumIds, slicedAlbumInfo));
            }
            console.log('runningTally=',runningTally)
            //run promises to get album info
            var appearsOnAlbumTracklistPromisesFinished = await Promise.all(appearsOnAlbumTracklistPromises);
            //sendPopularifySocketUpdate(`Got tracklists for appears_on albums: ${appearsOnAlbumTracklistPromisesFinished.length}`)

            ////////////////////////////////////
            // get complete tracklist (if needed) for every appears_on album
            // only get tracks which include our target artist
            ////////////////////////////////////
            let allAlbumTracks = []
            let appearsOnAlbumTracks = []
            for (var x = 0; x < appearsOnAlbumTracklistPromisesFinished.length; x++) {
                for (var y = 0; y < appearsOnAlbumTracklistPromisesFinished[x].length; y++) {
                    let currentAlbumId = appearsOnAlbumTracklistPromisesFinished[x][y].id;
                    
                    let currentAlbumArt = appearsOnAlbumTracklistPromisesFinished[x][y].images[0].url;

                    let currentAlbumGroup = appearsOnAlbumTracklistPromisesFinished[x][y].album_group;
                    let currentAlbumType = appearsOnAlbumTracklistPromisesFinished[x][y].album_type;
                    let currentAlbumArtist = appearsOnAlbumTracklistPromisesFinished[x][y].album_artist;
                    let currentAlbumTracks = appearsOnAlbumTracklistPromisesFinished[x][y].tracks.items;
                    let tracksTotal = appearsOnAlbumTracklistPromisesFinished[x][y].tracks.total;
                    //get complete tracklist if needed
                    while (currentAlbumTracks.length < tracksTotal) {
                        let additionalAlbumInfo = await getAlbumTracks(currentAlbumId, currentAlbumTracks.length)
                        currentAlbumTracks = currentAlbumTracks.concat(additionalAlbumInfo.items)
                    }

                    //for each track on album
                    for(var z = 0; z < currentAlbumTracks.length; z++){
                        let albumTrack = currentAlbumTracks[z]
                        //add album_group and album_type to track object
                        albumTrack["album_art"] = currentAlbumArt
                        albumTrack["album_group"] = currentAlbumGroup
                        albumTrack["album_type"] = currentAlbumType
                        albumTrack["album_artist"] = currentAlbumArtist
                        //get id for each artist on track
                        let artistIDs = [];
                        for(var k = 0; k < albumTrack.artists.length; k++ ){
                            let artistId = albumTrack.artists[k].id;
                            artistIDs.push(artistId)
                        }
                        //apepars_on check (only include tracks where the artist appears on the track)
                        if(appearsOnCheck){
                            //if our targetArtist is included on the track, then add that track to tracksWithOurArtist[]
                            if(artistIDs.includes(artistURI)){
                                appearsOnAlbumTracks.push(albumTrack)
                            }
                        }else{
                            appearsOnAlbumTracks.push(albumTrack)
                        }
                    }
                }
            }
        resolve(appearsOnAlbumTracks)
    })
}


//generate popularify data
//only do 5 requests in parallel at once 
async function generatePopularifyData(artistURI, globalAccesToken) {
    return new Promise(async function (resolve, reject) {
        console.log('generatePopularifyData() begin')
        //init vars
        var albumCount, songCount = 0;
        //get start time
        var start = new Date().getTime();

        let returnObj = {};

        try {

            ////////////////////////////////////////////////////
            // Get albums 20 ids at a time
            ////////////////////////////////////////////////////

            //make initial request for artist albums
            let market = "NA"
            let initialAlbums = await getArtistAlbums(artistURI, 0, false, market)
            total = initialAlbums.total;

            //make additional request if needed (20 album ids at a time)
            albumCount=total;
            sendPopularifySocketUpdate(`Getting tracklist from artist album 0/${total}.`)
            console.log(`generatePopularifyData() Artist has ${total} albums. We have ${initialAlbums.items.length} so far and need to get ${total - (initialAlbums.items.length)} more`);
            let artistAlbumsPromises = [];
            for (var x = 20; x < total; x += 20) {
                artistAlbumsPromises.push(getArtistAlbums(artistURI, x, true, initialAlbums.items.length))
            }

            //complete promises for additional requests
            let finishedArtistAlbumsPromises = await Promise.all(artistAlbumsPromises);
            console.log(`generatePopularifyData() finished getting all artist albums`);

            //go through initialAlbums.items and seperate the album_type=='appears_on' albums into appearsOnAlbums[] or nonAppearsOnAlbums
            let appearsOnAlbums = [];
            let nonAppearsOnAlbums = []; //allAlbums
            for(var z = 0; z < initialAlbums.items.length; z++){
                let album = initialAlbums.items[z]
                let albumGroup = album.album_group;
                if(albumGroup == 'appears_on'){
                    appearsOnAlbums.push(album)
                }else{
                    nonAppearsOnAlbums.push(album)
                }
            }

            //go through any remaining albums after initial call and seperate albums based on album_group: appears_on
            for (var x = 0; x < finishedArtistAlbumsPromises.length; x++) {
                //finishedArtistAlbumsPromises[0] is a list of max 20 objects
                for(var z = 0; z < finishedArtistAlbumsPromises[x].length; z++){
                    let album = finishedArtistAlbumsPromises[x][z]
                    let albumGroup = album.album_group;
                    if(albumGroup == 'appears_on'){
                        appearsOnAlbums.push(album)
                    }else{
                        nonAppearsOnAlbums.push(album)
                    }
                }        
                //allAlbums = allAlbums.concat(finishedArtistAlbumsPromises[x])
            }


            console.log(`generatePopularifyData() found ${appearsOnAlbums.length} appearsOnAlbums, ${nonAppearsOnAlbums.length} nonAppearsOnAlbums`)
            
            
            sendPopularifySocketUpdate(`Got tracklists for all ${total} artist albums, extracting into tracks. `)

            //sendPopularifySocketUpdate(`found ${appearsOnAlbums.length} appearsOnAlbums, ${nonAppearsOnAlbums.length} nonAppearsOnAlbums`)
            
            //get tracks from appears_on category
            let allAlbumTracks = []     
            //take spotify albums api responses, get complete tracklist for each release and add album_type / album_group into song object
            let appearsOnAlbumTracks = await getTracksFromAlbums(appearsOnAlbums, true, artistURI)
            allAlbumTracks = allAlbumTracks.concat(appearsOnAlbumTracks)

            //get tracks not from appears_on category
            let nonAppearsOnAlbumTracks = await getTracksFromAlbums(nonAppearsOnAlbums, false, artistURI)
            allAlbumTracks = allAlbumTracks.concat(nonAppearsOnAlbumTracks)

            //returnObj.allAlbumTracks = allAlbumTracks;
            console.log('generatePopularifyData() allAlbumTracks.length=', allAlbumTracks.length)
            
            songCount=allAlbumTracks.length
            sendPopularifySocketUpdate(`Got tracklists for all ${total} artist albums. getting popularity for 0/${allAlbumTracks.length} tracks.`)

            ////////////////////////////////////
            // Fetch additional data (popularity) for each track (50 at a time)
            ////////////////////////////////////

           
            var trackInfoPromisesFinished = [];
            const trackInfoPromises = [];
            let multipleTracksQueryLimit = 50;
            let slicedTrackIds = []
            let slicedTrackInfo = []
            //for each track, 50 tracks at a time
            for (var x = 0; x < allAlbumTracks.length; x ++) {
                //get data
                let trackId = allAlbumTracks[x].id
                let albumArt = allAlbumTracks[x].album_art
                let albumGroup = allAlbumTracks[x].album_group
                let albumType = allAlbumTracks[x].album_type
                let albumArtist = allAlbumTracks[x].album_artist
                //push to lists
                slicedTrackIds.push(trackId)
                slicedTrackInfo.push({
                    trackId: trackId,
                    albumArt: albumArt,
                    albumGroup: albumGroup,
                    albumType: albumType,
                    albumArtist: albumArtist
                })
                //if it is time to make an api call:
                if(slicedTrackIds.length == multipleTracksQueryLimit){
                    //push spotify call
                    trackInfoPromises.push(getTracks(slicedTrackIds, slicedTrackInfo, allAlbumTracks.length));

                    //appearsOnAlbumTracklistPromises.push(getAlbums(slicedAlbumIds, slicedAlbumInfo));
                    //console.log(`x=${x} pushed ${slicedAlbumIds.length} slicedAlbumIds, runningTally=${runningTally}`)
                    //clear sliced lists
                    slicedTrackIds=[]
                    slicedTrackInfo=[]
                }
            } 
            if(slicedTrackIds.length > 0){
                //console.log(`outside. pushing remaining ${slicedAlbumIds.length} slicedAlbumIds`)
                //runningTally=runningTally+slicedAlbumIds.length
                
                //push spotify request for remaining values
                trackInfoPromises.push(getTracks(slicedTrackIds, slicedTrackInfo, allAlbumTracks.length));
            }
            console.log(`generatePopularifyData() trackInfoPromises.length=${trackInfoPromises.length}`)
            var trackInfoPromisesFinished = await Promise.all(trackInfoPromises);
            //sendPopularifySocketUpdate(`finished getting popularity for each track`)

            //flatten nested lists arrays
            let trackResults = []
            for(var x = 0; x < trackInfoPromisesFinished.length; x++){
                trackResults=trackResults.concat(trackInfoPromisesFinished[x].tracks)
            }
            
            //sort in order of popularity
            trackInfoPromisesFinished=trackResults.sort(function(a, b) {
                var keyA = a.popularity;
                var keyB = b.popularity;
                // Compare the 2 dates
                if (keyA < keyB) return 1;
                if (keyA > keyB) return -1;
                return 0;
              });

            //concatenate results into single list since getTracks() returns 50 at a time
            var tracks = [];
            var filteredTracks=[];
            for (var i = 0; i < trackInfoPromisesFinished.length; i++) {
                //tracks = tracks.concat(trackInfoPromisesFinished[i].tracks)
                //for(var x = 0; x < trackInfoPromisesFinished[i].tracks.length; x++){



                    filteredTracks.push([
                        
                        //albumArt
                        //`${"../static/assets/img/spotifyTrackUnknown.jpg"}` 
                        `${trackInfoPromisesFinished[i].album_art ? trackInfoPromisesFinished[i].album_art : "../static/assets/img/spotifyTrackUnknown.jpg"}`,
                        //Popularify
                        `${trackInfoPromisesFinished[i].popularity}`,
                        //title
                        `${trackInfoPromisesFinished[i].name}`,
                        //artists
                        `${createArtistsNameValue(trackInfoPromisesFinished[i].artists)}`,
                        //album
                        `${trackInfoPromisesFinished[i].album.name}`,
                        //empty row for additional info button
                        [],
                        //share button
                        `<button type="button" onClick="shareSong('${trackInfoPromisesFinished[i].id}')" class="btn btn-dark btn-circle btn-xl"><i class="fa fa-share" aria-hidden="true"></i></button>`,
                        //album_group (hidden)
                        trackInfoPromisesFinished[i].album_group,
                        //album_type (hidden)
                        trackInfoPromisesFinished[i].album_type,
                        //track id (hidden)
                        trackInfoPromisesFinished[i].album_type,
                        //album artist (hidden)
                        trackInfoPromisesFinished[i].album_artist,
                        //release_date (hidden)
                        trackInfoPromisesFinished[i].album.release_date,
                        //length
                        `${trackInfoPromisesFinished[i].duration_ms}`,
                        //trackId: 
                        trackInfoPromisesFinished[i].id,
                        //trackURL
                        `${trackInfoPromisesFinished[i].external_urls.spotify}`,
                        //available markets
                        `${trackInfoPromisesFinished[i].available_markets.join()}`

                        
                        /////////////////////////

                        /*
                        //empty row for additional detail dropdown icon
                        [],

                        //title
                        `${trackInfoPromisesFinished[i].name}`,
                        
                        //artists
                        `${createArtistsNameValue(trackInfoPromisesFinished[i].artists)}`,
                        
                        //album_artist
                        `${trackInfoPromisesFinished[i].album_artist}`,

                        //artwork: trackInfoPromisesFinished[i].album.images[0].url,
                        
                        //album
                        `${trackInfoPromisesFinished[i].album.name}`,

                        //releaseDate: trackInfoPromisesFinished[i].album.release_date,

                        //duration
                        `${trackInfoPromisesFinished[i].duration_ms}`,

                        //popularity
                        `${trackInfoPromisesFinished[i].popularity}`,

                        //trackId: 
                        //trackInfoPromisesFinished[i].album.id,
                        
                        //trackURL
                        `${trackInfoPromisesFinished[i].external_urls.spotify}`,
                        
                        //available markets
                        `${trackInfoPromisesFinished[i].available_markets.join()}`

                        //group
                        `${trackInfoPromisesFinished[i].album_group}`,

                        //type
                        `${trackInfoPromisesFinished[i].album_type}`,

                        */
                    ])
                //}
            }
            console.log('generatePopularifyData() filteredTracks.length=', filteredTracks.length)
            returnObj=filteredTracks;



        } catch (err) {
            console.log(err)
            returnObj.err = err
        }

        //get end time
        var end = new Date().getTime();
        //get total time
        var totalTime = (end - start) / 1000
        sendPopularifySocketUpdate(`Got popularity data for ${songCount} tracks from ${albumCount} albums in ${totalTime} seconds `)
        console.log('generatePopularifyData() end')
        resolve(returnObj)
    })
}

//utility functions

//send data back to front end in form of socket.io event
function sendPopularifySocketUpdate(infoString, isError=false){
    try{
        if(isError){
            io.emit('popularifyDataUpdateError', { description: `${infoString}` });
        }else{
            io.emit('popularifyDataUpdate', { description: `${infoString}` });
        }
    }catch(err){
        console.log('sendPopularifySocketUpdate() err=',err)
    }
}

//combine artists into one string
function createArtistsNameValue(artistsList){
    let artistsStr = "";
    for(var x = 0; x < artistsList.length; x++){
        artistsStr=`${artistsStr}${artistsList[x].name}`
        if(x != artistsList.length-1){
            artistsStr=`${artistsStr}, `
        }
    }
    return artistsStr;
}


////////////////////////////////////////
//Spotify API functions
////////////////////////////////////////

//search for artist, return first 20 results
async function searchArtists(searchStr) {
    return new Promise(async function (resolve, reject) {
        console.log('searchStr() ', searchStr)
        //get session
        let useThisSessionRsp = await getSession()
        let useThisSession = useThisSessionRsp.session
        let useThisSessionName = useThisSessionRsp.name
        //run query
        useThisSession.searchArtists(searchStr)
            .then(function (data) {
                //console.log(`searchArtists() found ${data.body.artists.items.length} results using session:${useThisSessionName}`);
                resolve(data.body.artists.items)
            }, async function (err) {
                console.error('searchArtists() err: ', err);
                if (err.statusCode == 429) {
                    await handle429Err(useThisSessionName, 'searchArtists()')
                    //rerun function
                    return await searchArtists(searchStr);
                }
                //reject(err)
            });
    });
}




/////////~~~~~~~~~~~~~~~~~~~~~~~~~ old ~~~~~~~~~~~~~~~~~~~

//create redirect url
async function createRedirectURL() {
    return new Promise(async function (resolve, reject) {
        console.log('createRedirectURL()')
        //create scopes
        var scopes = [
            'ugc-image-upload',
            'user-read-playback-state',
            'user-modify-playback-state',
            'user-read-currently-playing',
            'streaming',
            'app-remote-control',
            'user-read-email',
            'user-read-private',
            'playlist-read-collaborative',
            'playlist-modify-public',
            'playlist-read-private',
            'playlist-modify-private',
            'user-library-modify',
            'user-library-read',
            'user-top-read',
            'user-read-playback-position',
            'user-read-recently-played',
            'user-follow-read',
            'user-follow-modify'
        ];
        //get spotify app
        let spotifyApp = spotifyApps[`Popularify-app1`]
        //get url
        var state = 'some-state'
        var showDialog = true;
        var responseType = 'code';
        
        scopes=['user-read-private', 'user-read-email']

        let url = spotifyApp.createAuthorizeURL(
            scopes,
            state,
            showDialog,
            responseType

            //response_type: 'code',
            //client_id: client_id,
            //scope: scope,
            //redirect_uri: redirect_uri,
            //state: state
          );

        

        //return url
        resolve(url);
    })
}

//authenticate callback for user signing in
async function authCallback(error, code, state) {
    return new Promise(async function (resolve, reject) {
        if (error) {
            console.error('Callback Error:', error);
            reject(`Callback Error: ${error}`);
        }

        //get spotify app object
        let spotifyApp = spotifyApps[`Popularify-app3`]

        spotifyApp
            .authorizationCodeGrant(code)
            .then(data => {
                const access_token = data.body['access_token'];
                const refresh_token = data.body['refresh_token'];
                const expires_in = data.body['expires_in'];

                //spotifyApp.setAccessToken(access_token);
                //spotifyApp.setRefreshToken(refresh_token);
                console.log(`user logged in: access_token=${access_token}, refresh_token=${refresh_token}`)
                resolve({
                    access_token: access_token,
                    refresh_token: refresh_token
                });

                /*
                setInterval(async () => {
                    const data = await spotifyApi.refreshAccessToken();
                    const access_token = data.body['access_token'];

                    console.log('The access token has been refreshed!');
                    console.log('access_token:', access_token);
                    spotifyApi.setAccessToken(access_token);
                }, expires_in / 2 * 1000);
                */
            })
            .catch(error => {
                console.error('Error getting Tokens:', error);
                reject(`Error getting Tokens: ${error}`);
            });

    })
}


var albumsStatusTotal = 0;
// Get albums by a certain artist
async function getArtistAlbums(artistURI, offset = 0, returnTracks = false, totalAlbumsCount) {
    //console.log(`   getArtistAlbums() offset=${offset}`)
    return new Promise(async function (resolve, reject) {
        //get session
        let useThisSessionRsp = await getSession()
        let useThisSession = useThisSessionRsp.session
        let useThisSessionName = useThisSessionRsp.name
        //run query
        useThisSession.getArtistAlbums(artistURI, { offset: offset, market: "US" }).then(function (data) {
            albumsStatusTotal=albumsStatusTotal+data.body.items.length
            sendPopularifySocketUpdate(`Getting tracklist from artist album ${albumsStatusTotal}/${totalAlbumsCount}.`, false)
            if (returnTracks) {
                resolve(data.body.items)
            } else {
                resolve(data.body)
            }

        }, async function (err) {

            console.error('getArtistAlbums() err: ', err, ' waiting 30 seconds and trying again');
            await delay(30000)
            resolve(await getArtistAlbums(artistURI, offset, returnTracks, totalAlbumsCount))
        });
    })
}

//get more info for an album or multiple albums at once (20 at a time)
async function getAlbums(albums, slicedAlbumInfo, retry = 0) {
    return new Promise(async function (resolve, reject) {
        //console.log('getAlbums() Albums=',albums)
        //get session
        let useThisSessionRsp = await getSession()
        let useThisSession = useThisSessionRsp.session
        let useThisSessionName = useThisSessionRsp.name

        //run query 
        useThisSession.getAlbums(albums)
            .then(function (data) {
                //console.log(`getAlbums() got data: `, data)
                //extract album_group and album_type and add them into returned list of album objects
                for(var x = 0; x < data.body.albums.length; x++ ){
                    let albumArt = slicedAlbumInfo[x].albumArt
                    let albumGroup = slicedAlbumInfo[x].albumGroup
                    let albumType = slicedAlbumInfo[x].albumType
                    let albumArtist = slicedAlbumInfo[x].albumArtist
                    //console.log(`getAlbums() albumGroup=${albumGroup}, albumType=${albumType}, albumArtist=${albumArtist}`)
                    data.body.albums[x].album_art = albumArt
                    data.body.albums[x].album_group = albumGroup
                    data.body.albums[x].album_type = albumType
                    data.body.albums[x].album_artist = albumArtist
                }
                resolve(data.body.albums)
            }, async function (err) {
                console.log(`getAlbums() retry=${retry}, wait ${3 * retry} seconds. err=`, err, `, albums[0]=${albums[0]}`)
                await delay(30000)
                resolve(await getAlbums(albums, slicedAlbumInfo, ++retry));
            });
    })
}

async function getAlbum(album, offset = 0) {
    return new Promise(async function (resolve, reject) {
        //get session
        let useThisSessionRsp = await getSession()
        let useThisSession = useThisSessionRsp.session
        let useThisSessionName = useThisSessionRsp.name
        //run query 
        useThisSession.getAlbum(album, { offset: offset })
            .then(function (data) {
                resolve(data.body)
            }, function (err) {
                console.error(err);
                reject(err)
            });
    })
}

async function getAlbumTracks(album, offset = 0, limit = 50) {
    return new Promise(async function (resolve, reject) {
        //get session
        let useThisSessionRsp = await getSession()
        let useThisSession = useThisSessionRsp.session
        let useThisSessionName = useThisSessionRsp.name
        
        //run query 
        useThisSession.getAlbumTracks(album, { offset: offset, limit: limit })
            .then(function (data) {
                resolve(data.body)
            }, async function (err) {
                console.error('getAlbumTracks() err: ', err);
                await delay(30000)
                resolve(await getAlbumTracks(album, offset, limit));
            });
    })
}

//authenticate user
var request = require('request');
async function logUserIn(code){
    return new Promise(async function (resolve, reject) {

        var authOptions = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: "http://localhost:8080/popularify",
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer("0073a7f25706462a8850c97796960e87" + ':' + "99a48c817c6249da948ae83dcd513934").toString('base64'))
            },
            json: true
        };

        request.post(authOptions, function(error, response, body) {
            if (!error && response.statusCode === 200) {
      
              var access_token = body.access_token,
                  refresh_token = body.refresh_token;
      
              var options = {
                url: 'https://api.spotify.com/v1/me',
                headers: { 'Authorization': 'Bearer ' + access_token },
                json: true
              };
      
              // use the access token to access the Spotify Web API
              request.get(options, function(error, response, body) {
                console.log('user info: ', body);
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
              res.redirect('/#' +
                querystring.stringify({
                  error: 'invalid_token'
                }));
            }
          });

        resolve('done')
    })
}

var popularityTracksFinished = 0;
async function getTracks(tracks, slicedTrackInfo, allAlbumTracksLength, retry=0) {
    return new Promise(async function (resolve, reject) {
        //get session
        let useThisSessionRsp = await getSession()
        let useThisSession = useThisSessionRsp.session
        let useThisSessionName = useThisSessionRsp.name
        //run query 
        useThisSession.getTracks(tracks)
            .then(function (data) {
                //extract album_group/album_type from tracks[] and add into data[]
                for(var x = 0; x < data.body.tracks.length; x++ ){
                    let albumArt = slicedTrackInfo[x].albumArt
                    let albumGroup = slicedTrackInfo[x].albumGroup
                    let albumType = slicedTrackInfo[x].albumType
                    let albumArtist = slicedTrackInfo[x].albumArtist
                    data.body.tracks[x].album_art = albumArt
                    data.body.tracks[x].album_group = albumGroup
                    data.body.tracks[x].album_type = albumType
                    data.body.tracks[x].album_artist = albumArtist
                }
                popularityTracksFinished=popularityTracksFinished+data.body.tracks.length;
                sendPopularifySocketUpdate(`Got tracklists for all ${total} artist albums, getting popularity for ${popularityTracksFinished}/${allAlbumTracksLength} tracks.`)
                resolve(data.body)
            }, async function (err) {
                console.error('getTracks() err: ', err);
                await delay(30000)
                resolve(await getTracks(tracks, slicedTrackInfo, allAlbumTracksLength));
            });
    })
}

    module.exports = {
    getAccessToken: getAccessToken,
    authCallback: authCallback,
    createRedirectURL: createRedirectURL,
    getSession: getSession,
    searchArtists: searchArtists,
    generatePopularifyData: generatePopularifyData,
    logUserIn: logUserIn
};