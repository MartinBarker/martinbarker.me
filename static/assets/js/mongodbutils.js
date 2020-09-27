var MongoClient = require( 'mongodb' ).MongoClient;
var _db;
var url = `mongodb+srv://dbUser:dbUserPassword@cluster0.qotrh.gcp.mongodb.net/node-blog?retryWrites=true&w=majority`;

module.exports = {
  connectToServer: function( callback ) {
    MongoClient.connect( url, {useUnifiedTopology: true}, function( err, client ) {
      _db = client.db('node-blog');
      return callback( err );
    } );
  },
  getDb: function() {
    return _db;
  }
};