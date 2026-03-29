import dotenv from "dotenv";

dotenv.config();

const projectRoot = process.cwd();
const environment = process.env.NODE_ENV || "development";
const isProduction = environment === "production";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

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

function isLocalHostname(hostname) {
  return !hostname || LOCAL_HOSTNAMES.has(String(hostname).trim().toLowerCase());
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

const databaseUrl = normalizeUrl(process.env.DATABASE_URL);
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required and must be a valid Postgres connection string.");
}

const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL);
if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required and must be a valid URL.");
}

const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!supabaseServiceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for upload storage.");
}

const supabaseUploadBucket = String(process.env.SUPABASE_UPLOAD_BUCKET || "teleka-uploads").trim();
if (!supabaseUploadBucket) {
  throw new Error("SUPABASE_UPLOAD_BUCKET must not be empty.");
}

const databaseHost = extractHostname(databaseUrl);
const rawDatabaseSsl = String(
  process.env.DATABASE_SSL ||
    process.env.PGSSLMODE ||
    (databaseHost && !isLocalHostname(databaseHost) ? "true" : "false")
).toLowerCase();
const databaseSsl = rawDatabaseSsl === "true" || rawDatabaseSsl === "require";

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

const dataRoot = `postgres://${databaseHost}`;
const uploadRoot = `supabase://${supabaseUploadBucket}`;

const rawCookieDomain = domainHostname || appHostname;
const cookieDomain =
  isProduction && rawCookieDomain && !rawCookieDomain.includes("localhost")
    ? rawCookieDomain.replace(/^www\./, "")
    : undefined;

const configWarnings = [];
const persistenceWarnings = [];
const storageMode = "supabase-storage";

export const config = {
  environment,
  isProduction,
  hostedDeployment,
  hostingProvider,
  projectRoot,
  dataRoot,
  appUrl,
  port: Number(process.env.PORT || 3000),
  databaseUrl,
  databaseHost,
  databaseSsl,
  supabaseUrl,
  supabaseServiceRoleKey,
  supabaseUploadBucket,
  uploadRoot,
  storageMode,
  configWarnings,
  persistenceWarnings,
  persistenceReady: persistenceWarnings.length === 0,
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
