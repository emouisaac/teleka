import session from "express-session";

import { nowIso } from "./db.js";

function getSessionColumns(db) {
  return new Set(db.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name));
}

function ensureSessionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const columns = getSessionColumns(db);

  if (!columns.has("expires_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN expires_at TEXT;");
    if (columns.has("expired")) {
      db.exec(`
        UPDATE sessions
        SET expires_at = COALESCE(
          expires_at,
          strftime('%Y-%m-%dT%H:%M:%fZ', expired / 1000.0, 'unixepoch')
        )
        WHERE expired IS NOT NULL
      `);
    }
    db.exec(`
      UPDATE sessions
      SET expires_at = COALESCE(expires_at, '${nowIso()}')
      WHERE expires_at IS NULL
    `);
  }

  if (!columns.has("updated_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN updated_at TEXT;");
    db.exec(`
      UPDATE sessions
      SET updated_at = COALESCE(updated_at, expires_at, '${nowIso()}')
      WHERE updated_at IS NULL
    `);
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);");
}

export class SQLiteSessionStore extends session.Store {
  constructor({ db, ttlDays = 30 }) {
    super();
    this.db = db;
    this.ttlDays = ttlDays;
    ensureSessionSchema(this.db);
    this.cleanupExpired();
  }

  get(sid, callback) {
    try {
      const row = this.db
        .prepare("SELECT sess, expires_at FROM sessions WHERE sid = ?")
        .get(sid);

      if (!row) {
        callback(null, null);
        return;
      }

      if (new Date(row.expires_at).getTime() <= Date.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }

      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expiresAt = this.resolveExpiry(sess);
      this.db
        .prepare(
          `
            INSERT INTO sessions (sid, sess, expires_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(sid) DO UPDATE SET
              sess = excluded.sess,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at
          `
        )
        .run(sid, JSON.stringify(sess), expiresAt, nowIso());
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      this.db
        .prepare("UPDATE sessions SET expires_at = ?, updated_at = ? WHERE sid = ?")
        .run(this.resolveExpiry(sess), nowIso(), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  resolveExpiry(sess) {
    const cookieExpiry = sess?.cookie?.expires
      ? new Date(sess.cookie.expires).toISOString()
      : null;

    if (cookieExpiry) {
      return cookieExpiry;
    }

    return new Date(
      Date.now() + this.ttlDays * 24 * 60 * 60 * 1000
    ).toISOString();
  }

  cleanupExpired() {
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(new Date().toISOString());
  }
}
