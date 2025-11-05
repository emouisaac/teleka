const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the root and ims directory
app.use(express.static(path.join(__dirname)));
app.use('/ims', express.static(path.join(__dirname, 'ims')));

// Fallback to index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Teleka Taxi server running on http://localhost:${PORT}`);
});
