# Teleka Taxi Service

A full-stack taxi platform with synchronized customer, driver, and admin dashboards backed by SQLite persistence.

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

- Main data is stored in SQLite at `TELEKA_DB_PATH`
- Login sessions are stored in SQLite at `TELEKA_SESSIONS_DIR` / `TELEKA_SESSIONS_DB`
- By default, both databases live outside the repo in the user app-data folder, so git pulls or repo replacements do not wipe panel data
- Customer entered ride date/time is saved as:
  - `scheduled_local` (exact entered value)
  - `scheduled_at` (normalized ISO datetime)
- Completed/cancelled ride history, ride messages, notifications, and reset requests are retained for 180 days by default (`TELEKA_RETENTION_DAYS`)
- Legacy repo-local `data/teleka.sqlite` and `sessions.db` are auto-seeded into the persistent storage location on first boot when needed

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
   - `TELEKA_DB_PATH` (optional override for the main persistent DB)
   - `TELEKA_DATA_DIR` (optional base folder for Teleka persistence)
   - `TELEKA_SESSIONS_DIR` (optional override for the session DB folder)
   - `TELEKA_SESSIONS_DB` (optional session DB filename)
   - `TELEKA_RETENTION_DAYS` (default `180`)
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
