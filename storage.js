const fs = require('fs');
const path = require('path');
const os = require('os');

// ============ CONFIGURATION ============
const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dataDir = path.join(appDataRoot, 'Teleka', 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ============ IN-MEMORY STATE ============
const store = {
  users: new Map(),
  drivers: new Map(),
  rides: new Map(),
  rideMessages: new Map(),
  notifications: new Map(),
  rideDriverOffers: new Map(),
  driverResetRequests: new Map(),
  pricing: {},
  nextIds: {
    users: 1,
    drivers: 1,
    rides: 1,
    rideMessages: 1,
    notifications: 1,
    rideDriverOffers: 1,
    driverResetRequests: 1
  }
};

// ============ FILE PATHS ============
const filePaths = {
  users: path.join(dataDir, 'users.json'),
  drivers: path.join(dataDir, 'drivers.json'),
  rides: path.join(dataDir, 'rides.json'),
  rideMessages: path.join(dataDir, 'ride-messages.ndjson'),
  notifications: path.join(dataDir, 'notifications.ndjson'),
  rideDriverOffers: path.join(dataDir, 'ride-driver-offers.json'),
  driverResetRequests: path.join(dataDir, 'driver-reset-requests.json'),
  pricing: path.join(dataDir, 'pricing.json'),
  nextIds: path.join(dataDir, 'next-ids.json')
};

// ============ PERSISTENCE ============
function saveCollection(collectionName, data) {
  const filePath = filePaths[collectionName];
  try {
    const obj = {};
    data.forEach((value, key) => {
      obj[key] = value;
    });
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  } catch (error) {
    console.error(`Failed to save ${collectionName}:`, error);
  }
}

function loadCollection(collectionName) {
  const filePath = filePaths[collectionName];
  const map = new Map();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const obj = JSON.parse(content);
      Object.entries(obj).forEach(([key, value]) => {
        map.set(Number(key) || key, value);
      });
    }
  } catch (error) {
    console.warn(`Failed to load ${collectionName}:`, error.message);
  }
  return map;
}

function appendLine(filePath, line) {
  try {
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch (error) {
    console.error(`Failed to append to ${filePath}:`, error);
  }
}

function readLines(filePath) {
  const lines = [];
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return content.split('\n').filter((line) => line.trim());
    }
  } catch (error) {
    console.warn(`Failed to read ${filePath}:`, error.message);
  }
  return lines;
}

// ============ INITIALIZATION ============
function initStorage() {
  // Load all collections
  store.users = loadCollection('users');
  store.drivers = loadCollection('drivers');
  store.rides = loadCollection('rides');
  store.rideDriverOffers = loadCollection('rideDriverOffers');
  store.driverResetRequests = loadCollection('driverResetRequests');

  // Load append-only data
  const msgLines = readLines(filePaths.rideMessages);
  const notifLines = readLines(filePaths.notifications);

  msgLines.forEach((line) => {
    try {
      const msg = JSON.parse(line);
      store.rideMessages.set(msg.id, msg);
    } catch (e) {
      // Skip malformed lines
    }
  });

  notifLines.forEach((line) => {
    try {
      const notif = JSON.parse(line);
      store.notifications.set(notif.id, notif);
    } catch (e) {
      // Skip malformed lines
    }
  });

  // Load IDs
  try {
    if (fs.existsSync(filePaths.nextIds)) {
      const ids = JSON.parse(fs.readFileSync(filePaths.nextIds, 'utf8'));
      store.nextIds = ids;
    }
  } catch (error) {
    console.warn('Failed to load next IDs:', error.message);
  }

  // Load pricing
  try {
    if (fs.existsSync(filePaths.pricing)) {
      store.pricing = JSON.parse(fs.readFileSync(filePaths.pricing, 'utf8'));
    } else {
      // Default pricing
      store.pricing = {
        id: 1,
        base_fare: 3500,
        per_km: 1200,
        per_min: 180,
        surge_multiplier: 1.15,
        cancellation_fee: 2500,
        updated_at: new Date().toISOString()
      };
      saveNextIds();
      savePricing();
    }
  } catch (error) {
    console.warn('Failed to load pricing:', error.message);
  }

  // Update next IDs based on existing records
  store.nextIds.users = Math.max(store.nextIds.users, ...Array.from(store.users.keys()).filter(Number.isInteger), 0) + 1;
  store.nextIds.drivers = Math.max(store.nextIds.drivers, ...Array.from(store.drivers.keys()).filter(Number.isInteger), 0) + 1;
  store.nextIds.rides = Math.max(store.nextIds.rides, ...Array.from(store.rides.keys()).filter(Number.isInteger), 0) + 1;
  store.nextIds.rideMessages = Math.max(store.nextIds.rideMessages, ...Array.from(store.rideMessages.keys()).filter(Number.isInteger), 0) + 1;
  store.nextIds.notifications = Math.max(store.nextIds.notifications, ...Array.from(store.notifications.keys()).filter(Number.isInteger), 0) + 1;
  store.nextIds.rideDriverOffers = Math.max(store.nextIds.rideDriverOffers, ...Array.from(store.rideDriverOffers.keys()).filter(Number.isInteger), 0) + 1;
  store.nextIds.driverResetRequests = Math.max(store.nextIds.driverResetRequests, ...Array.from(store.driverResetRequests.keys()).filter(Number.isInteger), 0) + 1;

  saveNextIds();
}

function saveNextIds() {
  try {
    fs.writeFileSync(filePaths.nextIds, JSON.stringify(store.nextIds, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save next IDs:', error);
  }
}

function savePricing() {
  try {
    fs.writeFileSync(filePaths.pricing, JSON.stringify(store.pricing, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save pricing:', error);
  }
}

// ============ QUERY INTERFACE ============
function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cloneRecord(record) {
  return record ? JSON.parse(JSON.stringify(record)) : record;
}

function toTime(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortByDateDesc(rows, field = 'created_at') {
  return [...rows].sort((left, right) => toTime(right[field]) - toTime(left[field]));
}

function isSameLocalDay(value, base = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === base.getFullYear()
    && date.getMonth() === base.getMonth()
    && date.getDate() === base.getDate();
}

function isWithinLastDays(value, days, base = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date(base);
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function getAllUsers() {
  return Array.from(store.users.values());
}

function getAllDrivers() {
  return Array.from(store.drivers.values());
}

function getAllRides() {
  return Array.from(store.rides.values());
}

function getAllRideMessages() {
  return Array.from(store.rideMessages.values());
}

function getAllNotifications() {
  return Array.from(store.notifications.values());
}

function getAllRideOffers() {
  return Array.from(store.rideDriverOffers.values());
}

function getAllResetRequests() {
  return Array.from(store.driverResetRequests.values());
}

function enrichRide(ride) {
  if (!ride) return null;
  const customer = store.users.get(Number(ride.customer_id)) || null;
  const driver = store.drivers.get(Number(ride.driver_id)) || null;
  return {
    ...cloneRecord(ride),
    customer_name: customer?.name || null,
    customer_phone: customer?.phone || null,
    driver_name: driver?.name || null,
    driver_phone: driver?.phone || null,
    driver_vehicle: driver?.vehicle_info || null,
    driver_photo: driver?.profile_photo_url || null,
    driver_car_photo: driver?.car_photo_url || null
  };
}

function matchesNotificationAudience(notification, targetUserId, audience) {
  return audience.includes(notification.target_role) || Number(notification.target_user_id) === Number(targetUserId);
}

function parseMinuteWindow(sqlLower) {
  const match = sqlLower.match(/-\s*(\d+)\s*minute/);
  return match ? Number(match[1]) : null;
}

// Run a write operation (INSERT/UPDATE)
async function runQuery(sql, params = []) {
  try {
    const sqlLower = normalizeSql(sql);

    if (sqlLower.includes('insert into users')) {
      let email = params[0] || null;
      let name = params[1] || 'Customer';
      let role = params[2] || 'customer';
      let googleId = params[3] || null;
      let passwordHash = params[4] || null;
      let phone = params[5] || null;

      if (sqlLower.includes("values (?, 'administrator', 'admin', ?")) {
        name = 'Administrator';
        role = 'admin';
        googleId = null;
        passwordHash = params[1] || null;
        phone = null;
      } else if (sqlLower.includes("values (?, ?, 'customer', ?")) {
        name = params[1] || 'Customer';
        role = 'customer';
        googleId = params[2] || null;
        passwordHash = null;
        phone = null;
      }

      const user = {
        id: store.nextIds.users++,
        email,
        name,
        role,
        google_id: googleId,
        password_hash: passwordHash,
        phone,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      store.users.set(user.id, user);
      saveCollection('users', store.users);
      saveNextIds();
      return { lastID: user.id, changes: 1 };
    }

    if (sqlLower.includes('insert into drivers')) {
      const driver = {
        id: store.nextIds.drivers++,
        email: params[0],
        name: params[1],
        phone: params[2] || null,
        license_number: params[3] || null,
        vehicle_info: params[4] || null,
        plate_number: params[5] || null,
        national_id_number: params[6] || null,
        insurance_number: params[7] || null,
        status: 'pending',
        password_hash: params[8] || null,
        docs_json: params[9] || '[]',
        profile_photo_url: null,
        car_photo_url: null,
        is_online: 0,
        current_ride_id: null,
        rating: 5,
        review_count: 0,
        created_at: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
        updated_at: new Date().toISOString(),
        current_lat: null,
        current_lng: null,
        location_updated_at: null
      };
      store.drivers.set(driver.id, driver);
      saveCollection('drivers', store.drivers);
      saveNextIds();
      return { lastID: driver.id, changes: 1 };
    }

    if (sqlLower.includes('insert into rides')) {
      const ride = {
        id: store.nextIds.rides++,
        customer_id: params[0],
        driver_id: null,
        pickup_location: params[1],
        dropoff_location: params[2],
        pickup_lat: params[3] || null,
        pickup_lng: params[4] || null,
        dropoff_lat: params[5] || null,
        dropoff_lng: params[6] || null,
        scheduled_at: params[7],
        scheduled_local: params[8],
        requested_car_type: params[9] || 'standard',
        payment_method: params[10] || 'cash',
        distance_km: params[11] || 0,
        duration_min: params[12] || 0,
        estimated_fare: params[13] || 0,
        final_fare: null,
        status: 'pending',
        timeline_stage: 'requested',
        customer_note: null,
        driver_note: null,
        cancel_reason: null,
        customer_rating: null,
        customer_review: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      store.rides.set(ride.id, ride);
      saveCollection('rides', store.rides);
      saveNextIds();
      return { lastID: ride.id, changes: 1 };
    }

    if (sqlLower.includes('insert into ride_messages')) {
      const msg = {
        id: store.nextIds.rideMessages++,
        ride_id: params[0],
        sender_role: params[1],
        sender_id: params[2],
        message: params[3],
        created_at: new Date().toISOString()
      };
      store.rideMessages.set(msg.id, msg);
      appendLine(filePaths.rideMessages, JSON.stringify(msg));
      saveNextIds();
      return { lastID: msg.id, changes: 1 };
    }

    if (sqlLower.includes('insert into notifications')) {
      const notif = {
        id: store.nextIds.notifications++,
        target_role: params[0],
        target_user_id: params[1] || null,
        title: params[2] || null,
        message: params[3],
        type: params[4] || 'info',
        is_read: 0,
        created_at: new Date().toISOString()
      };
      store.notifications.set(notif.id, notif);
      appendLine(filePaths.notifications, JSON.stringify(notif));
      saveNextIds();
      return { lastID: notif.id, changes: 1 };
    }

    if (sqlLower.includes('into ride_driver_offers')) {
      const key = `${params[0]}_${params[1]}`;
      const existing = store.rideDriverOffers.get(key);
      const offer = {
        id: existing?.id || store.nextIds.rideDriverOffers++,
        ride_id: params[0],
        driver_id: params[1],
        status: 'offered',
        distance_km: params[2] || 0,
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      store.rideDriverOffers.set(key, offer);
      saveCollection('rideDriverOffers', store.rideDriverOffers);
      if (!existing) saveNextIds();
      return { lastID: offer.id, changes: 1 };
    }

    if (sqlLower.includes('insert into driver_reset_requests')) {
      const req = {
        id: store.nextIds.driverResetRequests++,
        driver_id: params[0] || null,
        driver_phone: params[1] || null,
        whatsapp: params[2] || null,
        status: params[3] || 'pending',
        created_at: new Date().toISOString()
      };
      store.driverResetRequests.set(req.id, req);
      saveCollection('driverResetRequests', store.driverResetRequests);
      saveNextIds();
      return { lastID: req.id, changes: 1 };
    }

    if (sqlLower.includes('update users')) {
      const userId = params[params.length - 1];
      const user = store.users.get(userId);
      if (!user) return { lastID: 0, changes: 0 };

      if (sqlLower.includes('set role = ?, name = ?')) {
        user.role = params[0];
        user.name = params[1] || user.name;
        user.updated_at = new Date().toISOString();
      } else if (sqlLower.includes('set role = ?')) {
        user.role = params[0];
        user.updated_at = new Date().toISOString();
      } else if (sqlLower.includes('update users set name')) {
        user.name = params[0];
        if (params.length > 2) user.phone = params[1];
        user.updated_at = new Date().toISOString();
      } else if (sqlLower.includes('update users set password_hash')) {
        user.password_hash = params[0];
        user.updated_at = new Date().toISOString();
      }

      store.users.set(userId, user);
      saveCollection('users', store.users);
      return { lastID: userId, changes: 1 };
    }

    if (sqlLower.includes('update drivers')) {
      const driverId = params[params.length - 1];
      const driver = store.drivers.get(driverId);
      if (!driver) return { lastID: 0, changes: 0 };

      if (sqlLower.includes("set status = 'approved'")) {
        driver.status = 'approved';
        driver.approved_at = new Date().toISOString();
        driver.approved_by = params[0] ?? null;
      } else if (sqlLower.includes("set status = 'rejected'")) {
        driver.status = 'rejected';
        driver.is_online = 0;
      } else if (sqlLower.includes('is_online')) {
        const lat = Number.isFinite(Number(params[1])) ? Number(params[1]) : null;
        const lng = Number.isFinite(Number(params[3])) ? Number(params[3]) : null;
        driver.is_online = params[0] ? 1 : 0;
        if (lat !== null) driver.current_lat = lat;
        if (lng !== null) driver.current_lng = lng;
        if (lat !== null && lng !== null) driver.location_updated_at = new Date().toISOString();
      } else if (sqlLower.includes('current_ride_id')) {
        driver.current_ride_id = params[0] || null;
      } else if (sqlLower.includes('current_lat = ?') && sqlLower.includes('current_lng = ?')) {
        driver.current_lat = Number(params[0]);
        driver.current_lng = Number(params[1]);
        driver.location_updated_at = new Date().toISOString();
      } else if (sqlLower.includes('set name = coalesce(nullif')) {
        if (params[0]) driver.name = params[0];
        if (params[1]) driver.phone = params[1];
        if (params[2]) driver.vehicle_info = params[2];
        if (params[3]) driver.plate_number = params[3];
        if (params[4]) driver.license_number = params[4];
        if (params[5]) driver.national_id_number = params[5];
        if (params[6]) driver.insurance_number = params[6];
        if (params[7] && params[7] !== '[]') driver.docs_json = params[8] || params[7];
      }
      driver.updated_at = new Date().toISOString();

      store.drivers.set(driverId, driver);
      saveCollection('drivers', store.drivers);
      return { lastID: driverId, changes: 1 };
    }

    if (sqlLower.includes('update rides')) {
      let rideId = null;
      let ride = null;
      if (sqlLower.includes('where id = ? and driver_id = ?')) {
        rideId = Number(params[params.length - 2]);
        ride = store.rides.get(rideId);
        if (!ride || Number(ride.driver_id) !== Number(params[params.length - 1])) return { lastID: 0, changes: 0 };
      } else if (sqlLower.includes("where id = ? and status = 'pending'")) {
        rideId = Number(params[params.length - 1]);
        ride = store.rides.get(rideId);
        if (!ride || ride.status !== 'pending') return { lastID: 0, changes: 0 };
      } else {
        rideId = Number(params[params.length - 1]);
        ride = store.rides.get(rideId);
        if (!ride) return { lastID: 0, changes: 0 };
      }

      if (sqlLower.includes("set driver_id = ?, status = 'accepted', timeline_stage = 'accepted'")) {
        ride.driver_id = params[0];
        ride.status = 'accepted';
        ride.timeline_stage = 'accepted';
      } else if (sqlLower.includes("set status = 'pending', driver_id = null, timeline_stage = 'requested'")) {
        ride.status = 'pending';
        ride.driver_id = null;
        ride.timeline_stage = 'requested';
      } else if (sqlLower.includes('set status = ?, timeline_stage = ?, final_fare = ?')) {
        ride.status = params[0];
        ride.timeline_stage = params[1];
        ride.final_fare = params[2];
      } else if (sqlLower.includes('status')) {
        ride.status = params[0];
        ride.timeline_stage = params[1] || ride.timeline_stage;
        if (Number.isFinite(params[2])) ride.final_fare = params[2];
      }
      ride.updated_at = new Date().toISOString();

      store.rides.set(rideId, ride);
      saveCollection('rides', store.rides);
      return { lastID: rideId, changes: 1 };
    }

    if (sqlLower.includes('update ride_driver_offers')) {
      let changes = 0;
      if (sqlLower.includes("set status = 'rejected'") && sqlLower.includes('driver_id = ?')) {
        const rideId = Number(params[0]);
        const driverId = Number(params[1]);
        store.rideDriverOffers.forEach((offer, key) => {
          if (Number(offer.ride_id) === rideId && Number(offer.driver_id) === driverId && offer.status === 'offered') {
            offer.status = 'rejected';
            offer.updated_at = new Date().toISOString();
            store.rideDriverOffers.set(key, offer);
            changes += 1;
          }
        });
      } else if (sqlLower.includes("case when driver_id = ? then 'accepted' else 'expired'")) {
        const driverId = Number(params[0]);
        const rideId = Number(params[1]);
        store.rideDriverOffers.forEach((offer, key) => {
          if (Number(offer.ride_id) === rideId && offer.status === 'offered') {
            offer.status = Number(offer.driver_id) === driverId ? 'accepted' : 'expired';
            offer.updated_at = new Date().toISOString();
            store.rideDriverOffers.set(key, offer);
            changes += 1;
          }
        });
      } else if (sqlLower.includes("case when driver_id = ? then 'rejected' else 'expired'")) {
        const driverId = Number(params[0]);
        const rideId = Number(params[1]);
        store.rideDriverOffers.forEach((offer, key) => {
          if (Number(offer.ride_id) === rideId) {
            offer.status = Number(offer.driver_id) === driverId ? 'rejected' : 'expired';
            offer.updated_at = new Date().toISOString();
            store.rideDriverOffers.set(key, offer);
            changes += 1;
          }
        });
      } else {
        const rideId = Number(params[1]);
        store.rideDriverOffers.forEach((offer, key) => {
          if (Number(offer.ride_id) === rideId) {
            offer.status = params[0];
            offer.updated_at = new Date().toISOString();
            store.rideDriverOffers.set(key, offer);
            changes += 1;
          }
        });
      }
      saveCollection('rideDriverOffers', store.rideDriverOffers);
      return { lastID: 0, changes };
    }

    if (sqlLower.includes('update pricing_settings')) {
      store.pricing = {
        id: 1,
        base_fare: params[0],
        per_km: params[1],
        per_min: params[2],
        surge_multiplier: params[3],
        cancellation_fee: params[4],
        updated_at: new Date().toISOString()
      };
      savePricing();
      return { lastID: 1, changes: 1 };
    }

    return { lastID: 0, changes: 0 };
  } catch (error) {
    console.error('runQuery error:', error);
    return { lastID: 0, changes: 0 };
  }
}

// Get a single row
async function getQuery(sql, params = []) {
  try {
    const sqlLower = normalizeSql(sql);

    if (sqlLower.startsWith('select (select count(*) from users')) {
      const rides = getAllRides();
      return {
        customers: getAllUsers().filter((user) => user.role === 'customer').length,
        drivers_online: getAllDrivers().filter((driver) => driver.status === 'approved' && Number(driver.is_online) === 1).length,
        pending_rides: rides.filter((ride) => ride.status === 'pending').length,
        active_rides: rides.filter((ride) => ['accepted', 'arrived', 'enroute'].includes(ride.status)).length,
        completed_rides: rides.filter((ride) => ride.status === 'completed').length,
        revenue: rides
          .filter((ride) => ride.status === 'completed')
          .reduce((sum, ride) => sum + Number(ride.final_fare || 0), 0)
      };
    }

    if (sqlLower.startsWith('select coalesce(sum(case when status = \'completed\'')) {
      const rides = getAllRides();
      return {
        revenue: rides
          .filter((ride) => ride.status === 'completed')
          .reduce((sum, ride) => sum + Number(ride.final_fare || 0), 0),
        completed_trips: rides.filter((ride) => ride.status === 'completed').length,
        cancelled_trips: rides.filter((ride) => ride.status === 'cancelled').length
      };
    }

    if (sqlLower.startsWith('select coalesce(sum(case when status=\'completed\'')) {
      const driverId = Number(params[0]);
      const driverRides = getAllRides().filter((ride) => Number(ride.driver_id) === driverId);
      return {
        earnings_today: driverRides
          .filter((ride) => ride.status === 'completed' && isSameLocalDay(ride.updated_at))
          .reduce((sum, ride) => sum + (Number(ride.final_fare || 0) * 0.8), 0),
        earnings_week: driverRides
          .filter((ride) => ride.status === 'completed' && isWithinLastDays(ride.updated_at, 6))
          .reduce((sum, ride) => sum + (Number(ride.final_fare || 0) * 0.8), 0),
        trips_completed: driverRides.filter((ride) => ride.status === 'completed').length,
        active_distance: driverRides
          .filter((ride) => ['accepted', 'arrived', 'enroute'].includes(ride.status))
          .reduce((sum, ride) => sum + Number(ride.distance_km || 0), 0)
      };
    }

    if (sqlLower.startsWith('select count(*) as total_rides')) {
      const customerId = Number(params[0]);
      const customerRides = getAllRides().filter((ride) => Number(ride.customer_id) === customerId);
      return {
        total_rides: customerRides.length,
        completed_spend: customerRides
          .filter((ride) => ride.status === 'completed')
          .reduce((sum, ride) => sum + Number(ride.final_fare || 0), 0)
      };
    }

    if (sqlLower.includes('from users where')) {
      if (sqlLower.includes('email = ?')) {
        const matches = [];
        for (const user of store.users.values()) {
          if (user.email === params[0] && (params[1] === undefined || user.role === params[1])) {
            matches.push(user);
          }
        }
        if (matches.length === 0) return null;
        if (params[1] === 'admin') {
          const adminWithPassword = matches.find((user) => user.password_hash);
          if (adminWithPassword) return cloneRecord(adminWithPassword);
        }
        return cloneRecord(matches[0]);
      } else if (sqlLower.includes('phone = ? and id != ?')) {
        const match = getAllUsers().find((user) => user.phone === params[0] && Number(user.id) !== Number(params[1]));
        return cloneRecord(match || null);
      } else if (sqlLower.includes('id =')) {
        return cloneRecord(store.users.get(Number(params[0])) || null);
      }
      return null;
    }

    if (sqlLower.includes('from drivers where')) {
      if (sqlLower.includes('email = ?')) {
        for (const driver of store.drivers.values()) {
          if (driver.email === params[0] && (params[1] === undefined || driver.status === params[1])) {
            return cloneRecord(driver);
          }
        }
      } else if (sqlLower.includes('phone = ?')) {
        return cloneRecord(getAllDrivers().find((driver) => driver.phone === params[0]) || null);
      } else if (sqlLower.includes('license_number = ?')) {
        return cloneRecord(getAllDrivers().find((driver) => driver.license_number === params[0]) || null);
      } else if (sqlLower.includes('plate_number = ?')) {
        return cloneRecord(getAllDrivers().find((driver) => driver.plate_number === params[0]) || null);
      } else if (sqlLower.includes('national_id_number = ?')) {
        return cloneRecord(getAllDrivers().find((driver) => driver.national_id_number === params[0]) || null);
      } else if (sqlLower.includes('insurance_number = ?')) {
        return cloneRecord(getAllDrivers().find((driver) => driver.insurance_number === params[0]) || null);
      } else if (sqlLower.includes('id =')) {
        const driver = store.drivers.get(Number(params[0])) || null;
        if (!driver) return null;
        if (sqlLower.includes('status = ?') && driver.status !== params[1]) return null;
        if (sqlLower.includes("status = 'approved'") && driver.status !== 'approved') return null;
        return cloneRecord(driver);
      }
      return null;
    }

    if (sqlLower.includes('from rides join users on users.id = rides.customer_id')
      && sqlLower.includes('where rides.driver_id = ? and rides.status in')) {
      const activeRide = sortByDateDesc(
        getAllRides().filter((ride) => Number(ride.driver_id) === Number(params[0]) && ['accepted', 'arrived', 'enroute'].includes(ride.status)),
        'updated_at'
      )[0];
      return enrichRide(activeRide);
    }

    if (sqlLower.includes('from rides left join drivers on drivers.id = rides.driver_id')
      && sqlLower.includes('where rides.customer_id = ? and rides.status in')) {
      const activeRide = sortByDateDesc(
        getAllRides().filter((ride) => Number(ride.customer_id) === Number(params[0]) && ['pending', 'accepted', 'arrived', 'enroute'].includes(ride.status)),
        'updated_at'
      )[0];
      return enrichRide(activeRide);
    }

    if (sqlLower.includes('from rides where')) {
      if (sqlLower.includes('where id = ? and customer_id = ?')) {
        for (const ride of store.rides.values()) {
          if (Number(ride.id) === Number(params[0]) && Number(ride.customer_id) === Number(params[1])) {
            return cloneRecord(ride);
          }
        }
      } else if (sqlLower.includes('where id = ? and driver_id = ?')) {
        for (const ride of store.rides.values()) {
          if (Number(ride.id) === Number(params[0]) && Number(ride.driver_id) === Number(params[1])) {
            return cloneRecord(ride);
          }
        }
      } else if (sqlLower.includes('driver_id =') && sqlLower.includes('status in')) {
        const statuses = ['accepted', 'arrived', 'enroute'];
        const activeRide = sortByDateDesc(
          getAllRides().filter((ride) => Number(ride.driver_id) === Number(params[0]) && statuses.includes(ride.status)),
          'updated_at'
        )[0];
        return enrichRide(activeRide);
      } else if (sqlLower.includes('customer_id = ?') && sqlLower.includes('status in')) {
        const activeRide = sortByDateDesc(
          getAllRides().filter((ride) => Number(ride.customer_id) === Number(params[0]) && ['pending', 'accepted', 'arrived', 'enroute'].includes(ride.status)),
          'updated_at'
        )[0];
        return enrichRide(activeRide);
      } else if (sqlLower.includes('where id = ?')) {
        return cloneRecord(store.rides.get(Number(params[0])) || null);
      }
      return null;
    }

    if (sqlLower.includes('from pricing_settings')) {
      return store.pricing || null;
    }

    if (sqlLower.includes('from ride_driver_offers')) {
      if (sqlLower.includes('join rides on rides.id = offers.ride_id')) {
        const driverId = Number(params[0]);
        const incoming = sortByDateDesc(
          getAllRideOffers()
            .filter((offer) => Number(offer.driver_id) === driverId && offer.status === 'offered')
            .map((offer) => {
              const ride = store.rides.get(Number(offer.ride_id));
              if (!ride || ride.status !== 'pending') return null;
              const customer = store.users.get(Number(ride.customer_id)) || null;
              return {
                id: ride.id,
                pickup_location: ride.pickup_location,
                dropoff_location: ride.dropoff_location,
                pickup_lat: ride.pickup_lat,
                pickup_lng: ride.pickup_lng,
                dropoff_lat: ride.dropoff_lat,
                dropoff_lng: ride.dropoff_lng,
                distance_km: ride.distance_km,
                duration_min: ride.duration_min,
                driver_distance_km: offer.distance_km,
                estimated_fare: ride.estimated_fare,
                scheduled_at: ride.scheduled_at,
                scheduled_local: ride.scheduled_local,
                customer_name: customer?.name || null,
                customer_phone: customer?.phone || null,
                created_at: offer.created_at
              };
            })
            .filter(Boolean),
          'created_at'
        )[0];
        return cloneRecord(incoming || null);
      }

      const key = `${params[0]}_${params[1]}`;
      const offer = store.rideDriverOffers.get(key) || null;
      if (!offer) return null;
      if (sqlLower.includes("status = 'offered'") && offer.status !== 'offered') return null;
      return cloneRecord(offer);
    }

    return null;
  } catch (error) {
    console.error('getQuery error:', error);
    return null;
  }
}

// Get multiple rows
async function allQuery(sql, params = []) {
  try {
    const sqlLower = normalizeSql(sql);
    const result = [];

    if (sqlLower === 'select * from users') return sortByDateDesc(getAllUsers());
    if (sqlLower === 'select * from drivers') return sortByDateDesc(getAllDrivers());
    if (sqlLower === 'select * from rides') return sortByDateDesc(getAllRides());
    if (sqlLower === 'select * from ride_messages') return sortByDateDesc(getAllRideMessages());
    if (sqlLower === 'select * from notifications') return sortByDateDesc(getAllNotifications());
    if (sqlLower === 'select * from driver_reset_requests') return sortByDateDesc(getAllResetRequests());
    if (sqlLower === 'select * from ride_driver_offers') return sortByDateDesc(getAllRideOffers(), 'created_at');
    if (sqlLower === 'select * from pricing_settings') return store.pricing ? [cloneRecord(store.pricing)] : [];

    if (sqlLower.includes('from users')) {
      const hasEmailFilter = sqlLower.includes('where email = ?');
      const hasRoleParamFilter = sqlLower.includes('role = ?');
      const hasCustomerLiteralRole = sqlLower.includes("where role = 'customer'");

      for (const user of store.users.values()) {
        if (hasEmailFilter && user.email !== params[0]) continue;
        if (hasRoleParamFilter) {
          const roleParamIndex = hasEmailFilter ? 1 : 0;
          if (user.role !== params[roleParamIndex]) continue;
        }
        if (hasCustomerLiteralRole && user.role !== 'customer') continue;
        result.push(user);
      }
      return sortByDateDesc(result).slice(0, sqlLower.includes('limit 150') ? 150 : result.length);
    }

    if (sqlLower.includes('from drivers where')) {
      let drivers = getAllDrivers();
      if (sqlLower.includes("status = 'pending'")) drivers = drivers.filter((driver) => driver.status === 'pending');
      if (sqlLower.includes("status = 'approved'")) drivers = drivers.filter((driver) => driver.status === 'approved');
      if (sqlLower.includes('is_online = 1')) drivers = drivers.filter((driver) => Number(driver.is_online) === 1);
      if (sqlLower.includes('current_ride_id is null')) drivers = drivers.filter((driver) => !driver.current_ride_id);
      if (sqlLower.includes('current_lat is not null')) drivers = drivers.filter((driver) => driver.current_lat !== null && driver.current_lat !== undefined);
      if (sqlLower.includes('current_lng is not null')) drivers = drivers.filter((driver) => driver.current_lng !== null && driver.current_lng !== undefined);
      if (sqlLower.includes('location_updated_at is not null')) drivers = drivers.filter((driver) => Boolean(driver.location_updated_at));

      const freshnessMinutes = parseMinuteWindow(sqlLower);
      if (freshnessMinutes !== null) {
        const cutoff = Date.now() - (freshnessMinutes * 60 * 1000);
        drivers = drivers.filter((driver) => toTime(driver.location_updated_at) >= cutoff);
      }
      return sqlLower.includes('order by updated_at desc') ? sortByDateDesc(drivers, 'updated_at') : sortByDateDesc(drivers);
    }

    if (sqlLower.includes('from ride_driver_offers')) {
      for (const offer of store.rideDriverOffers.values()) {
        if (offer.ride_id === params[0]) result.push(offer);
      }
      return sortByDateDesc(result, 'created_at');
    }

    if (sqlLower.includes('from rides')) {
      if (sqlLower.includes('join users on users.id = rides.customer_id') || sqlLower.includes('left join users on users.id = rides.customer_id')
        || sqlLower.includes('left join drivers on drivers.id = rides.driver_id') || sqlLower.includes('join users on users.id = rides.customer_id')) {
        let rides = getAllRides();
        if (sqlLower.includes('where rides.customer_id = ?')) rides = rides.filter((ride) => Number(ride.customer_id) === Number(params[0]));
        if (sqlLower.includes('where rides.driver_id = ? and rides.status in (\'completed\',\'cancelled\')')) {
          rides = rides.filter((ride) => Number(ride.driver_id) === Number(params[0]) && ['completed', 'cancelled'].includes(ride.status));
        } else if (sqlLower.includes('where rides.driver_id = ?')) {
          rides = rides.filter((ride) => Number(ride.driver_id) === Number(params[0]));
        }
        if (sqlLower.includes('status = \'completed\' and customer_rating is not null')) {
          rides = rides.filter((ride) => Number(ride.driver_id) === Number(params[0]) && ride.status === 'completed' && ride.customer_rating !== null && ride.customer_rating !== undefined);
        }
        const enriched = sortByDateDesc(rides).map((ride) => enrichRide(ride));
        if (sqlLower.includes('limit 12')) return enriched.slice(0, 12);
        if (sqlLower.includes('limit 20')) return enriched.slice(0, 20);
        if (sqlLower.includes('limit 50')) return enriched.slice(0, 50);
        if (sqlLower.includes('limit 120')) return enriched.slice(0, 120);
        if (sqlLower.includes('limit 250')) return enriched.slice(0, 250);
        return enriched;
      }

      if (sqlLower.includes('customer_id')) {
        for (const ride of store.rides.values()) {
          if (ride.customer_id === params[0]) result.push(ride);
        }
      } else if (sqlLower.includes('driver_id')) {
        for (const ride of store.rides.values()) {
          if (ride.driver_id === params[0]) result.push(ride);
        }
      } else {
        result.push(...store.rides.values());
      }
      if (sqlLower.includes("status = 'completed' and customer_rating is not null")) {
        return sortByDateDesc(result.filter((ride) => ride.status === 'completed' && ride.customer_rating !== null && ride.customer_rating !== undefined), 'updated_at').slice(0, 20);
      }
      return sortByDateDesc(result).slice(0, 250);
    }

    if (sqlLower.includes('from ride_messages')) {
      for (const msg of store.rideMessages.values()) {
        if (msg.ride_id === params[0]) result.push(msg);
      }
      return sortByDateDesc(result).slice(0, sqlLower.includes('limit 20') ? 20 : 50);
    }

    if (sqlLower.includes('from drivers left join rides on rides.driver_id = drivers.id')) {
      const rows = getAllDrivers()
        .filter((driver) => driver.status === 'approved')
        .map((driver) => {
          const driverRides = getAllRides().filter((ride) => Number(ride.driver_id) === Number(driver.id));
          return {
            id: driver.id,
            name: driver.name,
            total_earnings: driverRides
              .filter((ride) => ride.status === 'completed')
              .reduce((sum, ride) => sum + (Number(ride.final_fare || 0) * 0.8), 0),
            today_earnings: driverRides
              .filter((ride) => ride.status === 'completed' && isSameLocalDay(ride.updated_at))
              .reduce((sum, ride) => sum + (Number(ride.final_fare || 0) * 0.8), 0),
            trips: driverRides.filter((ride) => ride.status === 'completed').length
          };
        });
      return rows.sort((left, right) => right.total_earnings - left.total_earnings);
    }

    if (sqlLower.includes('from notifications')) {
      for (const notif of store.notifications.values()) {
        if (sqlLower.includes("where target_role in ('all','drivers') or target_user_id = ?")) {
          if (matchesNotificationAudience(notif, params[0], ['all', 'drivers'])) result.push(notif);
        } else if (sqlLower.includes("where target_role in ('all','customers') or target_user_id = ?")) {
          if (matchesNotificationAudience(notif, params[0], ['all', 'customers'])) result.push(notif);
        } else {
          result.push(notif);
        }
      }
      return sortByDateDesc(result).slice(0, sqlLower.includes('limit 30') ? 30 : sqlLower.includes('limit 50') ? 50 : 100);
    }

    if (sqlLower.includes('from driver_reset_requests')) {
      for (const req of store.driverResetRequests.values()) {
        result.push(req);
      }
      return sortByDateDesc(result).slice(0, 50);
    }

    return result;
  } catch (error) {
    console.error('allQuery error:', error);
    return [];
  }
}

module.exports = {
  initStorage,
  runQuery,
  getQuery,
  allQuery,
  dataDir
};
