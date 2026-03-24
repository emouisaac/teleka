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

// Run a write operation (INSERT/UPDATE)
async function runQuery(sql, params = []) {
  try {
    const sqlLower = sql.toLowerCase();

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
        status: params[8] || 'pending',
        password_hash: params[9] || null,
        docs_json: params[10] || '[]',
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
        driver_id: params[1] || null,
        pickup_location: params[2],
        dropoff_location: params[3],
        pickup_lat: params[4] || null,
        pickup_lng: params[5] || null,
        dropoff_lat: params[6] || null,
        dropoff_lng: params[7] || null,
        scheduled_at: params[8],
        scheduled_local: params[9],
        requested_car_type: params[10] || 'standard',
        payment_method: params[11] || 'cash',
        distance_km: params[12] || 0,
        duration_min: params[13] || 0,
        estimated_fare: params[14] || 0,
        final_fare: null,
        status: params[15] || 'pending',
        timeline_stage: params[16] || 'requested',
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

    if (sqlLower.includes('insert into ride_driver_offers')) {
      const offer = {
        id: store.nextIds.rideDriverOffers++,
        ride_id: params[0],
        driver_id: params[1],
        status: params[2] || 'offered',
        distance_km: params[3] || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const key = `${offer.ride_id}_${offer.driver_id}`;
      store.rideDriverOffers.set(key, offer);
      saveCollection('rideDriverOffers', store.rideDriverOffers);
      saveNextIds();
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

      if (sqlLower.includes('is_online')) {
        driver.is_online = params[0];
        if (Number.isFinite(params[1])) driver.current_lat = params[1];
        if (Number.isFinite(params[3])) driver.current_lng = params[3];
        if (Number.isFinite(params[5])) driver.location_updated_at = new Date().toISOString();
      } else if (sqlLower.includes('current_ride_id')) {
        driver.current_ride_id = params[0] || null;
      } else if (sqlLower.includes('current_lat')) {
        driver.current_lat = params[0];
        driver.current_lng = params[1];
        driver.location_updated_at = new Date().toISOString();
      } else if (sqlLower.includes('profile')) {
        if (params[0]) driver.name = params[0];
        if (params[1]) driver.phone = params[1];
        if (params[2]) driver.vehicle_info = params[2];
        if (params[3]) driver.plate_number = params[3];
        if (params[4]) driver.license_number = params[4];
        if (params[5]) driver.national_id_number = params[5];
        if (params[6]) driver.insurance_number = params[6];
        if (params[7] && params[7] !== '[]') driver.docs_json = params[7];
      } else if (sqlLower.includes('status')) {
        driver.status = params[0];
        driver.is_online = 0;
      } else if (sqlLower.includes('approved')) {
        driver.status = params[0];
        driver.approved_at = new Date().toISOString();
        driver.approved_by = params[1];
      }
      driver.updated_at = new Date().toISOString();

      store.drivers.set(driverId, driver);
      saveCollection('drivers', store.drivers);
      return { lastID: driverId, changes: 1 };
    }

    if (sqlLower.includes('update rides')) {
      const rideId = params[params.length - 1];
      const ride = store.rides.get(rideId);
      if (!ride) return { lastID: 0, changes: 0 };

      if (sqlLower.includes('driver_id')) {
        ride.driver_id = params[0];
        ride.status = params[1] || ride.status;
        ride.timeline_stage = params[2] || ride.timeline_stage;
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
      const rideId = params[params.length - 1];
      store.rideDriverOffers.forEach((offer) => {
        if (offer.ride_id === rideId) {
          if (sqlLower.includes('status = case')) {
            // Handle CASE statement
            if (params[0]) offer.status = offer.driver_id === params[0] ? 'accepted' : 'expired';
          } else {
            offer.status = params[0];
          }
          offer.updated_at = new Date().toISOString();
        }
      });
      saveCollection('rideDriverOffers', store.rideDriverOffers);
      return { lastID: 0, changes: 1 };
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
    const sqlLower = sql.toLowerCase();

    if (sqlLower.includes('from users where')) {
      if (sqlLower.includes('email')) {
        const matches = [];
        for (const user of store.users.values()) {
          if (user.email === params[0] && (params[1] === undefined || user.role === params[1])) {
            matches.push(user);
          }
        }
        if (matches.length === 0) return null;
        if (params[1] === 'admin') {
          const adminWithPassword = matches.find((user) => user.password_hash);
          if (adminWithPassword) return adminWithPassword;
        }
        return matches[0];
      } else if (sqlLower.includes('id =')) {
        return store.users.get(params[0]) || null;
      }
      return null;
    }

    if (sqlLower.includes('from drivers where')) {
      if (sqlLower.includes('email')) {
        for (const driver of store.drivers.values()) {
          if (driver.email === params[0] && (params[1] === undefined || driver.status === params[1])) {
            return driver;
          }
        }
      } else if (sqlLower.includes('id =')) {
        return store.drivers.get(params[0]) || null;
      }
      return null;
    }

    if (sqlLower.includes('from rides where')) {
      if (sqlLower.includes('id =') && sqlLower.includes('customer_id')) {
        for (const ride of store.rides.values()) {
          if (ride.id === params[0] && ride.customer_id === params[1]) {
            return ride;
          }
        }
      } else if (sqlLower.includes('id =') && sqlLower.includes('driver_id')) {
        for (const ride of store.rides.values()) {
          if (ride.id === params[0] && ride.driver_id === params[1]) {
            return ride;
          }
        }
      } else if (sqlLower.includes('driver_id =') && sqlLower.includes('status in')) {
        const statuses = ['accepted', 'arrived', 'enroute'];
        for (const ride of store.rides.values()) {
          if (ride.driver_id === params[0] && statuses.includes(ride.status)) {
            return ride;
          }
        }
      }
      return null;
    }

    if (sqlLower.includes('from pricing_settings')) {
      return store.pricing || null;
    }

    if (sqlLower.includes('from ride_driver_offers')) {
      const key = `${params[0]}_${params[1]}`;
      return store.rideDriverOffers.get(key) || null;
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
    const sqlLower = sql.toLowerCase();
    const result = [];

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
      return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 150);
    }

    if (sqlLower.includes('from drivers') && sqlLower.includes('status')) {
      const status = sqlLower.includes('pending') ? 'pending' : 'approved';
      for (const driver of store.drivers.values()) {
        if (driver.status === status) result.push(driver);
      }
      return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    if (sqlLower.includes('from drivers where')) {
      if (sqlLower.includes('approved') && sqlLower.includes('online')) {
        for (const driver of store.drivers.values()) {
          if (driver.status === 'approved' && driver.is_online === 1) result.push(driver);
        }
      } else {
        result.push(...store.drivers.values());
      }
      return result;
    }

    if (sqlLower.includes('from ride_driver_offers')) {
      for (const offer of store.rideDriverOffers.values()) {
        if (offer.ride_id === params[0]) result.push(offer);
      }
      return result;
    }

    if (sqlLower.includes('from rides')) {
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
      return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 250);
    }

    if (sqlLower.includes('from ride_messages')) {
      for (const msg of store.rideMessages.values()) {
        if (msg.ride_id === params[0]) result.push(msg);
      }
      return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
    }

    if (sqlLower.includes('from notifications')) {
      for (const notif of store.notifications.values()) {
        if (sqlLower.includes('target_role in')) {
          if ((params[0].split(',').includes(notif.target_role) || notif.target_user_id === params[1])) {
            result.push(notif);
          }
        } else {
          result.push(notif);
        }
      }
      return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, params[2] || 100);
    }

    if (sqlLower.includes('from driver_reset_requests')) {
      for (const req of store.driverResetRequests.values()) {
        result.push(req);
      }
      return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
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
