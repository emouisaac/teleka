const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const baseDir = path.resolve(__dirname);

// Load simple .env file (KEY=VALUE) so the server can respect the values in .env
function loadEnv() {
  const envPath = path.join(baseDir, '.env');
  const result = {};
  try {
    const contents = fs.readFileSync(envPath, 'utf8');
    contents.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (!key) return;
      result[key.trim()] = rest.join('=').trim();
    });
  } catch (err) {
    // ignore missing .env
  }
  return result;
}

const env = loadEnv();
const port = Number(process.env.PORT || env.PORT || 3000);

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || '';

// Email configuration (used for ride request notifications)
const EMAIL_HOST = process.env.EMAIL_HOST || env.EMAIL_HOST || '';
const EMAIL_PORT = Number(process.env.EMAIL_PORT || env.EMAIL_PORT || 587);
const EMAIL_SECURE = String(process.env.EMAIL_SECURE || env.EMAIL_SECURE || 'false').toLowerCase() === 'true';
const EMAIL_USER = process.env.EMAIL_USER || env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || env.EMAIL_FROM || `no-reply@telekataxi.com`;
const EMAIL_TO = (process.env.EMAIL_TO || env.EMAIL_TO || 'emouisaac1@gmail.com,telekataxi@gmail.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!GOOGLE_MAPS_API_KEY) {
  console.warn('\nWARNING: GOOGLE_MAPS_API_KEY is not set.');
  console.warn('Set GOOGLE_MAPS_API_KEY in your .env file to enable Google Maps autocomplete + directions.');
  console.warn('Example .env line: GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE\n');
} else {
  const keyShort = `${GOOGLE_MAPS_API_KEY.slice(0, 6)}...${GOOGLE_MAPS_API_KEY.slice(-4)}`;
  console.log(`Using Google Maps API key: ${keyShort}`);
}

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        // Too much POST data, kill the connection
        req.connection.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function createMailTransport() {
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_SECURE,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });
}

async function sendRideRequestEmail(rideRequest) {
  const transporter = createMailTransport();
  if (!transporter) {
    console.warn('Email not sent: SMTP configuration is missing (EMAIL_HOST/EMAIL_USER/EMAIL_PASS).');
    return {
      ok: false,
      message: 'Email transport not configured',
    };
  }

  const subject = `New Ride Request from ${rideRequest.pickup || 'unknown'} -> ${rideRequest.dropoff || 'unknown'}`;
  const body = `A new ride request was submitted:

Pickup: ${rideRequest.pickup || '-'}
Dropoff: ${rideRequest.dropoff || '-'}
Date & Time: ${rideRequest.date || '-'}
Car Type: ${rideRequest.carType || '-'}
Payment: ${rideRequest.payment || '-'}

Submitted from: ${rideRequest.origin || 'unknown'}
`;

  const info = await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject,
    text: body,
  });

  return { ok: true, info };
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 - Internal Server Error');
      return;
    }

    let output = data;
    if (ext === '.html') {
      // Inject environment values into HTML placeholders.
      let apiKey = GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        // Keep placeholder in place so the browser error is clearer.
        apiKey = '{{GOOGLE_MAPS_API_KEY}}';
      }
      output = data.toString().replace(/\{\{GOOGLE_MAPS_API_KEY\}\}/g, apiKey);
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(output);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
    const origin = req.headers.origin;
    const host = req.headers.host || '';

    // Allow CORS for configured origins (useful when site is behind a proxy or served from a different domain)
    if (origin && ALLOWED_ORIGINS.length) {
      if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
    }

    // Handle ride request API call
    if (urlPath === '/api/ride-request') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('405 - Method Not Allowed');
        return;
      }

      // Only send emails when served from the expected domains
      if (!host.includes('telekataxi.com')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Ride requests are only processed from telekataxi.com domains.' }));
        return;
      }

      try {
        const body = await parseJsonBody(req);
        const rideRequest = {
          pickup: body.pickup || body.pickupLocation || '-',
          dropoff: body.dropoff || body.dropoffLocation || '-',
          date: body.date || body.rideDate || '-',
          carType: body.carType || '-',
          payment: body.payment || '-',
          origin: origin || host,
        };

        const emailResult = await sendRideRequestEmail(rideRequest);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: emailResult.ok, info: emailResult.info || emailResult.message }));
      } catch (err) {
        console.error('Error processing ride request:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message || 'Internal server error' }));
      }

      return;
    }

    let filePath = path.join(baseDir, urlPath);

    // Serve index.html for root paths
    if (urlPath === '/' || urlPath === '') {
      filePath = path.join(baseDir, 'index.html');
    }

    // Prevent directory traversal
    if (!filePath.startsWith(baseDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 - Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 - Not Found');
        return;
      }

      if (stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        fs.access(filePath, fs.constants.R_OK, err => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 - Not Found');
            return;
          }
          sendFile(res, filePath);
        });
        return;
      }

      sendFile(res, filePath);
    });
  });
}

function startServer(startPort, maxAttempts = 10) {
  let attempt = 0;
  let runningPort = startPort;

  function tryListen() {
    const server = createServer();

    server.listen(runningPort, () => {
      console.log(`Static server running at http://localhost:${runningPort}`);
      console.log('Press Ctrl+C to stop.');
    });

    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        if (attempt >= maxAttempts) {
          console.error(`\nERROR: Port ${runningPort} is already in use and max retry attempts reached.`);
          process.exit(1);
        }

        console.warn(`Port ${runningPort} is in use. Trying port ${runningPort + 1}...`);
        attempt += 1;
        runningPort += 1;
        setTimeout(tryListen, 200);
        return;
      }

      console.error('Server error:', err);
      process.exit(1);
    });
  }

  tryListen();
}

startServer(port);