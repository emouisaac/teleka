const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const baseDir = path.resolve(__dirname);

function loadEnv() {
  const envPath = path.join(baseDir, '.env');
  const result = {};
  try {
    const contents = fs.readFileSync(envPath, 'utf8');
    contents.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (!key) return;
      result[key.trim()] = rest.join('=').trim();
    });
  } catch {
    // ignore missing .env
  }
  return result;
}

const env = loadEnv();
const port = Number(process.env.PORT || env.PORT || 3000);

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || '';

const EMAIL_HOST = process.env.EMAIL_HOST || process.env.SMTP_HOST || env.EMAIL_HOST || env.SMTP_HOST || '';
const EMAIL_PORT = Number(
  process.env.EMAIL_PORT || process.env.SMTP_PORT || env.EMAIL_PORT || env.SMTP_PORT || 587
);
const EMAIL_SECURE = String(
  process.env.EMAIL_SECURE || process.env.SMTP_SECURE || env.EMAIL_SECURE || env.SMTP_SECURE || 'false'
).toLowerCase() === 'true';
const EMAIL_USER = process.env.EMAIL_USER || process.env.SMTP_USER || env.EMAIL_USER || env.SMTP_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || process.env.SMTP_PASS || env.EMAIL_PASS || env.SMTP_PASS || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || env.SENDGRID_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || env.EMAIL_FROM || 'no-reply@telekataxi.com';
const EMAIL_TO = (process.env.EMAIL_TO || env.EMAIL_TO || 'emouisaac1@gmail.com,telekataxi@gmail.com')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

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

const state = {
  settings: {
    baseFare: 3000,
    perKm: 1800,
    perMin: 300,
    surge: 1,
    cancelFee: 5000,
    currency: 'UGX',
  },
  customers: [],
  drivers: [],
  rides: [],
  notifications: [],
  meta: {
    startedAt: new Date().toISOString(),
  },
};

const sseClients = new Set();

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function sanitizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function findCustomer(customerId) {
  return state.customers.find((customer) => customer.id === customerId);
}

function findDriver(driverId) {
  return state.drivers.find((driver) => driver.id === driverId);
}

function findRide(rideId) {
  return state.rides.find((ride) => ride.id === rideId);
}

function isRideOpen(ride) {
  return !['completed', 'cancelled'].includes(ride.status);
}

function formatMoney(amount) {
  return Math.round(sanitizeNumber(amount, 0));
}

function createNotification({ targetType = 'all', targetId = null, message, type = 'info' }) {
  const notification = {
    id: makeId('notif'),
    targetType,
    targetId,
    message: normalizeText(message),
    type,
    createdAt: nowIso(),
  };
  state.notifications.unshift(notification);
  if (state.notifications.length > 200) {
    state.notifications.length = 200;
  }
  return notification;
}

function filterNotifications(role, entityId) {
  return state.notifications.filter((notification) => {
    if (notification.targetType === 'all') return true;
    if (notification.targetType === 'customers') return role === 'customer';
    if (notification.targetType === 'drivers') return role === 'driver';
    if (notification.targetType === 'customer') return role === 'customer' && notification.targetId === entityId;
    if (notification.targetType === 'driver') return role === 'driver' && notification.targetId === entityId;
    if (notification.targetType === 'admin') return role === 'admin';
    return false;
  });
}

function calculateFare({ distanceKm = 0, durationMin = 0, carType = 'standard' }) {
  const multiplierMap = {
    standard: 1,
    premium: 1.4,
    suv: 1.75,
  };
  const multiplier = multiplierMap[carType] || 1;
  return formatMoney(
    (state.settings.baseFare + distanceKm * state.settings.perKm + durationMin * state.settings.perMin) *
      state.settings.surge *
      multiplier
  );
}

function publicRide(ride) {
  const customer = findCustomer(ride.customerId);
  const driver = ride.driverId ? findDriver(ride.driverId) : null;
  return {
    ...ride,
    customerName: customer ? customer.name : 'Customer',
    customerPhone: customer ? customer.phone : '',
    driverName: driver ? driver.name : 'Unassigned',
    driverPhone: driver ? driver.phone : '',
    driverVehicle: driver ? driver.vehicle : '',
  };
}

function sortRecent(items) {
  return items.slice().sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function getAdminState() {
  const rides = sortRecent(state.rides).map(publicRide);
  const activeRides = rides.filter((ride) => ['accepted', 'arrived', 'in-progress'].includes(ride.status));
  const completedRides = rides.filter((ride) => ride.status === 'completed');
  const cancelledRides = rides.filter((ride) => ride.status === 'cancelled');
  const revenue = completedRides.reduce((sum, ride) => sum + ride.fare, 0);

  return {
    settings: state.settings,
    customers: sortRecent(state.customers),
    drivers: sortRecent(state.drivers),
    rides,
    notifications: filterNotifications('admin').slice(0, 50),
    summary: {
      totalCustomers: state.customers.length,
      totalDrivers: state.drivers.length,
      onlineDrivers: state.drivers.filter((driver) => driver.online).length,
      activeRides: activeRides.length,
      pendingRides: rides.filter((ride) => ride.status === 'pending').length,
      completedRides: completedRides.length,
      cancelledRides: cancelledRides.length,
      revenue,
    },
    serverTime: nowIso(),
  };
}

function getDriverState(driverId) {
  const driver = findDriver(driverId);
  if (!driver) return null;
  const rides = state.rides
    .filter((ride) => ride.driverId === driverId)
    .map(publicRide);
  const activeRide = rides.find((ride) => ['accepted', 'arrived', 'in-progress'].includes(ride.status)) || null;
  const availableRequests = sortRecent(
    state.rides.filter((ride) => ride.status === 'pending' && !ride.driverId)
  ).map(publicRide);
  const completedRides = rides.filter((ride) => ride.status === 'completed');
  return {
    driver,
    activeRide,
    availableRequests,
    history: sortRecent(rides.filter((ride) => !['pending'].includes(ride.status))),
    notifications: filterNotifications('driver', driverId).slice(0, 50),
    stats: {
      todayEarnings: driver.earningsToday || 0,
      totalEarnings: driver.earningsTotal || 0,
      completedTrips: completedRides.length,
      activeTrips: activeRide ? 1 : 0,
      rating: driver.rating,
      ratingCount: driver.ratingCount,
    },
    settings: state.settings,
    serverTime: nowIso(),
  };
}

function getCustomerState(customerId) {
  const customer = findCustomer(customerId);
  if (!customer) return null;
  const rides = sortRecent(state.rides.filter((ride) => ride.customerId === customerId)).map(publicRide);
  return {
    customer,
    rides,
    activeRide: rides.find((ride) => ['pending', 'accepted', 'arrived', 'in-progress'].includes(ride.status)) || null,
    notifications: filterNotifications('customer', customerId).slice(0, 50),
    settings: state.settings,
    serverTime: nowIso(),
  };
}

function broadcastState(event = 'state-update') {
  const payload = `event: ${event}\ndata: ${JSON.stringify({ time: nowIso() })}\n\n`;
  sseClients.forEach((client) => {
    client.write(payload);
  });
}

function createMailTransport() {
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

async function sendRideRequestEmail(ride) {
  const transporter = createMailTransport();
  if (!transporter) {
    return { ok: false, skipped: true, message: 'Email transport not configured' };
  }

  const customer = findCustomer(ride.customerId);
  const info = await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject: `New ride request ${ride.id}`,
    text: [
      'A new ride was created.',
      `Ride ID: ${ride.id}`,
      `Customer: ${customer ? customer.name : 'Unknown'}`,
      `Pickup: ${ride.pickup}`,
      `Dropoff: ${ride.dropoff}`,
      `Date & Time: ${ride.date}`,
      `Car Type: ${ride.carType}`,
      `Payment: ${ride.payment}`,
      `Estimated Fare: ${ride.fare}`,
    ].join('\n'),
  });

  return { ok: true, info };
}

function ensureCustomer(payload) {
  const existing = payload.customerId ? findCustomer(payload.customerId) : null;
  const timestamp = nowIso();
  if (existing) {
    existing.name = normalizeText(payload.name, existing.name || 'Customer');
    existing.email = normalizeText(payload.email, existing.email || '');
    existing.phone = normalizeText(payload.phone, existing.phone || '');
    existing.updatedAt = timestamp;
    return existing;
  }

  const customer = {
    id: makeId('cust'),
    name: normalizeText(payload.name, 'Customer'),
    email: normalizeText(payload.email, ''),
    phone: normalizeText(payload.phone, ''),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.customers.unshift(customer);
  createNotification({
    targetType: 'admin',
    message: `Customer profile updated: ${customer.name}`,
  });
  return customer;
}

function ensureDriver(payload) {
  const existing = payload.driverId ? findDriver(payload.driverId) : null;
  const timestamp = nowIso();
  if (existing) {
    existing.name = normalizeText(payload.name, existing.name || 'Driver');
    existing.phone = normalizeText(payload.phone, existing.phone || '');
    existing.vehicle = normalizeText(payload.vehicle, existing.vehicle || '');
    existing.plate = normalizeText(payload.plate, existing.plate || '');
    existing.avatar = normalizeText(payload.avatar, existing.avatar || '');
    existing.updatedAt = timestamp;
    return existing;
  }

  const driver = {
    id: makeId('drv'),
    name: normalizeText(payload.name, 'Driver'),
    phone: normalizeText(payload.phone, ''),
    vehicle: normalizeText(payload.vehicle, ''),
    plate: normalizeText(payload.plate, ''),
    avatar: normalizeText(payload.avatar, ''),
    online: false,
    status: 'active',
    currentRideId: null,
    earningsToday: 0,
    earningsTotal: 0,
    rating: 5,
    ratingCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.drivers.unshift(driver);
  createNotification({
    targetType: 'admin',
    message: `Driver registered: ${driver.name}`,
  });
  return driver;
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function routeMatches(pathname, pattern) {
  const actual = pathname.split('/').filter(Boolean);
  const expected = pattern.split('/').filter(Boolean);
  if (actual.length !== expected.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const part = expected[index];
    if (part.startsWith(':')) {
      params[part.slice(1)] = actual[index];
      continue;
    }
    if (part !== actual[index]) {
      return null;
    }
  }
  return params;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 - Internal Server Error');
      return;
    }

    let output = data;
    if (ext === '.html') {
      output = data
        .toString()
        .replace(/\{\{GOOGLE_MAPS_API_KEY\}\}/g, GOOGLE_MAPS_API_KEY || '{{GOOGLE_MAPS_API_KEY}}')
        .replace(/\{\{GOOGLE_CLIENT_ID\}\}/g, GOOGLE_CLIENT_ID || '{{GOOGLE_CLIENT_ID}}');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(output);
  });
}

function handleStaticFile(pathname, res) {
  let filePath = path.join(baseDir, pathname);
  if (pathname === '/' || pathname === '') {
    filePath = path.join(baseDir, 'index.html');
  }

  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 - Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 - Not Found');
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.access(indexPath, fs.constants.R_OK, (accessError) => {
        if (accessError) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 - Not Found');
          return;
        }
        sendFile(res, indexPath);
      });
      return;
    }

    sendFile(res, filePath);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('event: connected\ndata: {"ok":true}\n\n');
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      res.write('event: heartbeat\ndata: {}\n\n');
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return true;
  }

  if (pathname === '/api/admin/state' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, data: getAdminState() });
    return true;
  }

  if (pathname === '/api/customer/state' && req.method === 'GET') {
    const customerId = new URL(req.url, `http://${req.headers.host}`).searchParams.get('customerId');
    const customerState = customerId ? getCustomerState(customerId) : null;
    if (!customerState) {
      sendJson(res, 404, { ok: false, message: 'Customer not found' });
      return true;
    }
    sendJson(res, 200, { ok: true, data: customerState });
    return true;
  }

  if (pathname === '/api/driver/state' && req.method === 'GET') {
    const driverId = new URL(req.url, `http://${req.headers.host}`).searchParams.get('driverId');
    const driverState = driverId ? getDriverState(driverId) : null;
    if (!driverState) {
      sendJson(res, 404, { ok: false, message: 'Driver not found' });
      return true;
    }
    sendJson(res, 200, { ok: true, data: driverState });
    return true;
  }

  if (pathname === '/api/customers/session' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const customer = ensureCustomer(body);
    broadcastState();
    sendJson(res, 200, { ok: true, data: customer });
    return true;
  }

  if (pathname === '/api/drivers/session' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const driver = ensureDriver(body);
    broadcastState();
    sendJson(res, 200, { ok: true, data: driver });
    return true;
  }

  if (pathname === '/api/rides' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const customer = ensureCustomer(body.customer || body);
    const distanceKm = Math.max(0, sanitizeNumber(body.distanceKm, 0));
    const durationMin = Math.max(0, sanitizeNumber(body.durationMin, 0));
    const fare = formatMoney(body.fare || calculateFare({ distanceKm, durationMin, carType: body.carType }));

    const ride = {
      id: makeId('ride'),
      customerId: customer.id,
      driverId: null,
      pickup: normalizeText(body.pickup, 'Pickup not set'),
      dropoff: normalizeText(body.dropoff, 'Dropoff not set'),
      date: normalizeText(body.date, nowIso()),
      carType: normalizeText(body.carType, 'standard'),
      payment: normalizeText(body.payment, 'cash'),
      fare,
      distanceKm,
      durationMin,
      status: 'pending',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      timeline: {
        requestedAt: nowIso(),
      },
    };

    state.rides.unshift(ride);
    createNotification({
      targetType: 'drivers',
      message: `New ride request from ${customer.name}: ${ride.pickup} to ${ride.dropoff}`,
    });
    createNotification({
      targetType: 'customer',
      targetId: customer.id,
      message: `Ride ${ride.id} created. Waiting for a driver.`,
    });
    createNotification({
      targetType: 'admin',
      message: `New ride request ${ride.id} from ${customer.name}`,
    });

    sendRideRequestEmail(ride).catch((error) => {
      console.warn('Ride email notification failed:', error.message);
    });

    broadcastState();
    sendJson(res, 201, { ok: true, data: publicRide(ride), customer });
    return true;
  }

  const driverAvailabilityMatch = routeMatches(pathname, '/api/drivers/:driverId/availability');
  if (driverAvailabilityMatch && req.method === 'POST') {
    const driver = findDriver(driverAvailabilityMatch.driverId);
    if (!driver) {
      sendJson(res, 404, { ok: false, message: 'Driver not found' });
      return true;
    }
    const body = await parseJsonBody(req);
    driver.online = Boolean(body.online);
    driver.updatedAt = nowIso();
    createNotification({
      targetType: 'admin',
      message: `${driver.name} is now ${driver.online ? 'online' : 'offline'}`,
    });
    broadcastState();
    sendJson(res, 200, { ok: true, data: driver });
    return true;
  }

  const driverProfileMatch = routeMatches(pathname, '/api/drivers/:driverId/profile');
  if (driverProfileMatch && req.method === 'POST') {
    const driver = findDriver(driverProfileMatch.driverId);
    if (!driver) {
      sendJson(res, 404, { ok: false, message: 'Driver not found' });
      return true;
    }
    const body = await parseJsonBody(req);
    driver.name = normalizeText(body.name, driver.name);
    driver.phone = normalizeText(body.phone, driver.phone);
    driver.vehicle = normalizeText(body.vehicle, driver.vehicle);
    driver.plate = normalizeText(body.plate, driver.plate);
    driver.updatedAt = nowIso();
    createNotification({
      targetType: 'admin',
      message: `Driver profile updated: ${driver.name}`,
    });
    broadcastState();
    sendJson(res, 200, { ok: true, data: driver });
    return true;
  }

  const rideAcceptMatch = routeMatches(pathname, '/api/rides/:rideId/accept');
  if (rideAcceptMatch && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const ride = findRide(rideAcceptMatch.rideId);
    const driver = findDriver(body.driverId);
    if (!ride || !driver) {
      sendJson(res, 404, { ok: false, message: 'Ride or driver not found' });
      return true;
    }
    if (ride.status !== 'pending' || ride.driverId) {
      sendJson(res, 409, { ok: false, message: 'Ride is no longer available' });
      return true;
    }
    if (!driver.online) {
      sendJson(res, 409, { ok: false, message: 'Driver must be online to accept rides' });
      return true;
    }

    ride.driverId = driver.id;
    ride.status = 'accepted';
    ride.updatedAt = nowIso();
    ride.timeline.acceptedAt = nowIso();
    driver.currentRideId = ride.id;
    driver.updatedAt = nowIso();

    createNotification({
      targetType: 'customer',
      targetId: ride.customerId,
      message: `${driver.name} accepted your ride ${ride.id}.`,
    });
    createNotification({
      targetType: 'admin',
      message: `${driver.name} accepted ride ${ride.id}.`,
    });

    broadcastState();
    sendJson(res, 200, { ok: true, data: publicRide(ride) });
    return true;
  }

  const rideRejectMatch = routeMatches(pathname, '/api/rides/:rideId/reject');
  if (rideRejectMatch && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const ride = findRide(rideRejectMatch.rideId);
    const driver = findDriver(body.driverId);
    if (!ride || !driver) {
      sendJson(res, 404, { ok: false, message: 'Ride or driver not found' });
      return true;
    }
    createNotification({
      targetType: 'admin',
      message: `${driver.name} skipped ride ${ride.id}.`,
    });
    broadcastState();
    sendJson(res, 200, { ok: true });
    return true;
  }

  const rideStatusMatch = routeMatches(pathname, '/api/rides/:rideId/status');
  if (rideStatusMatch && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const ride = findRide(rideStatusMatch.rideId);
    if (!ride) {
      sendJson(res, 404, { ok: false, message: 'Ride not found' });
      return true;
    }

    const driver = ride.driverId ? findDriver(ride.driverId) : null;
    const requestedStatus = normalizeText(body.status);
    const allowed = {
      accepted: ['arrived', 'cancelled'],
      arrived: ['in-progress', 'cancelled'],
      'in-progress': ['completed', 'cancelled'],
    };
    const nextStates = allowed[ride.status] || [];
    if (!nextStates.includes(requestedStatus)) {
      sendJson(res, 409, { ok: false, message: 'Invalid ride status transition' });
      return true;
    }

    ride.status = requestedStatus;
    ride.updatedAt = nowIso();
    if (requestedStatus === 'arrived') ride.timeline.arrivedAt = nowIso();
    if (requestedStatus === 'in-progress') ride.timeline.startedAt = nowIso();
    if (requestedStatus === 'completed') ride.timeline.completedAt = nowIso();
    if (requestedStatus === 'cancelled') ride.timeline.cancelledAt = nowIso();

    if (requestedStatus === 'completed' && driver) {
      driver.currentRideId = null;
      driver.earningsToday = formatMoney(driver.earningsToday + ride.fare);
      driver.earningsTotal = formatMoney(driver.earningsTotal + ride.fare);
      driver.ratingCount += 1;
      driver.rating = Number(((driver.rating * Math.max(driver.ratingCount - 1, 0) + 5) / driver.ratingCount).toFixed(1));
      driver.updatedAt = nowIso();
    }

    if (requestedStatus === 'cancelled' && driver) {
      driver.currentRideId = null;
      driver.updatedAt = nowIso();
    }

    createNotification({
      targetType: 'customer',
      targetId: ride.customerId,
      message:
        requestedStatus === 'arrived'
          ? `Your driver has arrived for ride ${ride.id}.`
          : requestedStatus === 'in-progress'
            ? `Ride ${ride.id} is now in progress.`
            : requestedStatus === 'completed'
              ? `Ride ${ride.id} completed successfully.`
              : `Ride ${ride.id} was cancelled.`,
    });
    createNotification({
      targetType: 'admin',
      message: `Ride ${ride.id} status changed to ${requestedStatus}.`,
    });

    broadcastState();
    sendJson(res, 200, { ok: true, data: publicRide(ride) });
    return true;
  }

  const adminRideCancelMatch = routeMatches(pathname, '/api/rides/:rideId/cancel');
  if (adminRideCancelMatch && req.method === 'POST') {
    const ride = findRide(adminRideCancelMatch.rideId);
    if (!ride) {
      sendJson(res, 404, { ok: false, message: 'Ride not found' });
      return true;
    }
    if (!isRideOpen(ride)) {
      sendJson(res, 409, { ok: false, message: 'Ride already closed' });
      return true;
    }

    ride.status = 'cancelled';
    ride.updatedAt = nowIso();
    ride.timeline.cancelledAt = nowIso();
    const driver = ride.driverId ? findDriver(ride.driverId) : null;
    if (driver) {
      driver.currentRideId = null;
      driver.updatedAt = nowIso();
    }

    createNotification({
      targetType: 'customer',
      targetId: ride.customerId,
      message: `Ride ${ride.id} was cancelled by dispatch.`,
      type: 'warning',
    });
    createNotification({
      targetType: 'admin',
      message: `Ride ${ride.id} cancelled by admin.`,
      type: 'warning',
    });
    broadcastState();
    sendJson(res, 200, { ok: true, data: publicRide(ride) });
    return true;
  }

  if (pathname === '/api/admin/notifications' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const notification = createNotification({
      targetType: normalizeText(body.target, 'all'),
      message: normalizeText(body.message),
      type: normalizeText(body.type, 'info'),
    });
    broadcastState();
    sendJson(res, 201, { ok: true, data: notification });
    return true;
  }

  if (pathname === '/api/admin/settings' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    state.settings.baseFare = formatMoney(body.baseFare || state.settings.baseFare);
    state.settings.perKm = formatMoney(body.perKm || state.settings.perKm);
    state.settings.perMin = formatMoney(body.perMin || state.settings.perMin);
    state.settings.cancelFee = formatMoney(body.cancelFee || state.settings.cancelFee);
    state.settings.surge = Math.max(0.5, sanitizeNumber(body.surge, state.settings.surge));
    createNotification({
      targetType: 'admin',
      message: 'Platform pricing settings updated.',
    });
    broadcastState();
    sendJson(res, 200, { ok: true, data: state.settings });
    return true;
  }

  return false;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      setCorsHeaders(req, res);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      if (pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, pathname);
        if (!handled) {
          sendJson(res, 404, { ok: false, message: 'API route not found' });
        }
        return;
      }

      handleStaticFile(pathname, res);
    } catch (error) {
      console.error('Server error:', error);
      sendJson(res, 500, { ok: false, message: error.message || 'Internal server error' });
    }
  });
}

function startServer(listenPort) {
  const server = createServer();
  server.listen(listenPort, '0.0.0.0', () => {
    console.log(`Static server running at http://localhost:${listenPort}`);
    console.log('Press Ctrl+C to stop.');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`ERROR: Port ${listenPort} is already in use.`);
      process.exit(1);
    }
    console.error('Server failed to start:', error);
    process.exit(1);
  });
}

startServer(port);
