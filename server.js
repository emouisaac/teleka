const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const baseDir = path.resolve(__dirname);
const dataDir = path.join(baseDir, 'data');
const dataFile = path.join(dataDir, 'teleka-store.json');

function loadEnv() {
  const out = {};
  try {
    fs.readFileSync(path.join(baseDir, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (key) out[key.trim()] = rest.join('=').trim();
    });
  } catch {}
  return out;
}

const env = loadEnv();
const port = Number(process.env.PORT || env.PORT || 3000);
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || '';
const AUTH_SECRET = process.env.AUTH_SECRET || env.AUTH_SECRET || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || env.ADMIN_PASSWORD_HASH || '';
const EMAIL_HOST = process.env.EMAIL_HOST || env.EMAIL_HOST || '';
const EMAIL_PORT = Number(process.env.EMAIL_PORT || env.EMAIL_PORT || 587);
const EMAIL_SECURE = String(process.env.EMAIL_SECURE || env.EMAIL_SECURE || 'false').toLowerCase() === 'true';
const EMAIL_USER = process.env.EMAIL_USER || env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || env.EMAIL_PASS || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || env.SENDGRID_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || env.EMAIL_FROM || 'no-reply@telekataxi.com';
const EMAIL_TO = (process.env.EMAIL_TO || env.EMAIL_TO || '').split(',').map((v) => v.trim()).filter(Boolean);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const baseState = () => ({
  settings: { baseFare: 3000, perKm: 1800, perMin: 300, surge: 1, cancelFee: 5000, currency: 'UGX' },
  customers: [],
  drivers: [],
  rides: [],
  notifications: [],
  meta: { startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
});

let state = loadState();
const sseClients = new Set();

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      ...baseState(),
      ...parsed,
      settings: { ...baseState().settings, ...(parsed.settings || {}) },
      customers: parsed.customers || [],
      drivers: parsed.drivers || [],
      rides: parsed.rides || [],
      notifications: parsed.notifications || [],
      meta: { ...baseState().meta, ...(parsed.meta || {}) },
    };
  } catch {
    return baseState();
  }
}

function saveState() {
  state.meta.updatedAt = new Date().toISOString();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`; }
function text(value, fallback = '') { return String(value || fallback).trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function money(value) { return Math.round(num(value, 0)); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function secret() { return crypto.randomBytes(24).toString('hex'); }
function findCustomer(customerId) { return state.customers.find((item) => item.id === customerId); }
function findDriver(driverId) { return state.drivers.find((item) => item.id === driverId); }
function findRide(rideId) { return state.rides.find((item) => item.id === rideId); }
function safeCustomer(customer) { if (!customer) return null; const { accessKeyHash, ...safe } = customer; return safe; }
function safeDriver(driver) { if (!driver) return null; const { accessKeyHash, ...safe } = driver; return safe; }
function recent(items) { return items.slice().sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)); }

function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || !AUTH_SECRET) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
  if (sig !== expected) return null;
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function issueToken(role, sub) {
  return signToken({ role, sub, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
}

function getToken(req, url) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return url.searchParams.get('token') || '';
}

function requireAuth(req, url, role) {
  const auth = verifyToken(getToken(req, url));
  if (!auth || (role && auth.role !== role)) return null;
  return auth;
}

function notification({ targetType = 'all', targetId = null, message, type = 'info' }) {
  state.notifications.unshift({ id: id('notif'), targetType, targetId, message: text(message), type, createdAt: now() });
  state.notifications = state.notifications.slice(0, 300);
  saveState();
}

function filterNotifications(role, entityId) {
  return state.notifications.filter((item) => {
    if (item.targetType === 'all') return true;
    if (item.targetType === 'customers') return role === 'customer';
    if (item.targetType === 'drivers') return role === 'driver';
    if (item.targetType === 'admin') return role === 'admin';
    if (item.targetType === 'customer') return role === 'customer' && item.targetId === entityId;
    if (item.targetType === 'driver') return role === 'driver' && item.targetId === entityId;
    return false;
  });
}

function fare({ distanceKm = 0, durationMin = 0, carType = 'standard' }) {
  const mult = { standard: 1, premium: 1.4, suv: 1.75 }[carType] || 1;
  return money((state.settings.baseFare + distanceKm * state.settings.perKm + durationMin * state.settings.perMin) * state.settings.surge * mult);
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

function adminState() {
  const rides = recent(state.rides).map(publicRide);
  const completed = rides.filter((ride) => ride.status === 'completed');
  return {
    settings: state.settings,
    customers: recent(state.customers).map(safeCustomer),
    drivers: recent(state.drivers).map(safeDriver),
    rides,
    notifications: filterNotifications('admin').slice(0, 50),
    summary: {
      totalCustomers: state.customers.length,
      totalDrivers: state.drivers.length,
      onlineDrivers: state.drivers.filter((driver) => driver.online).length,
      activeRides: rides.filter((ride) => ['accepted', 'arrived', 'in-progress'].includes(ride.status)).length,
      pendingRides: rides.filter((ride) => ride.status === 'pending').length,
      completedRides: completed.length,
      cancelledRides: rides.filter((ride) => ride.status === 'cancelled').length,
      revenue: completed.reduce((sum, ride) => sum + ride.fare, 0),
    },
    serverTime: now(),
  };
}

function customerState(customerId) {
  const customer = findCustomer(customerId);
  if (!customer) return null;
  const rides = recent(state.rides.filter((ride) => ride.customerId === customerId)).map(publicRide);
  return {
    customer: safeCustomer(customer),
    rides,
    activeRide: rides.find((ride) => ['pending', 'accepted', 'arrived', 'in-progress'].includes(ride.status)) || null,
    notifications: filterNotifications('customer', customerId).slice(0, 50),
    settings: state.settings,
    serverTime: now(),
  };
}

function driverState(driverId) {
  const driver = findDriver(driverId);
  if (!driver) return null;
  const rides = state.rides.filter((ride) => ride.driverId === driverId).map(publicRide);
  return {
    driver: safeDriver(driver),
    activeRide: rides.find((ride) => ['accepted', 'arrived', 'in-progress'].includes(ride.status)) || null,
    availableRequests: recent(state.rides.filter((ride) => ride.status === 'pending' && !ride.driverId)).map(publicRide),
    history: recent(rides.filter((ride) => ride.status !== 'pending')),
    notifications: filterNotifications('driver', driverId).slice(0, 50),
    settings: state.settings,
    serverTime: now(),
  };
}

function createCustomerSession(body) {
  const existing = text(body.customerId) ? findCustomer(text(body.customerId)) : null;
  if (existing) {
    if (!text(body.accessKey) || existing.accessKeyHash !== hash(body.accessKey)) {
      throw new Error('Customer authentication failed');
    }
    existing.name = text(body.name, existing.name);
    existing.email = text(body.email, existing.email);
    existing.phone = text(body.phone, existing.phone);
    existing.updatedAt = now();
    saveState();
    return { customer: safeCustomer(existing), accessKey: text(body.accessKey), token: issueToken('customer', existing.id) };
  }
  const accessKey = secret();
  const customer = {
    id: id('cust'),
    name: text(body.name, 'Customer'),
    email: text(body.email),
    phone: text(body.phone),
    accessKeyHash: hash(accessKey),
    createdAt: now(),
    updatedAt: now(),
  };
  state.customers.unshift(customer);
  saveState();
  notification({ targetType: 'admin', message: `Customer profile created: ${customer.name}` });
  return { customer: safeCustomer(customer), accessKey, token: issueToken('customer', customer.id) };
}

function createDriverSession(body) {
  const existing = text(body.driverId) ? findDriver(text(body.driverId)) : null;
  if (existing) {
    if (!text(body.accessKey) || existing.accessKeyHash !== hash(body.accessKey)) {
      throw new Error('Driver authentication failed');
    }
    existing.name = text(body.name, existing.name);
    existing.phone = text(body.phone, existing.phone);
    existing.vehicle = text(body.vehicle, existing.vehicle);
    existing.plate = text(body.plate, existing.plate);
    existing.avatar = text(body.avatar, existing.avatar);
    existing.updatedAt = now();
    saveState();
    return { driver: safeDriver(existing), accessKey: text(body.accessKey), token: issueToken('driver', existing.id) };
  }
  const accessKey = secret();
  const driver = {
    id: id('drv'),
    name: text(body.name, 'Driver'),
    phone: text(body.phone),
    vehicle: text(body.vehicle),
    plate: text(body.plate),
    avatar: text(body.avatar),
    accessKeyHash: hash(accessKey),
    online: false,
    status: 'active',
    currentRideId: null,
    earningsToday: 0,
    earningsTotal: 0,
    rating: 5,
    ratingCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  state.drivers.unshift(driver);
  saveState();
  notification({ targetType: 'admin', message: `Driver profile created: ${driver.name}` });
  return { driver: safeDriver(driver), accessKey, token: issueToken('driver', driver.id) };
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
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
}

function routeMatches(pathname, pattern) {
  const actual = pathname.split('/').filter(Boolean);
  const expected = pattern.split('/').filter(Boolean);
  if (actual.length !== expected.length) return null;
  const params = {};
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i].startsWith(':')) params[expected[i].slice(1)] = actual[i];
    else if (expected[i] !== actual[i]) return null;
  }
  return params;
}

function broadcastState() {
  const payload = `event: state-update\ndata: ${JSON.stringify({ time: now() })}\n\n`;
  sseClients.forEach((client) => client.write(payload));
}

function createMailTransport() {
  if (SENDGRID_API_KEY) {
    return nodemailer.createTransport({ service: 'SendGrid', auth: { user: 'apikey', pass: SENDGRID_API_KEY } });
  }
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) return null;
  return nodemailer.createTransport({ host: EMAIL_HOST, port: EMAIL_PORT, secure: EMAIL_SECURE, auth: { user: EMAIL_USER, pass: EMAIL_PASS } });
}

async function sendRideRequestEmail(ride) {
  const transporter = createMailTransport();
  if (!transporter) return;
  const customer = findCustomer(ride.customerId);
  await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject: `New ride request ${ride.id}`,
    text: [`Ride ID: ${ride.id}`, `Customer: ${customer ? customer.name : 'Unknown'}`, `Pickup: ${ride.pickup}`, `Dropoff: ${ride.dropoff}`, `Date: ${ride.date}`].join('\n'),
  });
}

function verifyAdminPassword(password) {
  if (ADMIN_PASSWORD_HASH) return hash(password) === ADMIN_PASSWORD_HASH;
  return Boolean(ADMIN_PASSWORD) && password === ADMIN_PASSWORD;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    const auth = requireAuth(req, url);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Authentication required' }), true;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('event: connected\ndata: {"ok":true}\n\n');
    sseClients.add(res);
    const heartbeat = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), 25000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
    return true;
  }

  if (pathname === '/api/auth/admin/login' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    if (!AUTH_SECRET || !ADMIN_EMAIL || text(body.email).toLowerCase() !== ADMIN_EMAIL.toLowerCase() || !verifyAdminPassword(text(body.password))) {
      return sendJson(res, 401, { ok: false, message: 'Invalid admin credentials' }), true;
    }
    return sendJson(res, 200, { ok: true, data: { token: issueToken('admin', ADMIN_EMAIL), admin: { email: ADMIN_EMAIL } } }), true;
  }

  if (pathname === '/api/auth/customer/session' && req.method === 'POST') {
    try { return sendJson(res, 200, { ok: true, data: createCustomerSession(await parseJsonBody(req)) }), broadcastState(), true; }
    catch (error) { return sendJson(res, 401, { ok: false, message: error.message }), true; }
  }

  if (pathname === '/api/auth/driver/session' && req.method === 'POST') {
    try { return sendJson(res, 200, { ok: true, data: createDriverSession(await parseJsonBody(req)) }), broadcastState(), true; }
    catch (error) { return sendJson(res, 401, { ok: false, message: error.message }), true; }
  }

  if (pathname === '/api/admin/state' && req.method === 'GET') {
    const auth = requireAuth(req, url, 'admin');
    return auth ? (sendJson(res, 200, { ok: true, data: adminState() }), true) : (sendJson(res, 401, { ok: false, message: 'Authentication required' }), true);
  }

  if (pathname === '/api/customer/state' && req.method === 'GET') {
    const auth = requireAuth(req, url, 'customer');
    const data = auth ? customerState(auth.sub) : null;
    return data ? (sendJson(res, 200, { ok: true, data }), true) : (sendJson(res, 401, { ok: false, message: 'Authentication required' }), true);
  }

  if (pathname === '/api/driver/state' && req.method === 'GET') {
    const auth = requireAuth(req, url, 'driver');
    const data = auth ? driverState(auth.sub) : null;
    return data ? (sendJson(res, 200, { ok: true, data }), true) : (sendJson(res, 401, { ok: false, message: 'Authentication required' }), true);
  }

  if (pathname === '/api/rides' && req.method === 'POST') {
    const auth = requireAuth(req, url, 'customer');
    const customer = auth ? findCustomer(auth.sub) : null;
    if (!customer) return sendJson(res, 401, { ok: false, message: 'Authentication required' }), true;
    const body = await parseJsonBody(req);
    const ride = {
      id: id('ride'),
      customerId: customer.id,
      driverId: null,
      pickup: text(body.pickup, 'Pickup not set'),
      dropoff: text(body.dropoff, 'Dropoff not set'),
      date: text(body.date, now()),
      carType: text(body.carType, 'standard'),
      payment: text(body.payment, 'cash'),
      fare: money(body.fare || fare({ distanceKm: Math.max(0, num(body.distanceKm, 0)), durationMin: Math.max(0, num(body.durationMin, 0)), carType: body.carType })),
      distanceKm: Math.max(0, num(body.distanceKm, 0)),
      durationMin: Math.max(0, num(body.durationMin, 0)),
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
      timeline: { requestedAt: now() },
    };
    state.rides.unshift(ride);
    saveState();
    notification({ targetType: 'drivers', message: `New ride request from ${customer.name}: ${ride.pickup} to ${ride.dropoff}` });
    notification({ targetType: 'customer', targetId: customer.id, message: `Ride ${ride.id} created. Waiting for a driver.` });
    notification({ targetType: 'admin', message: `New ride request ${ride.id} from ${customer.name}` });
    sendRideRequestEmail(ride).catch(() => {});
    broadcastState();
    return sendJson(res, 201, { ok: true, data: publicRide(ride) }), true;
  }

  const availability = routeMatches(pathname, '/api/drivers/:driverId/availability');
  if (availability && req.method === 'POST') {
    const auth = requireAuth(req, url, 'driver');
    if (!auth || auth.sub !== availability.driverId) return sendJson(res, 403, { ok: false, message: 'Forbidden' }), true;
    const driver = findDriver(auth.sub);
    driver.online = Boolean((await parseJsonBody(req)).online);
    driver.updatedAt = now();
    saveState();
    notification({ targetType: 'admin', message: `${driver.name} is now ${driver.online ? 'online' : 'offline'}` });
    broadcastState();
    return sendJson(res, 200, { ok: true, data: safeDriver(driver) }), true;
  }

  const profile = routeMatches(pathname, '/api/drivers/:driverId/profile');
  if (profile && req.method === 'POST') {
    const auth = requireAuth(req, url, 'driver');
    if (!auth || auth.sub !== profile.driverId) return sendJson(res, 403, { ok: false, message: 'Forbidden' }), true;
    const driver = findDriver(auth.sub);
    const body = await parseJsonBody(req);
    driver.name = text(body.name, driver.name);
    driver.phone = text(body.phone, driver.phone);
    driver.vehicle = text(body.vehicle, driver.vehicle);
    driver.plate = text(body.plate, driver.plate);
    driver.updatedAt = now();
    saveState();
    notification({ targetType: 'admin', message: `Driver profile updated: ${driver.name}` });
    broadcastState();
    return sendJson(res, 200, { ok: true, data: safeDriver(driver) }), true;
  }

  const accept = routeMatches(pathname, '/api/rides/:rideId/accept');
  if (accept && req.method === 'POST') {
    const auth = requireAuth(req, url, 'driver');
    const ride = auth ? findRide(accept.rideId) : null;
    const driver = auth ? findDriver(auth.sub) : null;
    if (!ride || !driver) return sendJson(res, 401, { ok: false, message: 'Authentication required' }), true;
    if (ride.status !== 'pending' || ride.driverId) return sendJson(res, 409, { ok: false, message: 'Ride is no longer available' }), true;
    if (!driver.online) return sendJson(res, 409, { ok: false, message: 'Driver must be online to accept rides' }), true;
    ride.driverId = driver.id;
    ride.status = 'accepted';
    ride.updatedAt = now();
    ride.timeline.acceptedAt = now();
    driver.currentRideId = ride.id;
    driver.updatedAt = now();
    saveState();
    notification({ targetType: 'customer', targetId: ride.customerId, message: `${driver.name} accepted your ride ${ride.id}.` });
    notification({ targetType: 'admin', message: `${driver.name} accepted ride ${ride.id}.` });
    broadcastState();
    return sendJson(res, 200, { ok: true, data: publicRide(ride) }), true;
  }

  const reject = routeMatches(pathname, '/api/rides/:rideId/reject');
  if (reject && req.method === 'POST') {
    const auth = requireAuth(req, url, 'driver');
    const driver = auth ? findDriver(auth.sub) : null;
    const ride = findRide(reject.rideId);
    if (!driver || !ride) return sendJson(res, 401, { ok: false, message: 'Authentication required' }), true;
    notification({ targetType: 'admin', message: `${driver.name} skipped ride ${ride.id}.` });
    broadcastState();
    return sendJson(res, 200, { ok: true }), true;
  }

  const statusRoute = routeMatches(pathname, '/api/rides/:rideId/status');
  if (statusRoute && req.method === 'POST') {
    const auth = requireAuth(req, url, 'driver');
    const ride = auth ? findRide(statusRoute.rideId) : null;
    if (!ride || ride.driverId !== auth.sub) return sendJson(res, 403, { ok: false, message: 'Forbidden' }), true;
    const driver = findDriver(auth.sub);
    const requested = text((await parseJsonBody(req)).status);
    const allowed = { accepted: ['arrived', 'cancelled'], arrived: ['in-progress', 'cancelled'], 'in-progress': ['completed', 'cancelled'] }[ride.status] || [];
    if (!allowed.includes(requested)) return sendJson(res, 409, { ok: false, message: 'Invalid ride status transition' }), true;
    ride.status = requested;
    ride.updatedAt = now();
    if (requested === 'arrived') ride.timeline.arrivedAt = now();
    if (requested === 'in-progress') ride.timeline.startedAt = now();
    if (requested === 'completed') ride.timeline.completedAt = now();
    if (requested === 'cancelled') ride.timeline.cancelledAt = now();
    if (requested === 'completed') {
      driver.currentRideId = null;
      driver.earningsToday = money(driver.earningsToday + ride.fare);
      driver.earningsTotal = money(driver.earningsTotal + ride.fare);
      driver.ratingCount += 1;
      driver.rating = Number(((driver.rating * Math.max(driver.ratingCount - 1, 0) + 5) / driver.ratingCount).toFixed(1));
    }
    if (requested === 'cancelled') driver.currentRideId = null;
    driver.updatedAt = now();
    saveState();
    notification({ targetType: 'customer', targetId: ride.customerId, message: requested === 'arrived' ? `Your driver has arrived for ride ${ride.id}.` : requested === 'in-progress' ? `Ride ${ride.id} is now in progress.` : requested === 'completed' ? `Ride ${ride.id} completed successfully.` : `Ride ${ride.id} was cancelled.` });
    notification({ targetType: 'admin', message: `Ride ${ride.id} status changed to ${requested}.` });
    broadcastState();
    return sendJson(res, 200, { ok: true, data: publicRide(ride) }), true;
  }

  const cancel = routeMatches(pathname, '/api/rides/:rideId/cancel');
  if (cancel && req.method === 'POST') {
    const auth = requireAuth(req, url, 'admin');
    const ride = auth ? findRide(cancel.rideId) : null;
    if (!ride) return sendJson(res, 401, { ok: false, message: 'Authentication required' }), true;
    if (['completed', 'cancelled'].includes(ride.status)) return sendJson(res, 409, { ok: false, message: 'Ride already closed' }), true;
    ride.status = 'cancelled';
    ride.updatedAt = now();
    ride.timeline.cancelledAt = now();
    const driver = ride.driverId ? findDriver(ride.driverId) : null;
    if (driver) { driver.currentRideId = null; driver.updatedAt = now(); }
    saveState();
    notification({ targetType: 'customer', targetId: ride.customerId, message: `Ride ${ride.id} was cancelled by dispatch.`, type: 'warning' });
    notification({ targetType: 'admin', message: `Ride ${ride.id} cancelled by admin.`, type: 'warning' });
    broadcastState();
    return sendJson(res, 200, { ok: true, data: publicRide(ride) }), true;
  }

  if (pathname === '/api/admin/notifications' && req.method === 'POST') {
    const auth = requireAuth(req, url, 'admin');
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Authentication required' }), true;
    const body = await parseJsonBody(req);
    notification({ targetType: text(body.target, 'all'), message: text(body.message), type: text(body.type, 'info') });
    broadcastState();
    return sendJson(res, 201, { ok: true, data: true }), true;
  }

  if (pathname === '/api/admin/settings' && req.method === 'POST') {
    const auth = requireAuth(req, url, 'admin');
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Authentication required' }), true;
    const body = await parseJsonBody(req);
    state.settings.baseFare = money(body.baseFare || state.settings.baseFare);
    state.settings.perKm = money(body.perKm || state.settings.perKm);
    state.settings.perMin = money(body.perMin || state.settings.perMin);
    state.settings.cancelFee = money(body.cancelFee || state.settings.cancelFee);
    state.settings.surge = Math.max(0.5, num(body.surge, state.settings.surge));
    saveState();
    notification({ targetType: 'admin', message: 'Platform pricing settings updated.' });
    broadcastState();
    return sendJson(res, 200, { ok: true, data: state.settings }), true;
  }

  return false;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (error, data) => {
    if (error) return res.writeHead(500, { 'Content-Type': 'text/plain' }), res.end('500 - Internal Server Error');
    let output = data;
    if (ext === '.html') {
      output = data.toString()
        .replace(/\{\{GOOGLE_MAPS_API_KEY\}\}/g, GOOGLE_MAPS_API_KEY || '{{GOOGLE_MAPS_API_KEY}}')
        .replace(/\{\{GOOGLE_CLIENT_ID\}\}/g, GOOGLE_CLIENT_ID || '{{GOOGLE_CLIENT_ID}}');
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(output);
  });
}

function handleStaticFile(pathname, res) {
  let filePath = path.join(baseDir, pathname);
  if (pathname === '/' || pathname === '') filePath = path.join(baseDir, 'index.html');
  if (!filePath.startsWith(baseDir)) return res.writeHead(403, { 'Content-Type': 'text/plain' }), res.end('403 - Forbidden');
  fs.stat(filePath, (error, stats) => {
    if (error) return res.writeHead(404, { 'Content-Type': 'text/plain' }), res.end('404 - Not Found');
    if (stats.isDirectory()) return handleStaticFile(path.join(pathname, 'index.html'), res);
    sendFile(res, filePath);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      setCorsHeaders(req, res);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, url);
        if (!handled) sendJson(res, 404, { ok: false, message: 'API route not found' });
        return;
      }
      handleStaticFile(url.pathname, res);
    } catch (error) {
      console.error('Server error:', error);
      sendJson(res, 500, { ok: false, message: error.message || 'Internal server error' });
    }
  });
}

if (!AUTH_SECRET) console.warn('WARNING: AUTH_SECRET is not configured. Set it in .env.');

createServer().listen(port, '0.0.0.0', () => {
  console.log(`Static server running at http://localhost:${port}`);
  console.log(`Persistent state file: ${dataFile}`);
});
