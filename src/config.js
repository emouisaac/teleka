import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const projectRoot = process.cwd();
const environment = process.env.NODE_ENV || "development";
const isProduction = environment === "production";
const allowEphemeralStorage = String(process.env.TELEKA_ALLOW_EPHEMERAL_STORAGE || "").toLowerCase() === "true";

function normalizeUrl(input) {
  if (!input) {
    return "";
  }

  try {
    return new URL(input).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function extractHostname(input) {
  if (!input) {
    return "";
  }

  try {
    return new URL(input).hostname;
  } catch {
    return String(input)
      .trim()
      .replace(/^[a-z]+:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
  }
}

function resolveStoragePath(inputPath, fallbackPath) {
  const value = inputPath || fallbackPath;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

function isWithinPath(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const dataRoot = resolveStoragePath(process.env.TELEKA_DATA_DIR, path.join(projectRoot, "data"));
const defaultDbPath = path.join(dataRoot, "teleka.sqlite");
const dbPath = resolveStoragePath(process.env.TELEKA_DB_PATH, defaultDbPath);
const sessionDir = resolveStoragePath(
  process.env.TELEKA_SESSIONS_DIR,
  path.join(dataRoot, "sessions")
);
const sessionDbName = process.env.TELEKA_SESSIONS_DB || "sessions.sqlite";
const sessionDbPath = path.join(sessionDir, sessionDbName);
const uploadRoot = resolveStoragePath(
  process.env.TELEKA_UPLOAD_ROOT,
  path.join(dataRoot, "uploads")
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(uploadRoot, { recursive: true });

const appUrl =
  normalizeUrl(process.env.APP_URL) || `http://localhost:${process.env.PORT || 3000}`;
const rawCookieDomain = extractHostname(process.env.APP_DOMAIN) || extractHostname(appUrl);
const cookieDomain =
  isProduction && rawCookieDomain && !rawCookieDomain.includes("localhost")
    ? rawCookieDomain.replace(/^www\./, "")
    : undefined;

const persistenceWarnings = [];
const storageTargets = [
  ["database", dbPath],
  ["session database", sessionDbPath],
  ["upload storage", uploadRoot]
];

if (isProduction) {
  const projectRootTargets = storageTargets.filter(([, targetPath]) =>
    isWithinPath(projectRoot, targetPath)
  );

  if (projectRootTargets.length) {
    persistenceWarnings.push(
      `Production storage points inside the app directory: ${projectRootTargets
        .map(([label, targetPath]) => `${label}=${targetPath}`)
        .join(", ")}`
    );
  }

  if (
    !process.env.TELEKA_DATA_DIR &&
    !process.env.TELEKA_DB_PATH &&
    !process.env.TELEKA_SESSIONS_DIR &&
    !process.env.TELEKA_UPLOAD_ROOT
  ) {
    persistenceWarnings.push(
      "No explicit persistent storage env vars are configured. Set TELEKA_DATA_DIR or TELEKA_DB_PATH, TELEKA_SESSIONS_DIR, and TELEKA_UPLOAD_ROOT to paths on persistent disk."
    );
  }
}

if (isProduction && persistenceWarnings.length && !allowEphemeralStorage) {
  throw new Error(
    `Unsafe production persistence configuration.\n${persistenceWarnings
      .map((warning) => `- ${warning}`)
      .join("\n")}\nSet persistent paths before deploying, or set TELEKA_ALLOW_EPHEMERAL_STORAGE=true only if you intentionally accept data loss.`
  );
}

function toStoredUploadPath(filePath) {
  if (!filePath) {
    return null;
  }

  const absolutePath = path.resolve(filePath);
  const relativeToUploadRoot = path.relative(uploadRoot, absolutePath);
  if (
    relativeToUploadRoot &&
    relativeToUploadRoot !== "" &&
    !relativeToUploadRoot.startsWith("..") &&
    !path.isAbsolute(relativeToUploadRoot)
  ) {
    return relativeToUploadRoot.replaceAll("\\", "/");
  }

  return absolutePath;
}

function resolveStoredUploadPath(storedPath) {
  if (!storedPath) {
    return "";
  }

  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }

  const uploadCandidate = path.join(uploadRoot, storedPath);
  if (fs.existsSync(uploadCandidate)) {
    return uploadCandidate;
  }

  return path.join(projectRoot, storedPath);
}

export const config = {
  environment,
  isProduction,
  projectRoot,
  dataRoot,
  appUrl,
  port: Number(process.env.PORT || 3000),
  dbPath,
  sessionDir,
  sessionDbPath,
  uploadRoot,
  allowEphemeralStorage,
  persistenceWarnings,
  persistenceReady: persistenceWarnings.length === 0,
  toStoredUploadPath,
  resolveStoredUploadPath,
  authSecret: process.env.AUTH_SECRET || "teleka-dev-secret",
  adminEmail: process.env.ADMIN_EMAIL || "admin@example.com",
  adminPassword: process.env.ADMIN_PASSWORD || "change-me",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  sessionTtlDays: 30,
  retentionDays: Number(process.env.TELEKA_RETENTION_DAYS || 180),
  email: {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: String(process.env.EMAIL_SECURE).toLowerCase() === "true",
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM,
    notifyTo: process.env.EMAIL_TO
      ? process.env.EMAIL_TO.split(",").map((item) => item.trim()).filter(Boolean)
      : []
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM,
    defaultTo: process.env.WHATSAPP_TO
  },
  cookieDomain
};
