import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const projectRoot = process.cwd();
const environment = process.env.NODE_ENV || "development";
const isProduction = environment === "production";

const defaultDbPath = path.join(projectRoot, "data", "teleka.sqlite");
const dbPath = process.env.TELEKA_DB_PATH || defaultDbPath;
const sessionDir =
  process.env.TELEKA_SESSIONS_DIR || path.join(projectRoot, "data", "sessions");
const sessionDbName = process.env.TELEKA_SESSIONS_DB || "sessions.sqlite";
const sessionDbPath = path.join(sessionDir, sessionDbName);
const uploadRoot = path.join(projectRoot, "data", "uploads");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(uploadRoot, { recursive: true });

const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const cookieDomain =
  isProduction && process.env.APP_DOMAIN && !process.env.APP_DOMAIN.includes("localhost")
    ? process.env.APP_DOMAIN.replace(/^www\./, "")
    : undefined;

export const config = {
  environment,
  isProduction,
  projectRoot,
  appUrl,
  port: Number(process.env.PORT || 3000),
  dbPath,
  sessionDir,
  sessionDbPath,
  uploadRoot,
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
