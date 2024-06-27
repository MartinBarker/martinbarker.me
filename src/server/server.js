const express = require('express');
const cors = require('cors');
const app = express();
const port = 3030;

// Enable CORS for all routes
app.use(cors());

app.get('/', (req, res) => {
  res.send('Hello from the Node.js server!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
