import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

import { config } from "./config.js";

export const database = new DatabaseSync(config.dbPath);
export const sessionDatabase = new DatabaseSync(config.sessionDbPath);

function applyPragmas(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA synchronous = NORMAL;");
}

applyPragmas(database);
applyPragmas(sessionDatabase);

export function nowIso() {
  return new Date().toISOString();
}

function createTables() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      google_sub TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      avatar_url TEXT,
      phone TEXT,
      preferred_payment_method TEXT DEFAULT 'cash',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      vehicle TEXT NOT NULL,
      plate_number TEXT NOT NULL UNIQUE,
      license_number TEXT NOT NULL,
      national_id_number TEXT NOT NULL,
      insurance_number TEXT NOT NULL,
      face_photo_path TEXT,
      car_photo_path TEXT,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      approval_notes TEXT,
      is_online INTEGER NOT NULL DEFAULT 0,
      current_lat REAL,
      current_lng REAL,
      current_heading REAL,
      last_location_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS driver_documents (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      driver_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending_admin',
      origin_label TEXT NOT NULL,
      origin_address TEXT NOT NULL,
      origin_place_id TEXT,
      origin_lat REAL NOT NULL,
      origin_lng REAL NOT NULL,
      destination_label TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      destination_place_id TEXT,
      destination_lat REAL NOT NULL,
      destination_lng REAL NOT NULL,
      distance_meters REAL NOT NULL,
      duration_seconds REAL NOT NULL,
      quoted_fare_ugx INTEGER NOT NULL,
      final_fare_ugx INTEGER,
      payment_method TEXT NOT NULL,
      customer_notes TEXT,
      driver_notes TEXT,
      requested_at TEXT NOT NULL,
      accepted_at TEXT,
      picked_up_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      current_lat REAL,
      current_lng REAL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ride_messages (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      target_role TEXT NOT NULL,
      target_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      ride_id TEXT,
      metadata_json TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_places (
      id TEXT PRIMARY KEY,
      user_role TEXT NOT NULL,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      place_id TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      last_used_at TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS location_events (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      ride_id TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      heading REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
    );
  `);
}

function createIndexes() {
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_places_unique
      ON saved_places(user_role, user_id, address);
    CREATE INDEX IF NOT EXISTS idx_rides_customer ON rides(customer_id, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_role, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_places_lookup ON saved_places(user_role, user_id, usage_count DESC, last_used_at DESC);
  `);
}

function getTableInfo(tableName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all();
}

function hasTable(tableName) {
  return Boolean(
    database
      .prepare(
        `
          SELECT 1
          FROM sqlite_master
          WHERE type = 'table' AND name = ?
        `
      )
      .get(tableName)
  );
}

function hasColumn(tableName, columnName) {
  return getTableInfo(tableName).some((column) => column.name === columnName);
}

function rebuildTable(tableName, createTableSql, copyDataSql) {
  const tempTableName = `${tableName}__current`;

  database.exec("PRAGMA foreign_keys = OFF;");
  try {
    database.exec("BEGIN;");
    database.exec(`DROP TABLE IF EXISTS ${tempTableName};`);
    database.exec(createTableSql(tempTableName));
    database.exec(copyDataSql(tempTableName));
    database.exec(`DROP TABLE ${tableName};`);
    database.exec(`ALTER TABLE ${tempTableName} RENAME TO ${tableName};`);
    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Ignore rollback errors so the original failure can surface.
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
}

function isLegacyDriversTable() {
  if (!hasTable("drivers")) {
    return false;
  }

  const columns = getTableInfo("drivers");
  const idColumn = columns.find((column) => column.name === "id");
  return (
    Boolean(idColumn && /^INTEGER$/i.test(idColumn.type || "")) ||
    !hasColumn("drivers", "full_name") ||
    !hasColumn("drivers", "vehicle") ||
    !hasColumn("drivers", "approval_status")
  );
}

function isLegacyRidesTable() {
  if (!hasTable("rides")) {
    return false;
  }

  const columns = getTableInfo("rides");
  const idColumn = columns.find((column) => column.name === "id");
  return (
    Boolean(idColumn && /^INTEGER$/i.test(idColumn.type || "")) ||
    !hasColumn("rides", "origin_label") ||
    !hasColumn("rides", "destination_label") ||
    !hasColumn("rides", "quoted_fare_ugx") ||
    !hasColumn("rides", "payment_method")
  );
}

function isLegacyRideMessagesTable() {
  if (!hasTable("ride_messages")) {
    return false;
  }

  const columns = getTableInfo("ride_messages");
  const idColumn = columns.find((column) => column.name === "id");
  return Boolean(idColumn && /^INTEGER$/i.test(idColumn.type || "")) || !hasColumn("ride_messages", "body");
}

function isLegacyNotificationsTable() {
  if (!hasTable("notifications")) {
    return false;
  }

  const columns = getTableInfo("notifications");
  const idColumn = columns.find((column) => column.name === "id");
  return (
    Boolean(idColumn && /^INTEGER$/i.test(idColumn.type || "")) ||
    !hasColumn("notifications", "target_id") ||
    !hasColumn("notifications", "category") ||
    !hasColumn("notifications", "read_at")
  );
}

function migrateLegacyDrivers() {
  if (!isLegacyDriversTable()) {
    return;
  }

  rebuildTable(
    "drivers",
    (tableName) => `
      CREATE TABLE ${tableName} (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        vehicle TEXT NOT NULL,
        plate_number TEXT NOT NULL UNIQUE,
        license_number TEXT NOT NULL,
        national_id_number TEXT NOT NULL,
        insurance_number TEXT NOT NULL,
        face_photo_path TEXT,
        car_photo_path TEXT,
        approval_status TEXT NOT NULL DEFAULT 'pending',
        approval_notes TEXT,
        is_online INTEGER NOT NULL DEFAULT 0,
        current_lat REAL,
        current_lng REAL,
        current_heading REAL,
        last_location_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
    `,
    (tableName) => `
      INSERT INTO ${tableName} (
        id, full_name, email, phone, password_hash, vehicle, plate_number,
        license_number, national_id_number, insurance_number, face_photo_path,
        car_photo_path, approval_status, approval_notes, is_online, current_lat,
        current_lng, current_heading, last_location_at, created_at, updated_at, last_login_at
      )
      SELECT
        CAST(id AS TEXT),
        COALESCE(NULLIF(name, ''), email, 'Legacy driver'),
        email,
        COALESCE(NULLIF(phone, ''), 'Unknown'),
        COALESCE(password_hash, ''),
        COALESCE(NULLIF(vehicle_info, ''), 'Unknown vehicle'),
        COALESCE(NULLIF(plate_number, ''), 'LEGACY-' || id),
        COALESCE(NULLIF(license_number, ''), 'LEGACY-LICENSE-' || id),
        COALESCE(NULLIF(national_id_number, ''), 'LEGACY-NID-' || id),
        COALESCE(NULLIF(insurance_number, ''), 'LEGACY-INS-' || id),
        profile_photo_url,
        car_photo_url,
        CASE
          WHEN status IN ('approved', 'active') THEN 'approved'
          WHEN status = 'rejected' THEN 'rejected'
          ELSE 'pending'
        END,
        NULL,
        COALESCE(is_online, 0),
        current_lat,
        current_lng,
        NULL,
        location_updated_at,
        COALESCE(created_at, CURRENT_TIMESTAMP),
        COALESCE(updated_at, created_at, CURRENT_TIMESTAMP),
        NULL
      FROM drivers;
    `
  );

  if (hasTable("driver_documents")) {
    database.exec("UPDATE driver_documents SET driver_id = CAST(driver_id AS TEXT);");
  }

  if (hasTable("location_events")) {
    database.exec("UPDATE location_events SET driver_id = CAST(driver_id AS TEXT);");
  }
}

function migrateLegacyRides() {
  if (!isLegacyRidesTable()) {
    return;
  }

  rebuildTable(
    "rides",
    (tableName) => `
      CREATE TABLE ${tableName} (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        driver_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending_admin',
        origin_label TEXT NOT NULL,
        origin_address TEXT NOT NULL,
        origin_place_id TEXT,
        origin_lat REAL NOT NULL,
        origin_lng REAL NOT NULL,
        destination_label TEXT NOT NULL,
        destination_address TEXT NOT NULL,
        destination_place_id TEXT,
        destination_lat REAL NOT NULL,
        destination_lng REAL NOT NULL,
        distance_meters REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        quoted_fare_ugx INTEGER NOT NULL,
        final_fare_ugx INTEGER,
        payment_method TEXT NOT NULL,
        customer_notes TEXT,
        driver_notes TEXT,
        requested_at TEXT NOT NULL,
        accepted_at TEXT,
        picked_up_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        current_lat REAL,
        current_lng REAL,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
      );
    `,
    (tableName) => `
      INSERT INTO ${tableName} (
        id, customer_id, driver_id, status, origin_label, origin_address,
        origin_place_id, origin_lat, origin_lng, destination_label,
        destination_address, destination_place_id, destination_lat,
        destination_lng, distance_meters, duration_seconds, quoted_fare_ugx,
        final_fare_ugx, payment_method, customer_notes, driver_notes,
        requested_at, accepted_at, picked_up_at, completed_at, cancelled_at,
        current_lat, current_lng
      )
      SELECT
        CAST(id AS TEXT),
        CAST(customer_id AS TEXT),
        CASE WHEN driver_id IS NULL THEN NULL ELSE CAST(driver_id AS TEXT) END,
        CASE
          WHEN status = 'pending' THEN 'pending_admin'
          ELSE COALESCE(status, 'pending_admin')
        END,
        pickup_location,
        pickup_location,
        NULL,
        0,
        0,
        dropoff_location,
        dropoff_location,
        NULL,
        0,
        0,
        COALESCE(distance, 0),
        0,
        CAST(ROUND(COALESCE(estimated_fare, actual_fare, 0)) AS INTEGER),
        CASE
          WHEN actual_fare IS NULL THEN NULL
          ELSE CAST(ROUND(actual_fare) AS INTEGER)
        END,
        'cash',
        customer_note,
        driver_note,
        COALESCE(created_at, CURRENT_TIMESTAMP),
        accepted_at,
        NULL,
        completed_at,
        cancelled_at,
        NULL,
        NULL
      FROM rides;
    `
  );

  if (hasTable("ride_messages")) {
    database.exec("UPDATE ride_messages SET ride_id = CAST(ride_id AS TEXT);");
  }

  if (hasTable("location_events")) {
    database.exec("UPDATE location_events SET ride_id = CAST(ride_id AS TEXT) WHERE ride_id IS NOT NULL;");
  }
}

function migrateLegacyRideMessages() {
  if (!isLegacyRideMessagesTable()) {
    return;
  }

  rebuildTable(
    "ride_messages",
    (tableName) => `
      CREATE TABLE ${tableName} (
        id TEXT PRIMARY KEY,
        ride_id TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
      );
    `,
    (tableName) => `
      INSERT INTO ${tableName} (id, ride_id, sender_role, sender_id, body, created_at)
      SELECT
        CAST(id AS TEXT),
        CAST(ride_id AS TEXT),
        sender_role,
        CAST(sender_id AS TEXT),
        message,
        COALESCE(created_at, CURRENT_TIMESTAMP)
      FROM ride_messages;
    `
  );
}

function migrateLegacyNotifications() {
  if (!isLegacyNotificationsTable()) {
    return;
  }

  rebuildTable(
    "notifications",
    (tableName) => `
      CREATE TABLE ${tableName} (
        id TEXT PRIMARY KEY,
        target_role TEXT NOT NULL,
        target_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        ride_id TEXT,
        metadata_json TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
    `,
    (tableName) => `
      INSERT INTO ${tableName} (
        id, target_role, target_id, category, title, message, ride_id, metadata_json, read_at, created_at
      )
      SELECT
        CAST(id AS TEXT),
        target_role,
        CASE
          WHEN target_user_id IS NOT NULL THEN CAST(target_user_id AS TEXT)
          WHEN target_role = 'admin' THEN 'admin-root'
          ELSE 'legacy-' || id
        END,
        COALESCE(type, 'info'),
        COALESCE(NULLIF(title, ''), 'Notification'),
        message,
        NULL,
        NULL,
        CASE
          WHEN COALESCE(is_read, 0) = 1 THEN COALESCE(created_at, CURRENT_TIMESTAMP)
          ELSE NULL
        END,
        COALESCE(created_at, CURRENT_TIMESTAMP)
      FROM notifications;
    `
  );
}

function migrateLegacySchema() {
  migrateLegacyDrivers();
  migrateLegacyRides();
  migrateLegacyRideMessages();
  migrateLegacyNotifications();
}

const defaultSettings = {
  fare: {
    baseFareUgx: 5000,
    bookingFeeUgx: 1000,
    perKmUgx: 1800,
    perMinuteUgx: 150,
    minimumFareUgx: 10000
  }
};

export function getSettings() {
  const rows = database.prepare("SELECT key, value_json FROM settings").all();
  const merged = structuredClone(defaultSettings);

  for (const row of rows) {
    merged[row.key] = JSON.parse(row.value_json);
  }

  return merged;
}

export function setSetting(key, value) {
  database
    .prepare(
      `
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `
    )
    .run(key, JSON.stringify(value), nowIso());
}

function seedSettings() {
  const existing = database.prepare("SELECT key FROM settings").all().map((row) => row.key);
  if (!existing.includes("fare")) {
    setSetting("fare", defaultSettings.fare);
  }
}

function seedAdmin() {
  const timestamp = nowIso();
  const passwordHash = bcrypt.hashSync(config.adminPassword, 10);
  database
    .prepare(
      `
        INSERT INTO admins (id, email, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          password_hash = excluded.password_hash,
          updated_at = excluded.updated_at
      `
    )
    .run("admin-root", config.adminEmail, passwordHash, timestamp, timestamp);
}

export function initializeDatabase() {
  createTables();
  migrateLegacySchema();
  createIndexes();
  seedSettings();
  seedAdmin();
}
