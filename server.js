const express = require('express');
const cors = require('cors');
const app = express();
const port = 3030;

console.log('server.js staring')

// Enable CORS for all routes
app.use(cors());

async function makeTestQuery(){
  return new Promise(async function (resolve, reject) {
    resolve({"cool":"stuff"})
  })
}

app.get('/dbtest', async (req, res) => {
  console.log("Making test query")
  let queryResults = await makeTestQuery()
  res.send(queryResults);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

