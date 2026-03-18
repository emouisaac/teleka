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
// Use the port provided by the environment (Render, Heroku, etc.), default to 3000 for local.
const port = Number(process.env.PORT || env.PORT || 3000);

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || ''; 

// Email configuration (used for ride request notifications)
const EMAIL_HOST =
  process.env.EMAIL_HOST ||
  process.env.SMTP_HOST ||
  env.EMAIL_HOST ||
  env.SMTP_HOST ||
  '';
const EMAIL_PORT = Number(
  process.env.EMAIL_PORT ||
    process.env.SMTP_PORT ||
    env.EMAIL_PORT ||
    env.SMTP_PORT ||
    587
);
const EMAIL_SECURE =
  String(
    process.env.EMAIL_SECURE ||
      process.env.SMTP_SECURE ||
      env.EMAIL_SECURE ||
      env.SMTP_SECURE ||
      'false'
  ).toLowerCase() === 'true';
const EMAIL_USER =
  process.env.EMAIL_USER ||
  process.env.SMTP_USER ||
  env.EMAIL_USER ||
  env.SMTP_USER ||
  '';
const EMAIL_PASS =
  process.env.EMAIL_PASS ||
  process.env.SMTP_PASS ||
  env.EMAIL_PASS ||
  env.SMTP_PASS ||
  '';
const SENDGRID_API_KEY =
  process.env.SENDGRID_API_KEY ||
  env.SENDGRID_API_KEY ||
  '';
const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  env.EMAIL_FROM ||
  `no-reply@telekataxi.com`;
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

// Log email config state so it's easier to verify in hosted environments (Render, etc.)
console.log('Email config:');
console.log('  - EMAIL_HOST set:', !!EMAIL_HOST); // not printing values for security
console.log('  - EMAIL_USER set:', !!EMAIL_USER);
console.log('  - EMAIL_PASS set:', !!EMAIL_PASS);
console.log('  - SENDGRID_API_KEY set:', !!SENDGRID_API_KEY);

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
  // Prefer SendGrid API key if provided
  if (SENDGRID_API_KEY) {
    return nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: 'apikey',
        pass: SENDGRID_API_KEY,
      },
    });
  }

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

      let clientId = GOOGLE_CLIENT_ID;
      if (!clientId) {
        clientId = '{{GOOGLE_CLIENT_ID}}';
      }
      output = output.replace(/\{\{GOOGLE_CLIENT_ID\}\}/g, clientId);
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
        if (!emailResult.ok) {
          console.error('Ride request email failed:', emailResult.message || emailResult.error || 'Unknown');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: emailResult.message || 'Failed to send notification email' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, info: emailResult.info }));
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

function startServer(port) {
  const server = createServer();

  // Bind to 0.0.0.0 so hosting platforms (Render, Heroku) can route traffic in.
  server.listen(port, '0.0.0.0', () => {
    console.log(`Static server running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop.');
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nERROR: Port ${port} is already in use. Please stop the process using this port and restart.`);
      process.exit(1);
    }

    console.error('Server error:', err);
    process.exit(1);
  });
}

startServer(port);