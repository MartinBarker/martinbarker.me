//setup express app
const express = require('express');
const app = express();
var router = express.Router();
const mongoose = require('mongoose');
const bodyParser = require('body-parser');

//port and hosting info
const port = 8080;

//connect to mongodb server
var mongodbutil = require( './static/assets/js/mongodbutils' );
mongodbutil.connectToServer(function (err) {
    //app goes online once this callback occurs

    // error handler
    app.use(function (err, req, res, next) {
        res.status(err.status || 500);
        res.render('error');
    });
    //end of calback


    //set cors for all routes
    /*
    app.use('/', function (req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "X-Requested-With");
        next();
    });*/

    // Add headers
    app.use(function (req, res, next) {

        // Website you wish to allow to connect
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8080');

        // Request methods you wish to allow
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

        // Request headers you wish to allow
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

        // Set to true if you need the website to include cookies in the requests sent
        // to the API (e.g. in case you use sessions)
        res.setHeader('Access-Control-Allow-Credentials', true);

        // Pass to next layer of middleware
        next();
    });

    //Loads the handlebars module
    const handlebars = require('express-handlebars');

    //Sets our app to use the handlebars engine
    app.set('view engine', 'handlebars');

    app.use(bodyParser.json())
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    //Sets handlebars configurations (we will go through them later on)
    app.engine('handlebars', handlebars({
        layoutsDir: __dirname + '/views/layouts',
        helpers: {
            'ifEquals': function (arg1, arg2, options) {
                return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
            },
            'ifActiveId': function (arg1, arg2, options) {
                console.log('ifActiveId: options=', options)
                //return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
                return true;
            }
        },
    }));

    //Tells app to use '/public' folder for static files
    app.use(express.static('public'))

    //connect all routes
    const routes = require('./routes');
    app.use('/', routes);

    //use this folder for static files
    app.use('/static/', express.static(__dirname + '/static/'));

    //render and startup server
    app.listen(port, () => console.log(`App listening to port ${port}`));

});

module.exports = app;
