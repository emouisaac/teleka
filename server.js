const express = require('express');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the root and ims directory
app.use(express.static(path.join(__dirname)));
app.use('/ims', express.static(path.join(__dirname, 'ims')));

// Fallback to index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Places API proxy endpoint
app.get('/api/places/autocomplete', async (req, res) => {
  try {
    const { input, sessiontoken } = req.query;
    
    if (!input) {
      return res.status(400).json({ error: 'Input parameter is required' });
    }

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
      params: {
        input,
        key: process.env.GOOGLE_MAPS_API_KEY,
        sessiontoken,
        components: 'country:ug', // Restrict to Uganda
        types: 'geocode|establishment',
        language: 'en'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Places API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch places suggestions' });
  }
});

// Places details proxy endpoint
app.get('/api/places/details', async (req, res) => {
  try {
    const { place_id, sessiontoken } = req.query;
    
    if (!place_id) {
      return res.status(400).json({ error: 'place_id parameter is required' });
    }

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id,
        key: process.env.GOOGLE_MAPS_API_KEY,
        sessiontoken,
        fields: 'formatted_address,geometry,name,place_id'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Places API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch place details' });
  }
});

app.listen(PORT, () => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('\x1b[33m%s\x1b[0m', 'Warning: GOOGLE_MAPS_API_KEY environment variable is not set');
  }
  console.log(`Teleka Taxi server running on http://localhost:${PORT}`);
});
