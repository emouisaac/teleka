const http = require('http');
const data = JSON.stringify({ name: 'TEST_FROM_TELEKATAXI', pickup: 'A', destination: 'B' });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/bookings',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Origin': 'https://www.telekataxi.com',
    'Referer': 'https://www.telekataxi.com/'
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log('HEADERS', res.headers);
    console.log('BODY', body);
  });
});

req.on('error', (e) => { console.error('Request error', e); });
req.write(data);
req.end();
