import http from "node:http";
import path from "node:path";
import express from "express";
import session from "express-session";
import compression from "compression";
import helmet from "helmet";

import { config } from "./src/config.js";
import { initializeDatabase, sessionDatabase } from "./src/db.js";
import { SQLiteSessionStore } from "./src/session-store.js";
import { createRealtimeServer } from "./src/realtime.js";
import { createAuthRouter } from "./src/routes/auth.js";
import { createPublicRouter } from "./src/routes/public.js";
import { createCustomerRouter } from "./src/routes/customer.js";
import { createAdminRouter } from "./src/routes/admin.js";
import { createDriverRouter } from "./src/routes/driver.js";

initializeDatabase();

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const sessionStore = new SQLiteSessionStore({
  db: sessionDatabase,
  ttlDays: config.sessionTtlDays
});

const sessionMiddleware = session({
  store: sessionStore,
  name: "teleka.sid",
  secret: config.authSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
    domain: config.cookieDomain
  }
});

app.use(sessionMiddleware);

const realtime = createRealtimeServer(server, sessionMiddleware);
app.locals.realtime = realtime;

app.use("/ims", express.static(path.join(config.projectRoot, "ims")));
app.use("/js", express.static(path.join(config.projectRoot, "js")));
app.use("/api/auth", createAuthRouter());
app.use("/api/public", createPublicRouter());
app.use("/api/customer", createCustomerRouter());
app.use("/api/admin", createAdminRouter());
app.use("/api/driver", createDriverRouter());

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    env: config.environment,
    dbPath: config.dbPath,
    sessionDbPath: config.sessionDbPath
  });
});

app.use(express.static(config.projectRoot, { extensions: ["html"] }));

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(config.projectRoot, "admin.html"));
});

app.get("/driver", (_req, res) => {
  res.sendFile(path.join(config.projectRoot, "driver.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    error: err.publicMessage || "Internal server error"
  });
});

server.listen(config.port, () => {
  console.log(`Teleka listening on ${config.appUrl}`);
});
