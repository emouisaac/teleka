# Teleka Android Studio Workspace

This folder contains a native Android Studio version of the current Teleka web platform.

## What this workspace includes

- `customerApp`: customer booking, quote preview, ride tracking, chat, notifications, Google sign-in
- `adminApp`: admin login, dispatch, driver approvals, fare settings, driver map, alerts
- `driverApp`: driver login, registration, face-photo capture, documents upload, live location, ride actions, chat
- `teleka-core`: shared network/session/models/maps/theme code used by all three apps

## Important architecture note

This Android project does **not** replace your Node backend in this repo.

It is built to talk to the existing backend endpoints already defined in:

- `server.js`
- `src/routes/auth.js`
- `src/routes/public.js`
- `src/routes/customer.js`
- `src/routes/admin.js`
- `src/routes/driver.js`
- `src/realtime.js`

## Where to open in Android Studio

Open this folder directly:

`android/teleka-android`

## First value you need to change

Your backend base URL is controlled in:

- `android/teleka-android/gradle.properties`

Edit:

`TELEKA_BASE_URL=http://10.0.2.2:3000/`

Use `http://10.0.2.2:3000/` when the backend runs on your PC and the Android emulator runs on the same PC.

## Google setup

You already expose Google config from `/api/public/config`.

Still, for Android you should also add your native Maps key in each app manifest:

- `customerApp/src/main/AndroidManifest.xml`
- `adminApp/src/main/AndroidManifest.xml`
- `driverApp/src/main/AndroidManifest.xml`

Search for `YOUR_ANDROID_MAPS_KEY`.

## What to run

Run one app module at a time from Android Studio:

- `customerApp`
- `adminApp`
- `driverApp`

## About Gradle wrapper

I could not generate `gradlew` and the Gradle wrapper from this shell because `gradle` is not installed in the environment.

If Android Studio prompts you to create or import a Gradle wrapper for this folder, allow it.
