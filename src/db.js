import bcrypt from "bcryptjs";
import pg from "pg";

import { config } from "./config.js";

const { Pool } = pg;

const statementCache = new Map();

function toPgSql(sqlText) {
  const cached = statementCache.get(sqlText);
  if (cached) {
    return cached;
  }

  let placeholderIndex = 0;
  const transformed = sqlText.replace(/\?/g, () => `$${++placeholderIndex}`);
  statementCache.set(sqlText, transformed);
  return transformed;
}

class PreparedStatement {
  constructor(client, sqlText) {
    this.client = client;
    this.sqlText = toPgSql(sqlText);
  }

  async get(...values) {
    const result = await this.client.query(this.sqlText, values);
    return result.rows[0];
  }

  async all(...values) {
    const result = await this.client.query(this.sqlText, values);
    return result.rows;
  }

  async run(...values) {
    return this.client.query(this.sqlText, values);
  }
}

function createAdapter(client) {
  return {
    prepare(sqlText) {
      return new PreparedStatement(client, sqlText);
    },
    async exec(sqlText) {
      return client.query(sqlText);
    }
  };
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined
});

pool.on("error", (error) => {
  console.error("Unexpected Postgres pool error", error);
});

const rootAdapter = createAdapter(pool);

export const database = {
  prepare(sqlText) {
    return rootAdapter.prepare(sqlText);
  },
  async exec(sqlText) {
    return rootAdapter.exec(sqlText);
  },
  async withTransaction(work) {
    const client = await pool.connect();
    const transactionAdapter = createAdapter(client);

    try {
      await client.query("BEGIN");
      const result = await work(transactionAdapter);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors so the original failure can surface.
      }
      throw error;
    } finally {
      client.release();
    }
  }
};

export function nowIso() {
  return new Date().toISOString();
}

const schemaSql = `
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
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION,
    current_heading DOUBLE PRECISION,
    last_location_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS driver_documents (
    id TEXT PRIMARY KEY,
    driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rides (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending_admin',
    origin_label TEXT NOT NULL,
    origin_address TEXT NOT NULL,
    origin_place_id TEXT,
    origin_lat DOUBLE PRECISION NOT NULL,
    origin_lng DOUBLE PRECISION NOT NULL,
    destination_label TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    destination_place_id TEXT,
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,
    requested_vehicle_class TEXT NOT NULL DEFAULT 'standard',
    distance_meters DOUBLE PRECISION NOT NULL,
    duration_seconds DOUBLE PRECISION NOT NULL,
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
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION
  );

  CREATE TABLE IF NOT EXISTS ride_messages (
    id TEXT PRIMARY KEY,
    ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
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
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
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
    driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION,
    created_at TEXT NOT NULL
  );
`;

const indexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_places_unique
    ON saved_places(user_role, user_id, address);
  CREATE INDEX IF NOT EXISTS idx_rides_customer ON rides(customer_id, requested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id, requested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_role, target_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_saved_places_lookup ON saved_places(user_role, user_id, usage_count DESC, last_used_at DESC);
  CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON driver_documents(driver_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_location_events_driver ON location_events(driver_id, created_at DESC);
`;

const defaultSettings = {
  fare: {
    baseFareUgx: 5000,
    bookingFeeUgx: 1000,
    perKmUgx: 1800,
    perMinuteUgx: 150,
    minimumFareUgx: 10000
  }
};

export async function getSettings() {
  const rows = await database.prepare("SELECT key, value_json AS \"valueJson\" FROM settings").all();
  const merged = structuredClone(defaultSettings);

  for (const row of rows) {
    merged[row.key] = JSON.parse(row.valueJson);
  }

  return merged;
}

export async function setSetting(key, value) {
  await database
    .prepare(
      `
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = EXCLUDED.value_json,
          updated_at = EXCLUDED.updated_at
      `
    )
    .run(key, JSON.stringify(value), nowIso());
}

async function seedSettings() {
  const existing = await database.prepare("SELECT key FROM settings").all();
  const existingKeys = new Set(existing.map((row) => row.key));

  if (!existingKeys.has("fare")) {
    await setSetting("fare", defaultSettings.fare);
  }
}

async function seedAdmin() {
  const timestamp = nowIso();
  const passwordHash = bcrypt.hashSync(config.adminPassword, 10);

  await database
    .prepare(
      `
        INSERT INTO admins (id, email, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          updated_at = EXCLUDED.updated_at
      `
    )
    .run("admin-root", config.adminEmail, passwordHash, timestamp, timestamp);
}

export async function initializeDatabase() {
  await database.exec(schemaSql);
  await database.exec(indexSql);
  await seedSettings();
  await seedAdmin();
}
