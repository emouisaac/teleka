import session from "express-session";

import { database, nowIso } from "./db.js";

export async function initializeSessionStoreSchema() {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
}

export class PostgresSessionStore extends session.Store {
  constructor({ ttlDays = 30 }) {
    super();
    this.ttlDays = ttlDays;
    void this.cleanupExpired();
  }

  get(sid, callback) {
    (async () => {
      const row = await database
        .prepare('SELECT sess, expires_at AS "expiresAt" FROM sessions WHERE sid = ?')
        .get(sid);

      if (!row) {
        callback(null, null);
        return;
      }

      if (new Date(row.expiresAt).getTime() <= Date.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }

      callback(null, JSON.parse(row.sess));
    })().catch((error) => callback(error));
  }

  set(sid, sess, callback = () => {}) {
    (async () => {
      const expiresAt = this.resolveExpiry(sess);
      await database
        .prepare(
          `
            INSERT INTO sessions (sid, sess, expires_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(sid) DO UPDATE SET
              sess = EXCLUDED.sess,
              expires_at = EXCLUDED.expires_at,
              updated_at = EXCLUDED.updated_at
          `
        )
        .run(sid, JSON.stringify(sess), expiresAt, nowIso());
      callback(null);
    })().catch((error) => callback(error));
  }

  touch(sid, sess, callback = () => {}) {
    (async () => {
      await database
        .prepare('UPDATE sessions SET expires_at = ?, updated_at = ? WHERE sid = ?')
        .run(this.resolveExpiry(sess), nowIso(), sid);
      callback(null);
    })().catch((error) => callback(error));
  }

  destroy(sid, callback = () => {}) {
    (async () => {
      await database.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback(null);
    })().catch((error) => callback(error));
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

  async cleanupExpired() {
    await database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(new Date().toISOString());
  }
}
