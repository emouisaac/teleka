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

// Price calculation constants
// Tuned so that a 65 km trip computes to approximately UGX 180,000
const PRICE_PER_KM = 2680; // UGX per kilometer
const MIN_FARE = 12000;    // Minimum fare of 12,000 UGX
const TRAFFIC_MULTIPLIER = {
  LOW: 1.0,
  MEDIUM: 1.15,
  HIGH: 1.3
};

// Calculate price endpoint
app.get('/api/calculate-price', async (req, res) => {
  try {
    const { origin, destination } = req.query;
    
    if (!origin || !destination) {
      return res.status(400).json({ error: 'Both origin and destination are required' });
    }

    // Get route details from Google Maps Distance Matrix API
    const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
      params: {
        origins: origin,
        destinations: destination,
        key: process.env.GOOGLE_MAPS_API_KEY,
        departure_time: 'now',
        traffic_model: 'best_guess'
      }
    });

    if (response.data.status !== 'OK') {
      throw new Error('Failed to calculate distance');
    }

    const result = response.data.rows[0].elements[0];
    if (result.status !== 'OK') {
      throw new Error('No route found');
    }

    // Extract distance in kilometers and duration in minutes
    const distanceKm = result.distance.value / 1000;
    const durationMinutes = result.duration.value / 60;
    const trafficDuration = result.duration_in_traffic?.value / 60;

    // Calculate traffic multiplier
    let trafficMultiplier = TRAFFIC_MULTIPLIER.LOW;
    if (trafficDuration) {
      const trafficRatio = trafficDuration / durationMinutes;
      if (trafficRatio > 1.5) {
        trafficMultiplier = TRAFFIC_MULTIPLIER.HIGH;
      } else if (trafficRatio > 1.2) {
        trafficMultiplier = TRAFFIC_MULTIPLIER.MEDIUM;
      }
    }

    // Calculate base price (per-km rate tuned to match expected fares)
    const raw = distanceKm * PRICE_PER_KM * trafficMultiplier;
    // Log detailed values for debugging pricing discrepancies
    console.log('[price-calc] origin=%s destination=%s distance_m=%d distance_km=%.3f PRICE_PER_KM=%d trafficMultiplier=%.2f raw=%.2f',
      origin, destination, result.distance.value, distanceKm, PRICE_PER_KM, trafficMultiplier, raw);
    let price = Math.max(
      MIN_FARE,
      Math.round(raw / 1000) * 1000
    );

    // Add peak hour surcharge (7-9 AM and 5-7 PM on weekdays)
    const now = new Date();
    const hour = now.getHours();
    const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
    if (isWeekday && ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19))) {
      price *= 1.2; // 20% peak hour surcharge
    }

    res.json({
      price: Math.round(price),
      distance: result.distance,
      duration: result.duration_in_traffic || result.duration,
      traffic_level: trafficMultiplier === TRAFFIC_MULTIPLIER.HIGH ? 'High' :
                    trafficMultiplier === TRAFFIC_MULTIPLIER.MEDIUM ? 'Medium' : 'Low'
    });
  } catch (error) {
    console.error('Price calculation error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

// Places API proxy endpoint
app.get('/api/places/autocomplete', async (req, res) => {
  try {
    const { input, types, sessiontoken } = req.query;
    
    if (!input) {
      return res.status(400).json({ error: 'Input parameter is required' });
    }

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
      params: {
        input,
        key: process.env.GOOGLE_MAPS_API_KEY,
        sessiontoken,
        components: 'country:ug', // Restrict to Uganda
        types: types || 'geocode|establishment',
        language: 'en',
        strictbounds: true,
        location: '0.3476,32.5825', // Kampala center
        radius: 50000 // 50km radius to cover greater Kampala
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
        fields: 'formatted_address,geometry,name,place_id,types,vicinity,rating'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Places API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch place details' });
  }
});

// Nearby places endpoint
app.get('/api/places/nearby', async (req, res) => {
  try {
    const { location, types, sessiontoken } = req.query;
    
    if (!location) {
      return res.status(400).json({ error: 'location parameter is required' });
    }

    const [lat, lng] = location.split(',').map(Number);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid location format. Use "latitude,longitude"' });
    }

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
      params: {
        location: `${lat},${lng}`,
        radius: 5000, // 5km radius
        type: types ? types.split('|') : undefined,
        key: process.env.GOOGLE_MAPS_API_KEY,
        sessiontoken,
        language: 'en',
        rankby: 'prominence' // Get most popular places first
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Places API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch nearby places' });
  }
});

// Quick test endpoint: compute price from a given distance (km) and optional traffic level
app.get('/api/price-from-distance', (req, res) => {
  try {
    const km = parseFloat(req.query.km);
    const traffic = (req.query.traffic || 'low').toLowerCase();
    if (isNaN(km) || km <= 0) return res.status(400).json({ error: 'Provide km as a positive number, e.g. ?km=65.4' });

    const trafficMultiplier = traffic === 'high' ? TRAFFIC_MULTIPLIER.HIGH : (traffic === 'medium' ? TRAFFIC_MULTIPLIER.MEDIUM : TRAFFIC_MULTIPLIER.LOW);
    const raw = km * PRICE_PER_KM * trafficMultiplier;
    const price = Math.max(MIN_FARE, Math.round(raw / 1000) * 1000);
    return res.json({ km, traffic, PRICE_PER_KM, trafficMultiplier, raw, price });
  } catch (err) {
    return res.status(500).json({ error: 'Internal' });
  }
});

app.listen(PORT, () => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('\x1b[33m%s\x1b[0m', 'Warning: GOOGLE_MAPS_API_KEY environment variable is not set');
  }
  console.log(`Teleka Taxi server running on http://localhost:${PORT}`);
});



