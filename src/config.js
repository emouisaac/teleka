import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const projectRoot = process.cwd();
const runtimePlatform = process.env.TELEKA_RUNTIME_PLATFORM || process.platform;
const environment = process.env.NODE_ENV || "development";
const isProduction = environment === "production";
const allowEphemeralStorage = String(process.env.TELEKA_ALLOW_EPHEMERAL_STORAGE || "").toLowerCase() === "true";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const invalidStorageEnvWarnings = [];

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

function isWindowsAbsolutePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function isCompatibleAbsolutePath(value) {
  if (!value) {
    return false;
  }

  if (runtimePlatform === "win32") {
    return isWindowsAbsolutePath(value);
  }

  return value.startsWith("/");
}

function getStorageEnvValue(name) {
  const rawValue = String(process.env[name] || "").trim();
  if (!rawValue) {
    return "";
  }

  if (!isCompatibleAbsolutePath(rawValue)) {
    invalidStorageEnvWarnings.push(
      `Ignoring ${name}=${rawValue} because it is not a valid absolute path on ${runtimePlatform}.`
    );
    return "";
  }

  return rawValue;
}

function resolveStoragePath(inputPath, fallbackPath) {
  const value = inputPath || fallbackPath;
  if (!value) {
    return "";
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

function isWithinPath(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isLocalHostname(hostname) {
  return !hostname || LOCAL_HOSTNAMES.has(String(hostname).trim().toLowerCase());
}

function firstNonEmptyValue(candidates) {
  return candidates.find((candidate) => String(candidate || "").trim());
}

function firstExistingDirectory(candidates) {
  return candidates.find((candidate) => {
    const value = String(candidate || "").trim();
    return value && fs.existsSync(value);
  });
}

function readPositiveInteger(name, fallbackValue) {
  const parsed = Number(process.env[name] || fallbackValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.floor(parsed);
}

function detectHostingProvider() {
  if (process.env.RENDER === "true" || process.env.RENDER_SERVICE_ID) {
    return "render";
  }
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
    return "railway";
  }
  if (process.env.FLY_APP_NAME || process.env.FLY_REGION || process.env.FLY_ALLOC_ID) {
    return "fly";
  }
  if (process.env.VERCEL === "1" || process.env.VERCEL_URL) {
    return "vercel";
  }
  if (process.env.HEROKU_APP_NAME || process.env.DYNO) {
    return "heroku";
  }
  if (process.env.KOYEB_APP_NAME || process.env.KOYEB_PUBLIC_DOMAIN) {
    return "koyeb";
  }
  if (process.env.NORTHFLANK_PROJECT_ID || process.env.NORTHFLANK_SERVICE_ID) {
    return "northflank";
  }
  return "";
}

const appUrl =
  normalizeUrl(process.env.APP_URL) ||
  normalizeUrl(process.env.RENDER_EXTERNAL_URL) ||
  `http://localhost:${process.env.PORT || 3000}`;
const appHostname = extractHostname(appUrl);
const domainHostname =
  extractHostname(process.env.APP_DOMAIN) || extractHostname(process.env.RENDER_EXTERNAL_HOSTNAME);
const hostingProvider = detectHostingProvider();
const hostedDeployment =
  isProduction ||
  Boolean(hostingProvider) ||
  (Boolean(process.env.APP_URL) && !isLocalHostname(appHostname)) ||
  (Boolean(process.env.APP_DOMAIN) && !isLocalHostname(domainHostname) && Boolean(hostingProvider));

const detectedMountedDataRoot = firstExistingDirectory([
  runtimePlatform !== "win32" ? "/var/data" : "",
  runtimePlatform !== "win32" ? "/data" : "",
  runtimePlatform !== "win32" ? "/storage" : ""
]);

const inferredPlatformDataRoot = firstNonEmptyValue([
  process.env.TELEKA_PLATFORM_DATA_DIR,
  detectedMountedDataRoot,
  process.env.RENDER_DISK_MOUNT_PATH && path.join(process.env.RENDER_DISK_MOUNT_PATH, "teleka"),
  process.env.RAILWAY_VOLUME_MOUNT_PATH && path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "teleka"),
  process.env.FLY_VOLUME_DIR && path.join(process.env.FLY_VOLUME_DIR, "teleka"),
  process.env.PERSISTENT_STORAGE_DIR && path.join(process.env.PERSISTENT_STORAGE_DIR, "teleka"),
  process.env.STORAGE_DIR && path.join(process.env.STORAGE_DIR, "teleka"),
  process.env.DATA_DIR && path.join(process.env.DATA_DIR, "teleka")
]);
const configuredDataDir = getStorageEnvValue("TELEKA_DATA_DIR");
const configuredDbPath = getStorageEnvValue("TELEKA_DB_PATH");
const configuredSessionsDir = getStorageEnvValue("TELEKA_SESSIONS_DIR");
const configuredUploadRoot = getStorageEnvValue("TELEKA_UPLOAD_ROOT");

const dataRoot = resolveStoragePath(
  configuredDataDir,
  inferredPlatformDataRoot || path.join(projectRoot, "data")
);
const defaultDbPath = path.join(dataRoot, "teleka.sqlite");
const dbPath = resolveStoragePath(configuredDbPath, defaultDbPath);
const sessionDir = resolveStoragePath(
  configuredSessionsDir,
  path.join(dataRoot, "sessions")
);
const sessionDbName = process.env.TELEKA_SESSIONS_DB || "sessions.sqlite";
const sessionDbPath = path.join(sessionDir, sessionDbName);
const uploadRoot = resolveStoragePath(
  configuredUploadRoot,
  path.join(dataRoot, "uploads")
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(uploadRoot, { recursive: true });

const rawCookieDomain = domainHostname || appHostname;
const cookieDomain =
  isProduction && rawCookieDomain && !rawCookieDomain.includes("localhost")
    ? rawCookieDomain.replace(/^www\./, "")
    : undefined;

const configWarnings = [...invalidStorageEnvWarnings];
const persistenceWarnings = [];
const storageTargets = [
  ["database", dbPath],
  ["session database", sessionDbPath],
  ["upload storage", uploadRoot]
];
const hasExplicitPersistentStorageEnv =
  Boolean(configuredDataDir) ||
  Boolean(configuredDbPath) ||
  Boolean(configuredSessionsDir) ||
  Boolean(configuredUploadRoot);
const storageMode = hasExplicitPersistentStorageEnv
  ? "explicit"
  : inferredPlatformDataRoot
    ? "platform-volume"
    : "project-local";

if (hostedDeployment) {
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

  if (!hasExplicitPersistentStorageEnv && !inferredPlatformDataRoot) {
    persistenceWarnings.push(
      "No persistent storage location was detected. Set TELEKA_DATA_DIR or TELEKA_DB_PATH, TELEKA_SESSIONS_DIR, and TELEKA_UPLOAD_ROOT to a mounted persistent disk."
    );
  }
}

if (hostedDeployment && persistenceWarnings.length && !allowEphemeralStorage) {
  throw new Error(
    `Unsafe hosted persistence configuration.\n${persistenceWarnings
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
  hostedDeployment,
  hostingProvider,
  projectRoot,
  dataRoot,
  appUrl,
  port: Number(process.env.PORT || 3000),
  dbPath,
  sessionDir,
  sessionDbPath,
  uploadRoot,
  storageMode,
  allowEphemeralStorage,
  configWarnings,
  persistenceWarnings,
  persistenceReady: persistenceWarnings.length === 0,
  toStoredUploadPath,
  resolveStoredUploadPath,
  authSecret: process.env.AUTH_SECRET || "teleka-dev-secret",
  adminEmail: process.env.ADMIN_EMAIL || "admin@example.com",
  adminPassword: process.env.ADMIN_PASSWORD || "change-me",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  sessionTtlDays: readPositiveInteger("TELEKA_SESSION_TTL_DAYS", 3650),
  retentionDays: readPositiveInteger("TELEKA_RETENTION_DAYS", 180),
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
