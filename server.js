const http = require('http');
const fs = require('fs');
const path = require('path');

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
  return http.createServer((req, res) => {
    const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
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