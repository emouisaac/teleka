# Teleka Taxi Service

A full-stack taxi platform with synchronized customer, driver, and admin dashboards backed by persistent JSON storage.

## Features

- Customer Google OAuth login
- Admin email/password login
- Driver registration, approval, and JWT login
- Live dashboard sync across all roles (polling snapshots)
- Persistent ride lifecycle storage:
  - request
  - accept
  - arrived
  - enroute
  - completed/cancelled
- Persistent ride messaging and notifications
- Server-side pricing settings controlled by admin
- Backup export endpoint for operations (`/api/admin/export`)

## Production Persistence

- Main app data is stored as JSON/NDJSON files under `TELEKA_DATA_DIR` or the default app-data folder
- Admin/customer login sessions are stored in SQLite at `TELEKA_DATA_DIR\\sessions\\TELEKA_SESSIONS_DB`
- Driver login tokens are signed to persist for `TELEKA_DRIVER_TOKEN_TTL_DAYS` days by default
- By default, both the JSON data store and the session DB live outside the repo in the user app-data folder, so git pulls or repo replacements do not wipe panel data
- If a repo-local storage path is configured by mistake, the server automatically redirects it back to persistent app-data storage unless `TELEKA_ALLOW_REPO_STORAGE=true`
- Customer entered ride date/time is saved as:
  - `scheduled_local` (exact entered value)
  - `scheduled_at` (normalized ISO datetime)
- Completed/cancelled ride history, ride messages, notifications, and reset requests are retained for 180 days by default (`TELEKA_RETENTION_DAYS`)
- Legacy repo-local JSON data files under `data/` are auto-seeded into the persistent storage location on first boot when needed
- Existing admin credentials are no longer reset on every server start; the default admin account is only seeded when missing

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env`:
   - `AUTH_SECRET` (strong secret)
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_MAPS_API_KEY`
   - `TELEKA_DATA_DIR` (optional base folder for Teleka persistence)
   - `TELEKA_SESSIONS_DB` (optional session DB filename)
   - `TELEKA_SESSION_TTL_DAYS` (default `180`)
   - `TELEKA_DRIVER_TOKEN_TTL_DAYS` (default `365`)
   - `TELEKA_ALLOW_REPO_STORAGE` (optional, defaults to `false`)
   - `ALLOWED_ORIGINS`

3. Start server:
   ```bash
   npm start
   ```

4. Open:
   - Customer: `http://localhost:3000`
   - Admin: `http://localhost:3000/admin`
   - Driver: `http://localhost:3000/driver`

## Core API Surfaces

- Customer: `/api/customer/snapshot`, `/api/rides/request`
- Driver: `/api/driver/snapshot`, `/api/driver/rides/:rideId/*`
- Admin: `/api/admin/snapshot`, `/api/admin/pricing`, `/api/admin/export`

## Notes

- Enable Maps JavaScript API + Places API + Directions API in Google Cloud
- Add localhost referrer(s) for Maps key during development
- Rotate any exposed credentials before production launch
