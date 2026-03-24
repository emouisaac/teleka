const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config();

// Import JSON-based storage instead of SQLite
const { initStorage, runQuery, getQuery, allQuery, dataDir, storageMeta } = require('./storage');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DRIVER_TOKEN_TTL_DAYS = Math.max(1, parseInt(process.env.TELEKA_DRIVER_TOKEN_TTL_DAYS || '365', 10) || 365);
const SESSION_TTL_DAYS = Math.max(1, parseInt(process.env.TELEKA_SESSION_TTL_DAYS || '180', 10) || 180);
const MAX_DRIVER_DISTANCE_KM = Number(process.env.TELEKA_DRIVER_REQUEST_RADIUS_KM || 7);
const MAX_NEARBY_DRIVERS = Math.max(1, parseInt(process.env.TELEKA_REQUEST_DRIVER_LIMIT || '3', 10) || 3);
const LOCATION_FRESHNESS_MIN = Math.max(1, parseInt(process.env.TELEKA_DRIVER_LOCATION_FRESHNESS_MIN || '15', 10) || 15);

const sanitizeText = (value, max = 2000) => String(value || '').trim().slice(0, max);
const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const money = (value) => Number(Number(value || 0).toFixed(2));
const nowIso = () => new Date().toISOString();
const toRadians = (value) => (Number(value) * Math.PI) / 180;
const sessionStoreDir = path.join(storageMeta.dataRoot, 'sessions');
const sessionDbName = process.env.TELEKA_SESSIONS_DB || 'sessions.sqlite';
const sessionDbPath = path.join(sessionStoreDir, sessionDbName);

if (!fs.existsSync(sessionStoreDir)) {
  fs.mkdirSync(sessionStoreDir, { recursive: true });
}

function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(Number(value)))) return Number.POSITIVE_INFINITY;
  const earthRadiusKm = 6371;
  const dLat = toRadians(Number(lat2) - Number(lat1));
  const dLng = toRadians(Number(lng2) - Number(lng1));
  const startLat = toRadians(lat1);
  const endLat = toRadians(lat2);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sendError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function getDriverToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return req.body?.token || req.query?.token || req.headers['x-driver-token'];
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((item) => item.trim())
      : ['http://localhost:3000'];
    return callback(null, allowed.includes(origin));
  },
  credentials: true
}));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.AUTH_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: sessionDbName,
    dir: sessionStoreDir,
    createDirIfNotExists: true,
    concurrentDB: true
  }),
  cookie: { maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname)));

async function createNotification(targetRole, targetUserId, title, message, type = 'info') {
  await runQuery(
    `INSERT INTO notifications (target_role, target_user_id, title, message, type, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`,
    [targetRole, targetUserId ?? null, sanitizeText(title, 120), sanitizeText(message), sanitizeText(type, 40)]
  );
}

async function getNearbyEligibleDrivers(pickupLat, pickupLng, excludeDriverIds = []) {
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) return [];
  const drivers = await allQuery(
    `SELECT id, name, phone, current_lat, current_lng
     FROM drivers
     WHERE status = 'approved'
       AND is_online = 1
       AND current_ride_id IS NULL
       AND current_lat IS NOT NULL
       AND current_lng IS NOT NULL
       AND location_updated_at IS NOT NULL
       AND datetime(location_updated_at) >= datetime('now', '-${LOCATION_FRESHNESS_MIN} minute')`
  );
  const excluded = new Set(excludeDriverIds.map((value) => Number(value)).filter(Number.isFinite));
  return drivers
    .map((driver) => ({
      ...driver,
      distanceKm: haversineKm(pickupLat, pickupLng, driver.current_lat, driver.current_lng)
    }))
    .filter((driver) => Number.isFinite(driver.distanceKm) && driver.distanceKm <= MAX_DRIVER_DISTANCE_KM && !excluded.has(Number(driver.id)))
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, MAX_NEARBY_DRIVERS);
}

async function assignRideOffers(rideId, options = {}) {
  const excludeDriverIds = options.excludeDriverIds || [];
  const ride = await getQuery(
    `SELECT id, status, driver_id, pickup_location, dropoff_location, pickup_lat, pickup_lng
     FROM rides
     WHERE id = ?`,
    [rideId]
  );
  if (!ride || ride.status !== 'pending' || ride.driver_id) return [];

  const existingOffers = await allQuery(
    `SELECT driver_id, status
     FROM ride_driver_offers
     WHERE ride_id = ?`,
    [rideId]
  );
  const activeDriverIds = existingOffers
    .filter((offer) => ['offered', 'accepted'].includes(offer.status))
    .map((offer) => Number(offer.driver_id))
    .filter(Number.isFinite);
  const rejectedDriverIds = existingOffers
    .filter((offer) => offer.status === 'rejected')
    .map((offer) => Number(offer.driver_id))
    .filter(Number.isFinite);
  const remainingSlots = MAX_NEARBY_DRIVERS - activeDriverIds.length;
  if (remainingSlots <= 0) return [];

  const nearbyDrivers = await getNearbyEligibleDrivers(
    Number(ride.pickup_lat),
    Number(ride.pickup_lng),
    [...excludeDriverIds, ...activeDriverIds, ...rejectedDriverIds]
  );
  const selectedDrivers = nearbyDrivers.slice(0, remainingSlots);
  for (const driver of selectedDrivers) {
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `INSERT OR REPLACE INTO ride_driver_offers (ride_id, driver_id, status, distance_km, created_at, updated_at)
       VALUES (?, ?, 'offered', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [rideId, driver.id, money(driver.distanceKm)]
    );
    // eslint-disable-next-line no-await-in-loop
    await createNotification(
      'direct',
      driver.id,
      'New ride request',
      `${ride.pickup_location} to ${ride.dropoff_location} (${driver.distanceKm.toFixed(1)} km away)`,
      'ride_request'
    );
  }
  return selectedDrivers;
}

async function purgeExpiredOperationalData() {
  // Data retention is disabled - all data is kept indefinitely
  // Uncomment below if you want to implement retention in the future
}

function startRetentionCleanup() {
  // Data retention cleanup is disabled - all data is kept indefinitely
}

// ============ ADMIN USER MANAGEMENT ============

function generateSecurePassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function ensureAdminUser(email = null, password = null) {
  try {
    // Use provided credentials or generate secure ones
    const adminEmail = email || process.env.ADMIN_EMAIL || 'admin@telekataxi.com';
    const adminPassword = password || process.env.ADMIN_PASSWORD;

    // If no password provided and not in env, generate a secure one
    const finalPassword = adminPassword || generateSecurePassword();

    console.log(`\n=== ADMIN USER SETUP ===`);
    console.log(`Email: ${adminEmail}`);

    // Normalize to a single active admin for this email, with safe fallback
    let existingAdmin = await getQuery('SELECT id, password_hash FROM users WHERE email = ? AND role = ?', [adminEmail, 'admin']);
    const userMatches = await allQuery('SELECT id, role FROM users WHERE email = ?', [adminEmail]);
    const validAdmin = userMatches.find((row) => row.role === 'admin' && row.password_hash);
    if (validAdmin) existingAdmin = { id: validAdmin.id, password_hash: validAdmin.password_hash };

    // If any non-admin entry exists with the same email, convert it to admin role now
    if (!existingAdmin && userMatches.length > 0) {
      const candidate = userMatches[0];
      await runQuery('UPDATE users SET role = ?, name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['admin', 'Administrator', candidate.id]);
      existingAdmin = { id: candidate.id };
      console.log(`⚠️ Existing same-email user converted to admin: id=${candidate.id}`);
    }

    // If still no admin, create new admin row
    if (!existingAdmin) {
      const adminHash = await bcrypt.hash(finalPassword, 10);
      await runQuery(
        `INSERT INTO users (email, name, role, password_hash, created_at, updated_at)
         VALUES (?, 'Administrator', 'admin', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [adminEmail, adminHash]
      );
      console.log(`✅ Admin user created successfully`);
      console.log(`🔐 Password: ${finalPassword}`);
      console.log(`⚠️  IMPORTANT: Save this password securely! It will only be shown once.`);
    } else if (!existingAdmin.password_hash) {
      const adminHash = await bcrypt.hash(finalPassword, 10);
      await runQuery('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [adminHash, existingAdmin.id]);
      console.log(`✅ Admin user found and password updated`);
      console.log(`🔐 Password: ${finalPassword}`);
      console.log(`⚠️  IMPORTANT: Save this password securely! It will only be shown once.`);
    } else {
      console.log('Admin user found; keeping existing password');
    }

    const canonicalAdmin = await getQuery('SELECT id, password_hash FROM users WHERE email = ? AND role = ?', [adminEmail, 'admin']);
    for (const row of userMatches) {
      if (row.role === 'admin' && row.id !== canonicalAdmin?.id && !row.password_hash && canonicalAdmin?.password_hash) {
        await runQuery('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [canonicalAdmin.password_hash, row.id]);
      }
    }

    console.log(`========================\n`);
    return { email: adminEmail, password: finalPassword, created: !existingAdmin };
  } catch (error) {
    console.error('❌ Failed to setup admin user:', error);
    throw error;
  }
}

async function resetAdminPassword(email = null) {
  try {
    const adminEmail = email || process.env.ADMIN_EMAIL || 'admin@telekataxi.com';
    const newPassword = generateSecurePassword();

    const existingAdmin = await getQuery('SELECT id FROM users WHERE email = ? AND role = ?', [adminEmail, 'admin']);
    if (!existingAdmin) {
      throw new Error('Admin user not found');
    }

    const adminHash = await bcrypt.hash(newPassword, 10);
    await runQuery('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [adminHash, existingAdmin.id]);

    console.log(`\n=== ADMIN PASSWORD RESET ===`);
    console.log(`📧 Email: ${adminEmail}`);
    console.log(`🔐 New Password: ${newPassword}`);
    console.log(`⚠️  IMPORTANT: Save this password securely! It will only be shown once.`);
    console.log(`===========================\n`);

    return { email: adminEmail, password: newPassword };
  } catch (error) {
    console.error('❌ Failed to reset admin password:', error);
    throw error;
  }
}

// ============ DATABASE INITIALIZATION ============

async function initDatabase() {
  // Initialize storage from JSON files
  initStorage();

  // Ensure admin user exists with secure credentials
  await ensureAdminUser();
}

const googleCallbackLocal = process.env.GOOGLE_CALLBACK_URL_LOCAL || 'http://localhost:3000/auth/google/callback';
const googleCallbackProduction = process.env.GOOGLE_CALLBACK_URL_PRODUCTION || 'http://www.telekataxi.com/auth/google/callback';
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || `${process.env.APP_URL}/auth/google/callback`;

const googleVerify = async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName || 'Customer';
    if (!email) return done(new Error('Google profile missing email'));

    const user = await getQuery('SELECT id, email, name, phone FROM users WHERE email = ?', [email]);
    if (user) {
      await runQuery('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, user.id]);
      return done(null, { id: user.id, email: user.email, name, role: 'customer', phone: user.phone || '' });
    }

    const created = await runQuery(
      `INSERT INTO users (email, name, role, google_id, created_at, updated_at)
       VALUES (?, ?, 'customer', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [email, name, profile.id]
    );
    return done(null, { id: created.lastID, email, name, role: 'customer', phone: '' });
  } catch (error) {
    return done(error);
  }
};

passport.use('google-local', new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: googleCallbackLocal
}, googleVerify));

passport.use('google-production', new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: googleCallbackProduction
}, googleVerify));

passport.use('google-default', new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: googleCallbackUrl
}, googleVerify));

passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async (email, password, done) => {
  try {
    const user = await getQuery('SELECT * FROM users WHERE email = ? AND role = ?', [email, 'admin']);
    if (!user || !user.password_hash) return done(null, false, { message: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return done(null, false, { message: 'Invalid credentials' });
    return done(null, { id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (error) {
    return done(error);
  }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

function pickGoogleStrategy(host) {
  if (!host) return 'google-default';
  if (host.includes('telekataxi.com')) return 'google-production';
  return 'google-local';
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated() || req.user?.role !== 'admin') return sendError(res, 403, 'Unauthorized');
  return next();
}

function requireCustomer(req, res, next) {
  if (!req.isAuthenticated() || req.user?.role !== 'customer') {
    return sendError(res, 401, 'Customer authentication required');
  }
  return next();
}

async function requireDriver(req, res, next) {
  try {
    const token = getDriverToken(req);
    if (!token) return sendError(res, 401, 'Driver token required');
    const decoded = jwt.verify(token, process.env.AUTH_SECRET);
    if (decoded.role !== 'driver') return sendError(res, 401, 'Invalid token');

    const driver = await getQuery(
      `SELECT id, email, name, phone, vehicle_info, plate_number, license_number, national_id_number, insurance_number,
              status, is_online, rating, review_count, profile_photo_url, car_photo_url, docs_json
       FROM drivers WHERE id = ? AND status = 'approved'`,
      [decoded.id]
    );
    if (!driver) return sendError(res, 401, 'Driver not found or not approved');
    req.driver = driver;
    return next();
  } catch (error) {
    return sendError(res, 401, 'Invalid or expired driver token');
  }
}

const CAR_TYPE_MULTIPLIERS = Object.freeze({
  standard: 1,
  premium: 1.35,
  suv: 1.6
});

function normalizeCarType(value) {
  const type = sanitizeText(value || 'standard', 40).toLowerCase();
  return CAR_TYPE_MULTIPLIERS[type] ? type : 'standard';
}

function getCarTypeMultiplier(carType) {
  return parseNumber(CAR_TYPE_MULTIPLIERS[normalizeCarType(carType)], 1);
}

function calculateEstimatedFare(pricing, distanceKm, durationMin, scheduleIso, carType = 'standard') {
  const hour = new Date(scheduleIso).getHours();
  const useSurge = hour >= 22 || hour < 6;
  const surge = useSurge ? parseNumber(pricing.surge_multiplier, 1) : 1;
  const multiplier = getCarTypeMultiplier(carType);
  const total = parseNumber(pricing.base_fare, 0)
    + (distanceKm * parseNumber(pricing.per_km, 0))
    + (durationMin * parseNumber(pricing.per_min, 0));
  return money(total * surge * multiplier);
}

async function getAdminSnapshot() {
  const summary = await getQuery(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
      (SELECT COUNT(*) FROM drivers WHERE status = 'approved' AND is_online = 1) AS drivers_online,
      (SELECT COUNT(*) FROM rides WHERE status = 'pending') AS pending_rides,
      (SELECT COUNT(*) FROM rides WHERE status IN ('accepted','arrived','enroute')) AS active_rides,
      (SELECT COUNT(*) FROM rides WHERE status = 'completed') AS completed_rides,
      (SELECT COALESCE(SUM(final_fare), 0) FROM rides WHERE status = 'completed') AS revenue`
  );

  const latestRides = await allQuery(
    `SELECT rides.id, rides.status, rides.pickup_location, rides.dropoff_location, rides.scheduled_at, rides.scheduled_local,
            rides.estimated_fare, rides.final_fare, users.name AS customer_name, drivers.name AS driver_name
     FROM rides
     LEFT JOIN users ON users.id = rides.customer_id
     LEFT JOIN drivers ON drivers.id = rides.driver_id
     ORDER BY rides.created_at DESC
     LIMIT 12`
  );

  const users = await allQuery(
    `SELECT id, name, email, phone, created_at
     FROM users WHERE role = 'customer'
     ORDER BY created_at DESC
     LIMIT 150`
  );

  const pendingDrivers = await allQuery(
    `SELECT id, name, email, phone, vehicle_info, plate_number, status, created_at, docs_json
     FROM drivers WHERE status = 'pending'
     ORDER BY created_at DESC`
  );

  const approvedDrivers = await allQuery(
    `SELECT id, name, email, phone, vehicle_info, plate_number, status, is_online, rating, review_count, current_ride_id, created_at
     FROM drivers WHERE status = 'approved'
     ORDER BY updated_at DESC`
  );

  const rides = await allQuery(
    `SELECT rides.id, rides.status, rides.pickup_location, rides.dropoff_location, rides.distance_km, rides.duration_min,
            rides.scheduled_at, rides.scheduled_local, rides.estimated_fare, rides.final_fare, rides.updated_at,
            users.name AS customer_name, drivers.name AS driver_name
     FROM rides
     LEFT JOIN users ON users.id = rides.customer_id
     LEFT JOIN drivers ON drivers.id = rides.driver_id
     ORDER BY rides.created_at DESC
     LIMIT 250`
  );

  const earnings = await getQuery(
    `SELECT
      COALESCE(SUM(CASE WHEN status = 'completed' THEN final_fare ELSE 0 END),0) AS revenue,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),0) AS completed_trips,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END),0) AS cancelled_trips
     FROM rides`
  );

  const driverEarnings = await allQuery(
    `SELECT drivers.id, drivers.name,
            COALESCE(SUM(CASE WHEN rides.status='completed' THEN rides.final_fare * 0.8 ELSE 0 END),0) AS total_earnings,
            COALESCE(SUM(CASE WHEN rides.status='completed' AND date(rides.updated_at)=date('now','localtime') THEN rides.final_fare * 0.8 ELSE 0 END),0) AS today_earnings,
            COALESCE(SUM(CASE WHEN rides.status='completed' THEN 1 ELSE 0 END),0) AS trips
     FROM drivers
     LEFT JOIN rides ON rides.driver_id = drivers.id
     WHERE drivers.status = 'approved'
     GROUP BY drivers.id, drivers.name
     ORDER BY total_earnings DESC`
  );

  const notifications = await allQuery(
    `SELECT id, target_role, target_user_id, title, message, type, is_read, created_at
     FROM notifications
     ORDER BY created_at DESC
     LIMIT 100`
  );

  const pricing = await getQuery('SELECT * FROM pricing_settings WHERE id = 1');
  const resetRequests = await allQuery(
    `SELECT id, driver_id, driver_phone, whatsapp, status, created_at
     FROM driver_reset_requests
     ORDER BY created_at DESC
     LIMIT 50`
  );

  return {
    generatedAt: nowIso(),
    summary,
    latestRides,
    users,
    pendingDrivers,
    approvedDrivers,
    rides,
    earnings: { ...earnings, driverEarnings },
    notifications,
    pricing,
    resetRequests
  };
}

async function getDriverSnapshot(driverId) {
  const driver = await getQuery(
    `SELECT id, email, name, phone, vehicle_info, plate_number, license_number, national_id_number, insurance_number,
            status, is_online, rating, review_count, profile_photo_url, car_photo_url, docs_json
     FROM drivers WHERE id = ?`,
    [driverId]
  );

  const incomingRequest = driver?.is_online
    ? await getQuery(
      `SELECT rides.id, rides.pickup_location, rides.dropoff_location, rides.pickup_lat, rides.pickup_lng, rides.dropoff_lat, rides.dropoff_lng,
              rides.distance_km, rides.duration_min, offers.distance_km AS driver_distance_km,
              rides.estimated_fare, rides.scheduled_at, rides.scheduled_local,
              users.name AS customer_name, users.phone AS customer_phone
       FROM ride_driver_offers offers
       JOIN rides ON rides.id = offers.ride_id
       JOIN users ON users.id = rides.customer_id
       WHERE offers.driver_id = ?
         AND offers.status = 'offered'
         AND rides.status = 'pending'
       ORDER BY offers.created_at ASC, datetime(rides.scheduled_at) ASC, rides.created_at ASC
       LIMIT 1`
      ,
      [driverId]
    )
    : null;

  const activeRide = await getQuery(
    `SELECT rides.*, users.name AS customer_name, users.phone AS customer_phone
     FROM rides
     JOIN users ON users.id = rides.customer_id
     WHERE rides.driver_id = ? AND rides.status IN ('accepted','arrived','enroute')
     ORDER BY rides.updated_at DESC
     LIMIT 1`,
    [driverId]
  );

  const activeRideMessages = activeRide
    ? await allQuery(
      `SELECT id, sender_role, sender_id, message, created_at
       FROM ride_messages
       WHERE ride_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [activeRide.id]
    )
    : [];

  const history = await allQuery(
    `SELECT rides.id, rides.status, rides.pickup_location, rides.dropoff_location, rides.final_fare, rides.estimated_fare,
            rides.distance_km, rides.duration_min, rides.updated_at, users.name AS customer_name
     FROM rides
     JOIN users ON users.id = rides.customer_id
     WHERE rides.driver_id = ? AND rides.status IN ('completed','cancelled')
     ORDER BY rides.updated_at DESC
     LIMIT 50`,
    [driverId]
  );

  const notifications = await allQuery(
    `SELECT id, title, message, type, is_read, created_at
     FROM notifications
     WHERE target_role IN ('all','drivers') OR target_user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [driverId]
  );

  const reviews = await allQuery(
    `SELECT id, customer_rating, customer_review, updated_at
     FROM rides
     WHERE driver_id = ? AND status = 'completed' AND customer_rating IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 20`,
    [driverId]
  );

  const stats = await getQuery(
    `SELECT
      COALESCE(SUM(CASE WHEN status='completed' AND date(updated_at)=date('now','localtime') THEN final_fare * 0.8 ELSE 0 END),0) AS earnings_today,
      COALESCE(SUM(CASE WHEN status='completed' AND date(updated_at)>=date('now','-6 day','localtime') THEN final_fare * 0.8 ELSE 0 END),0) AS earnings_week,
      COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS trips_completed,
      COALESCE(SUM(CASE WHEN status IN ('accepted','arrived','enroute') THEN distance_km ELSE 0 END),0) AS active_distance
     FROM rides
     WHERE driver_id = ?`,
    [driverId]
  );

  return {
    generatedAt: nowIso(),
    driver,
    stats,
    incomingRequest,
    activeRide,
    activeRideMessages,
    history,
    notifications,
    unreadCount: notifications.filter((row) => !row.is_read).length,
    reviews
  };
}

async function getCustomerSnapshot(customerId) {
  const profile = await getQuery(
    'SELECT id, name, email, phone, created_at, updated_at FROM users WHERE id = ?',
    [customerId]
  );

  const rides = await allQuery(
    `SELECT rides.id, rides.status, rides.pickup_location, rides.dropoff_location, rides.scheduled_at, rides.scheduled_local,
            rides.requested_car_type, rides.payment_method, rides.distance_km, rides.duration_min, rides.estimated_fare, rides.final_fare,
            rides.created_at, rides.updated_at,
            drivers.name AS driver_name, drivers.phone AS driver_phone, drivers.vehicle_info AS driver_vehicle,
            drivers.profile_photo_url AS driver_photo, drivers.car_photo_url AS driver_car_photo
     FROM rides
     LEFT JOIN drivers ON drivers.id = rides.driver_id
     WHERE rides.customer_id = ?
     ORDER BY rides.created_at DESC
     LIMIT 120`,
    [customerId]
  );

  const activeRide = await getQuery(
    `SELECT rides.*, drivers.name AS driver_name, drivers.phone AS driver_phone, drivers.vehicle_info AS driver_vehicle,
            drivers.profile_photo_url AS driver_photo, drivers.car_photo_url AS driver_car_photo
     FROM rides
     LEFT JOIN drivers ON drivers.id = rides.driver_id
     WHERE rides.customer_id = ? AND rides.status IN ('pending','accepted','arrived','enroute')
     ORDER BY rides.updated_at DESC
     LIMIT 1`,
    [customerId]
  );

  const activeRideMessages = activeRide
    ? await allQuery(
      `SELECT id, sender_role, sender_id, message, created_at
       FROM ride_messages
       WHERE ride_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [activeRide.id]
    )
    : [];

  const stats = await getQuery(
    `SELECT
      COUNT(*) AS total_rides,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN final_fare ELSE 0 END),0) AS completed_spend
     FROM rides
     WHERE customer_id = ?`,
    [customerId]
  );

  const notifications = await allQuery(
    `SELECT id, title, message, type, created_at
     FROM notifications
     WHERE target_role IN ('all','customers') OR target_user_id = ?
     ORDER BY created_at DESC
     LIMIT 30`,
    [customerId]
  );

  return {
    generatedAt: nowIso(),
    profile,
    rides,
    activeRide,
    activeRideMessages,
    stats,
    notifications
  };
}

app.get('/auth/google', (req, res, next) => {
  const strategy = pickGoogleStrategy(req.headers.host);
  passport.authenticate(strategy, { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  const strategy = pickGoogleStrategy(req.headers.host);
  passport.authenticate(strategy, { failureRedirect: '/index.html' })(req, res, next);
}, (req, res) => {
  res.redirect('/index.html');
});

app.post('/auth/admin/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return sendError(res, 500, 'Server error');
    if (!user) return sendError(res, 401, info?.message || 'Invalid credentials');
    req.logIn(user, (loginErr) => {
      if (loginErr) return sendError(res, 500, 'Login failed');
      return res.json({ success: true, user });
    });
  })(req, res, next);
});

app.post('/auth/admin/logout', (req, res) => {
  req.logout((err) => {
    if (err) return sendError(res, 500, 'Logout failed');
    return res.json({ success: true });
  });
});

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) return sendError(res, 500, 'Logout failed');
    return res.json({ success: true });
  });
});

app.post('/auth/driver/register', async (req, res) => {
  try {
    const name = sanitizeText(req.body.name, 120);
    const email = sanitizeText(req.body.email, 160).toLowerCase();
    const phone = sanitizeText(req.body.phone, 50);
    const vehicleInfo = sanitizeText(req.body.vehicleInfo, 120);
    const plate = sanitizeText(req.body.plate, 40);
    const licenseNumber = sanitizeText(req.body.licenseNumber, 60);
    const nationalIdNumber = sanitizeText(req.body.nationalIdNumber, 60);
    const insuranceNumber = sanitizeText(req.body.insuranceNumber, 60);
    const password = String(req.body.password || '');
    const docsJson = JSON.stringify(req.body.docs || []);

    if (!name || !email || !phone || !vehicleInfo || !licenseNumber || !password) {
      return sendError(res, 400, 'Missing required registration fields');
    }
    if (password.length < 6) return sendError(res, 400, 'Password must be at least 6 characters');

    // Check for duplicate email
    const existingEmail = await getQuery('SELECT id FROM drivers WHERE email = ?', [email]);
    if (existingEmail) return sendError(res, 400, 'Email already registered');

    // Check for duplicate phone
    const existingPhone = await getQuery('SELECT id FROM drivers WHERE phone = ?', [phone]);
    if (existingPhone) return sendError(res, 400, 'Phone number already registered');

    // Check for duplicate license number
    const existingLicense = await getQuery('SELECT id FROM drivers WHERE license_number = ?', [licenseNumber]);
    if (existingLicense) return sendError(res, 400, 'License number already registered');

    // Check for duplicate plate number
    const existingPlate = await getQuery('SELECT id FROM drivers WHERE plate_number = ?', [plate]);
    if (existingPlate) return sendError(res, 400, 'Vehicle plate number already registered');

    // Check for duplicate national ID number
    const existingNationalId = await getQuery('SELECT id FROM drivers WHERE national_id_number = ?', [nationalIdNumber]);
    if (existingNationalId) return sendError(res, 400, 'National ID number already registered');

    // Check for duplicate insurance number
    const existingInsurance = await getQuery('SELECT id FROM drivers WHERE insurance_number = ?', [insuranceNumber]);
    if (existingInsurance) return sendError(res, 400, 'Insurance number already registered');

    const hash = await bcrypt.hash(password, 10);
    await runQuery(
      `INSERT INTO drivers (
        email, name, phone, license_number, vehicle_info, plate_number, national_id_number, insurance_number,
        status, password_hash, docs_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [email, name, phone, licenseNumber, vehicleInfo, plate, nationalIdNumber, insuranceNumber, hash, docsJson]
    );

    await createNotification('admin', null, 'Driver registration', `${name} submitted a driver application.`);
    return res.json({ success: true, message: 'Registration submitted for admin approval' });
  } catch (error) {
    return sendError(res, 500, 'Registration failed');
  }
});

app.post('/auth/driver/login', async (req, res) => {
  try {
    const email = sanitizeText(req.body.email, 160).toLowerCase();
    const password = String(req.body.password || '');
    const driver = await getQuery('SELECT * FROM drivers WHERE email = ? AND status = ?', [email, 'approved']);
    if (!driver) return sendError(res, 401, 'Invalid credentials or account not approved');

    const isMatch = await bcrypt.compare(password, driver.password_hash || '');
    if (!isMatch) return sendError(res, 401, 'Invalid credentials');

    const token = jwt.sign(
      { id: driver.id, email: driver.email, role: 'driver' },
      process.env.AUTH_SECRET,
      { expiresIn: `${DRIVER_TOKEN_TTL_DAYS}d` }
    );
    return res.json({
      success: true,
      token,
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
        phone: driver.phone,
        vehicleInfo: driver.vehicle_info,
        isOnline: Boolean(driver.is_online)
      }
    });
  } catch (error) {
    return sendError(res, 500, 'Server error');
  }
});

app.post('/auth/driver/verify', async (req, res) => {
  try {
    const token = getDriverToken(req);
    if (!token) return res.status(401).json({ valid: false });
    const decoded = jwt.verify(token, process.env.AUTH_SECRET);
    if (decoded.role !== 'driver') return res.status(401).json({ valid: false });

    const driver = await getQuery(
      'SELECT id, name, email, phone, vehicle_info, plate_number, is_online FROM drivers WHERE id = ? AND status = ?',
      [decoded.id, 'approved']
    );
    if (!driver) return res.status(401).json({ valid: false });
    return res.json({ valid: true, driver });
  } catch (error) {
    return res.status(401).json({ valid: false });
  }
});

app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) return res.json({ authenticated: true, user: req.user });
  return res.json({ authenticated: false });
});

app.get('/api/public/config', async (req, res) => {
  const pricing = await getQuery('SELECT base_fare, per_km, per_min, surge_multiplier, cancellation_fee FROM pricing_settings WHERE id = 1');
  return res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    pricing: {
      ...(pricing || {}),
      car_type_multipliers: CAR_TYPE_MULTIPLIERS
    }
  });
});

app.get('/api/customer/snapshot', requireCustomer, async (req, res) => {
  const snapshot = await getCustomerSnapshot(req.user.id);
  return res.json({ success: true, ...snapshot });
});

app.put('/api/customer/profile', requireCustomer, async (req, res) => {
  const name = sanitizeText(req.body.name, 120);
  const phone = sanitizeText(req.body.phone, 50);
  if (!name) return sendError(res, 400, 'Name is required');

  // Check for duplicate phone number across all users
  if (phone) {
    const existingPhone = await getQuery('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, req.user.id]);
    if (existingPhone) return sendError(res, 400, 'Phone number already in use');

    const existingDriverPhone = await getQuery('SELECT id FROM drivers WHERE phone = ?', [phone]);
    if (existingDriverPhone) return sendError(res, 400, 'Phone number already in use');
  }

  await runQuery(
    'UPDATE users SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [name, phone, req.user.id]
  );
  req.user.name = name;
  return res.json({ success: true });
});

app.post('/api/rides/request', requireCustomer, async (req, res) => {
  try {
    const pickupLocation = sanitizeText(req.body.pickupLocation, 255);
    const dropoffLocation = sanitizeText(req.body.dropoffLocation, 255);
    const scheduledLocal = sanitizeText(req.body.scheduledAt, 64);
    const requestedCarType = normalizeCarType(req.body.carType);
    const paymentMethod = sanitizeText(req.body.paymentMethod || 'cash', 40);
    const distanceKm = parseNumber(req.body.distanceKm, 0);
    const durationMin = parseNumber(req.body.durationMin, 0);
    const clientFare = parseNumber(req.body.estimatedFare, 0);
    const pickupLat = parseNumber(req.body.pickupLat, null);
    const pickupLng = parseNumber(req.body.pickupLng, null);
    const dropoffLat = parseNumber(req.body.dropoffLat, null);
    const dropoffLng = parseNumber(req.body.dropoffLng, null);

    if (!pickupLocation || !dropoffLocation || !scheduledLocal) {
      return sendError(res, 400, 'Pickup, destination, and ride date are required');
    }

    const scheduleDate = new Date(scheduledLocal);
    if (Number.isNaN(scheduleDate.getTime())) return sendError(res, 400, 'Invalid scheduled date');

    const pricing = await getQuery('SELECT * FROM pricing_settings WHERE id = 1');
    const estimatedFare = distanceKm > 0 || durationMin > 0
      ? calculateEstimatedFare(pricing || {}, distanceKm, durationMin, scheduleDate.toISOString(), requestedCarType)
      : money(clientFare > 0 ? clientFare : calculateEstimatedFare(pricing || {}, distanceKm, durationMin, scheduleDate.toISOString(), requestedCarType));

    const created = await runQuery(
      `INSERT INTO rides (
        customer_id, pickup_location, dropoff_location, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
        scheduled_at, scheduled_local, requested_car_type, payment_method, distance_km, duration_min, estimated_fare,
        status, timeline_stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'requested', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        req.user.id,
        pickupLocation,
        dropoffLocation,
        Number.isFinite(pickupLat) ? pickupLat : null,
        Number.isFinite(pickupLng) ? pickupLng : null,
        Number.isFinite(dropoffLat) ? dropoffLat : null,
        Number.isFinite(dropoffLng) ? dropoffLng : null,
        scheduleDate.toISOString(),
        scheduledLocal,
        requestedCarType,
        paymentMethod,
        distanceKm,
        durationMin,
        estimatedFare
      ]
    );

    const nearbyDrivers = await assignRideOffers(created.lastID);
    await createNotification('admin', null, 'New ride created', `Customer ${req.user.name || req.user.email} requested a ride.`);

    return res.json({
      success: true,
      rideId: created.lastID,
      estimatedFare,
      nearbyDriversReached: nearbyDrivers.length
    });
  } catch (error) {
    return sendError(res, 500, 'Failed to create ride');
  }
});

app.get('/api/customer/rides/:rideId/messages', requireCustomer, async (req, res) => {
  const rideId = Number(req.params.rideId);
  const ride = await getQuery('SELECT id FROM rides WHERE id = ? AND customer_id = ?', [rideId, req.user.id]);
  if (!ride) return sendError(res, 404, 'Ride not found');

  const messages = await allQuery(
    `SELECT id, sender_role, sender_id, message, created_at
     FROM ride_messages
     WHERE ride_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [rideId]
  );
  return res.json({ success: true, messages });
});

app.post('/api/customer/rides/:rideId/messages', requireCustomer, async (req, res) => {
  const rideId = Number(req.params.rideId);
  const message = sanitizeText(req.body.message, 2000);
  if (!message) return sendError(res, 400, 'Message is required');

  const ride = await getQuery('SELECT id, driver_id FROM rides WHERE id = ? AND customer_id = ?', [rideId, req.user.id]);
  if (!ride) return sendError(res, 404, 'Ride not found');

  await runQuery(
    'INSERT INTO ride_messages (ride_id, sender_role, sender_id, message, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
    [rideId, 'customer', req.user.id, message]
  );

  if (ride.driver_id) await createNotification('drivers', ride.driver_id, 'Passenger message', message.slice(0, 140));
  return res.json({ success: true });
});

app.get('/api/driver/snapshot', requireDriver, async (req, res) => {
  const snapshot = await getDriverSnapshot(req.driver.id);
  return res.json({ success: true, ...snapshot });
});

app.put('/api/driver/status', requireDriver, async (req, res) => {
  const isOnline = req.body.isOnline ? 1 : 0;
  const lat = parseNumber(req.body.lat, null);
  const lng = parseNumber(req.body.lng, null);
  await runQuery(
    `UPDATE drivers
     SET is_online = ?,
         current_lat = CASE WHEN ? IS NULL THEN current_lat ELSE ? END,
         current_lng = CASE WHEN ? IS NULL THEN current_lng ELSE ? END,
         location_updated_at = CASE WHEN ? IS NULL OR ? IS NULL THEN location_updated_at ELSE CURRENT_TIMESTAMP END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      isOnline,
      Number.isFinite(lat) ? lat : null,
      Number.isFinite(lat) ? lat : null,
      Number.isFinite(lng) ? lng : null,
      Number.isFinite(lng) ? lng : null,
      Number.isFinite(lat) ? lat : null,
      Number.isFinite(lng) ? lng : null,
      req.driver.id
    ]
  );
  return res.json({ success: true, isOnline: Boolean(isOnline) });
});

app.put('/api/driver/location', requireDriver, async (req, res) => {
  const lat = parseNumber(req.body.lat, null);
  const lng = parseNumber(req.body.lng, null);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return sendError(res, 400, 'Valid driver coordinates are required');
  }
  await runQuery(
    `UPDATE drivers
     SET current_lat = ?, current_lng = ?, location_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [lat, lng, req.driver.id]
  );
  return res.json({ success: true, lat, lng });
});

app.put('/api/driver/profile', requireDriver, async (req, res) => {
  const name = sanitizeText(req.body.name, 120);
  const phone = sanitizeText(req.body.phone, 50);
  const vehicleInfo = sanitizeText(req.body.vehicleInfo, 120);
  const plate = sanitizeText(req.body.plate, 40);
  const licenseNumber = sanitizeText(req.body.licenseNumber, 60);
  const nationalIdNumber = sanitizeText(req.body.nationalIdNumber, 60);
  const insuranceNumber = sanitizeText(req.body.insuranceNumber, 60);
  const docsJson = JSON.stringify(req.body.docs || []);

  await runQuery(
    `UPDATE drivers
     SET name = COALESCE(NULLIF(?, ''), name),
         phone = COALESCE(NULLIF(?, ''), phone),
         vehicle_info = COALESCE(NULLIF(?, ''), vehicle_info),
         plate_number = COALESCE(NULLIF(?, ''), plate_number),
         license_number = COALESCE(NULLIF(?, ''), license_number),
         national_id_number = COALESCE(NULLIF(?, ''), national_id_number),
         insurance_number = COALESCE(NULLIF(?, ''), insurance_number),
         docs_json = CASE WHEN ? = '[]' THEN docs_json ELSE ? END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name, phone, vehicleInfo, plate, licenseNumber, nationalIdNumber, insuranceNumber, docsJson, docsJson, req.driver.id]
  );
  return res.json({ success: true });
});

app.post('/api/driver/rides/:rideId/accept', requireDriver, async (req, res) => {
  const rideId = Number(req.params.rideId);
  const offer = await getQuery(
    `SELECT id
     FROM ride_driver_offers
     WHERE ride_id = ? AND driver_id = ? AND status = 'offered'`,
    [rideId, req.driver.id]
  );
  if (!offer) return sendError(res, 409, 'Ride is no longer assigned to you');

  const update = await runQuery(
    `UPDATE rides
     SET driver_id = ?, status = 'accepted', timeline_stage = 'accepted', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`,
    [req.driver.id, rideId]
  );
  if (!update.changes) return sendError(res, 409, 'Ride is no longer available');

  await runQuery('UPDATE drivers SET current_ride_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [rideId, req.driver.id]);
  await runQuery(
    `UPDATE ride_driver_offers
     SET status = CASE WHEN driver_id = ? THEN 'accepted' ELSE 'expired' END,
         updated_at = CURRENT_TIMESTAMP
     WHERE ride_id = ? AND status = 'offered'`,
    [req.driver.id, rideId]
  );
  const ride = await getQuery('SELECT customer_id FROM rides WHERE id = ?', [rideId]);
  await createNotification('customers', ride.customer_id, 'Driver assigned', `${req.driver.name} accepted your ride.`);
  await createNotification('admin', null, 'Ride accepted', `${req.driver.name} accepted ride #${rideId}.`, 'ride_accept');
  return res.json({ success: true });
});

app.post('/api/driver/rides/:rideId/reject', requireDriver, async (req, res) => {
  const rideId = Number(req.params.rideId);
  const ride = await getQuery('SELECT id, status, customer_id, driver_id FROM rides WHERE id = ?', [rideId]);
  if (!ride) return sendError(res, 404, 'Ride not found');

  if (ride.status === 'pending') {
    await runQuery(
      `UPDATE ride_driver_offers
       SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
       WHERE ride_id = ? AND driver_id = ? AND status = 'offered'`,
      [rideId, req.driver.id]
    );
    await assignRideOffers(rideId, { excludeDriverIds: [req.driver.id] });
    return res.json({ success: true });
  }

  if (ride.status === 'accepted' && ride.driver_id === req.driver.id) {
    await runQuery(
      `UPDATE rides
       SET status = 'pending', driver_id = NULL, timeline_stage = 'requested', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [rideId]
    );
    await runQuery('UPDATE drivers SET current_ride_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.driver.id]);
    await runQuery(
      `UPDATE ride_driver_offers
       SET status = CASE WHEN driver_id = ? THEN 'rejected' ELSE 'expired' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE ride_id = ?`,
      [req.driver.id, rideId]
    );
    await assignRideOffers(rideId, { excludeDriverIds: [req.driver.id] });
    await createNotification('customers', ride.customer_id, 'Ride reassigned', 'Your driver could not continue, searching for another driver.');
  }

  return res.json({ success: true });
});

app.post('/api/driver/rides/:rideId/status', requireDriver, async (req, res) => {
  const rideId = Number(req.params.rideId);
  const action = sanitizeText(req.body.action, 40).toLowerCase();
  const ride = await getQuery('SELECT * FROM rides WHERE id = ? AND driver_id = ?', [rideId, req.driver.id]);
  if (!ride) return sendError(res, 404, 'Ride not found');

  const map = {
    arrived: { status: 'arrived', stage: 'arrived' },
    start: { status: 'enroute', stage: 'enroute' },
    enroute: { status: 'enroute', stage: 'enroute' },
    complete: { status: 'completed', stage: 'completed' },
    cancel: { status: 'cancelled', stage: 'cancelled' },
    cancelled: { status: 'cancelled', stage: 'cancelled' }
  };
  const next = map[action];
  if (!next) return sendError(res, 400, 'Unsupported status transition');

  const finalFare = next.status === 'completed'
    ? money(parseNumber(req.body.finalFare, ride.final_fare || ride.estimated_fare || 0))
    : ride.final_fare;

  await runQuery(
    'UPDATE rides SET status = ?, timeline_stage = ?, final_fare = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND driver_id = ?',
    [next.status, next.stage, finalFare, rideId, req.driver.id]
  );
  if (['completed', 'cancelled'].includes(next.status)) {
    await runQuery(
      `UPDATE ride_driver_offers
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE ride_id = ?`,
      [next.status, rideId]
    );
  }

  if (next.status === 'completed' || next.status === 'cancelled') {
    await runQuery('UPDATE drivers SET current_ride_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.driver.id]);
  }

  const title = next.status === 'completed' ? 'Trip completed' : `Ride ${next.status}`;
  await createNotification('customers', ride.customer_id, title, `Driver updated your ride to "${next.status}".`);
  return res.json({ success: true, status: next.status, finalFare });
});

app.post('/api/driver/rides/:rideId/messages', requireDriver, async (req, res) => {
  const rideId = Number(req.params.rideId);
  const message = sanitizeText(req.body.message, 2000);
  if (!message) return sendError(res, 400, 'Message is required');

  const ride = await getQuery('SELECT customer_id FROM rides WHERE id = ? AND driver_id = ?', [rideId, req.driver.id]);
  if (!ride) return sendError(res, 404, 'Ride not found');

  await runQuery(
    'INSERT INTO ride_messages (ride_id, sender_role, sender_id, message, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
    [rideId, 'driver', req.driver.id, message]
  );
  await createNotification('customers', ride.customer_id, 'Driver message', message.slice(0, 140));
  return res.json({ success: true });
});

app.get('/api/admin/snapshot', requireAdmin, async (req, res) => {
  const snapshot = await getAdminSnapshot();
  return res.json({ success: true, ...snapshot });
});

app.put('/api/admin/pricing', requireAdmin, async (req, res) => {
  const baseFare = parseNumber(req.body.baseFare, 3500);
  const perKm = parseNumber(req.body.perKm, 1200);
  const perMin = parseNumber(req.body.perMin, 180);
  const surgeMultiplier = parseNumber(req.body.surgeMultiplier, 1.15);
  const cancellationFee = parseNumber(req.body.cancellationFee, 2500);

  await runQuery(
    `UPDATE pricing_settings
     SET base_fare = ?, per_km = ?, per_min = ?, surge_multiplier = ?, cancellation_fee = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [baseFare, perKm, perMin, surgeMultiplier, cancellationFee]
  );
  await createNotification('all', null, 'Pricing updated', 'Fare settings were updated by admin.');
  return res.json({ success: true });
});

app.post('/api/admin/notifications', requireAdmin, async (req, res) => {
  const target = sanitizeText(req.body.target || 'all', 20).toLowerCase();
  const message = sanitizeText(req.body.message, 2000);
  const title = sanitizeText(req.body.title || 'Platform update', 120);
  if (!message) return sendError(res, 400, 'Notification message is required');
  if (!['all', 'drivers', 'customers'].includes(target)) return sendError(res, 400, 'Invalid target');

  await createNotification(target, null, title, message, 'broadcast');
  return res.json({ success: true });
});

app.post('/api/admin/rides/:rideId/status', requireAdmin, async (req, res) => {
  const rideId = Number(req.params.rideId);
  const status = sanitizeText(req.body.status, 30).toLowerCase();
  if (!['pending', 'accepted', 'arrived', 'enroute', 'completed', 'cancelled'].includes(status)) {
    return sendError(res, 400, 'Invalid status');
  }

  const ride = await getQuery('SELECT customer_id, driver_id, estimated_fare, final_fare FROM rides WHERE id = ?', [rideId]);
  if (!ride) return sendError(res, 404, 'Ride not found');

  const finalFare = status === 'completed'
    ? money(parseNumber(req.body.finalFare, ride.final_fare || ride.estimated_fare || 0))
    : ride.final_fare;

  await runQuery(
    'UPDATE rides SET status = ?, final_fare = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, finalFare, rideId]
  );
  if (['completed', 'cancelled'].includes(status)) {
    await runQuery(
      `UPDATE ride_driver_offers
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE ride_id = ?`,
      [status, rideId]
    );
  }
  if (['completed', 'cancelled'].includes(status) && ride.driver_id) {
    await runQuery('UPDATE drivers SET current_ride_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [ride.driver_id]);
  }
  await createNotification('customers', ride.customer_id, 'Ride update', `Admin updated ride to "${status}".`);
  if (ride.driver_id) await createNotification('drivers', ride.driver_id, 'Ride update', `Ride #${rideId} is now "${status}".`);
  return res.json({ success: true });
});

app.get('/api/admin/export', requireAdmin, async (req, res) => {
  const tables = ['users', 'drivers', 'rides', 'ride_messages', 'notifications', 'pricing_settings', 'driver_reset_requests', 'ride_driver_offers'];
  const backup = { exportedAt: nowIso(), version: 1, data: {} };
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    backup.data[table] = await allQuery(`SELECT * FROM ${table}`);
  }
  const stamp = nowIso().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="teleka-backup-${stamp}.json"`);
  return res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
  try {
    const result = await resetAdminPassword();
    return res.json({
      success: true,
      message: 'Admin password reset successfully',
      email: result.email,
      password: result.password
    });
  } catch (error) {
    return sendError(res, 500, 'Failed to reset admin password');
  }
});

app.get('/api/drivers/pending', requireAdmin, async (req, res) => {
  const drivers = await allQuery(
    `SELECT id, email, name, phone, license_number, vehicle_info, plate_number, status, docs_json, created_at
     FROM drivers
     WHERE status = 'pending'
     ORDER BY created_at DESC`
  );
  return res.json(drivers);
});

app.post('/api/drivers/approve/:id', requireAdmin, async (req, res) => {
  const driverId = Number(req.params.id);
  const update = await runQuery(
    `UPDATE drivers
     SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [req.user.id, driverId]
  );
  if (!update.changes) return sendError(res, 404, 'Driver not found');
  await createNotification('drivers', driverId, 'Application approved', 'Your account is approved. You can log in now.');
  return res.json({ success: true });
});

app.post('/api/drivers/reject/:id', requireAdmin, async (req, res) => {
  const driverId = Number(req.params.id);
  const update = await runQuery(
    `UPDATE drivers
     SET status = 'rejected', is_online = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [driverId]
  );
  if (!update.changes) return sendError(res, 404, 'Driver not found');
  await createNotification('drivers', driverId, 'Application update', 'Your application was rejected. Contact support for details.');
  return res.json({ success: true });
});

app.get('/api/health', (req, res) => res.json({
  success: true,
  time: nowIso(),
  dataDir: dataDir,
  dataRoot: storageMeta.dataRoot,
  sessionDbPath: sessionDbPath,
  storage: 'json-files',
  driverTokenTtlDays: DRIVER_TOKEN_TTL_DAYS,
  sessionTtlDays: SESSION_TTL_DAYS,
  dataRetention: 'indefinite',
  persistenceWarnings: storageMeta.persistenceWarnings,
  migratedDataFiles: storageMeta.migratedDataFiles
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'driver.html')));

initDatabase()
  .then(() => {
    startRetentionCleanup();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Data directory (JSON files): ${dataDir}`);
      console.log(`Session database path: ${sessionDbPath}`);
      console.log(`Storage: JSON-based (no database)`);
      console.log(`Data retention: Indefinite (all data kept)`);
      console.log(`Session TTL (days): ${SESSION_TTL_DAYS}`);
      console.log(`Driver token TTL (days): ${DRIVER_TOKEN_TTL_DAYS}`);
      storageMeta.persistenceWarnings.forEach((warning) => console.warn(`Persistence warning: ${warning}`));
      storageMeta.migratedDataFiles.forEach((fileName) => console.log(`Seeded JSON storage from legacy file: ${fileName}`));
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
