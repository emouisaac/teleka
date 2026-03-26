import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import express from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";

import { config } from "../config.js";
import { database, nowIso } from "../db.js";
import {
  createNotification,
  listNotifications,
  markNotificationRead
} from "../services/notifications.js";
import { sendOutboundNotice } from "../services/outbound.js";
import {
  apiError,
  destroySession,
  getAdminProfile,
  getCustomerProfile,
  getDriverProfile,
  getSessionUser,
  setSessionUser
} from "./helpers.js";

const googleClient = config.googleClientId
  ? new OAuth2Client(config.googleClientId)
  : null;

const uploadDirectory = path.join(config.uploadRoot, "driver-applications");
fs.mkdirSync(uploadDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, file, callback) => {
      const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      callback(null, `${suffix}-${safeName}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

function sanitizeAdmin(admin) {
  return {
    id: admin.id,
    email: admin.email,
    lastLoginAt: admin.lastLoginAt || null
  };
}

function sanitizeCustomer(customer) {
  return customer ? { ...customer } : null;
}

function sanitizeDriver(driver) {
  return driver
    ? {
        ...driver,
        isOnline: Boolean(driver.isOnline)
      }
    : null;
}

function getCurrentProfile(user) {
  if (!user) {
    return null;
  }
  if (user.role === "admin") {
    return sanitizeAdmin(getAdminProfile());
  }
  if (user.role === "customer") {
    return sanitizeCustomer(getCustomerProfile(user.id));
  }
  if (user.role === "driver") {
    return sanitizeDriver(getDriverProfile(user.id));
  }
  return null;
}

export function createAuthRouter() {
  const router = express.Router();

  router.get("/status", (req, res) => {
    const current = getSessionUser(req);
    if (!current) {
      res.json({ authenticated: false });
      return;
    }

    res.json({
      authenticated: true,
      user: {
        role: current.role,
        ...getCurrentProfile(current)
      }
    });
  });

  router.post("/admin/login", async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        throw apiError(400, "Email and password are required");
      }

      const admin = database
        .prepare(
          `
            SELECT id, email, password_hash AS passwordHash
            FROM admins
            WHERE email = ?
          `
        )
        .get(email.trim().toLowerCase());

      if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
        throw apiError(401, "Invalid admin credentials");
      }

      database
        .prepare("UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso(), nowIso(), admin.id);

      await setSessionUser(req, { id: admin.id, role: "admin" });

      res.json({
        success: true,
        user: {
          role: "admin",
          ...sanitizeAdmin(getAdminProfile())
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/google", async (req, res, next) => {
    try {
      if (!googleClient) {
        throw apiError(503, "Google sign-in is not configured");
      }

      const { credential } = req.body;
      if (!credential) {
        throw apiError(400, "Google credential is required");
      }

      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: config.googleClientId
      });
      const payload = ticket.getPayload();

      if (!payload?.sub || !payload?.email || !payload?.name) {
        throw apiError(401, "Invalid Google account data");
      }

      const customerId = `cust-${payload.sub}`;
      const timestamp = nowIso();
      database
        .prepare(
          `
            INSERT INTO customers (
              id, google_sub, email, full_name, avatar_url, created_at, updated_at, last_login_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(google_sub) DO UPDATE SET
              email = excluded.email,
              full_name = excluded.full_name,
              avatar_url = excluded.avatar_url,
              updated_at = excluded.updated_at,
              last_login_at = excluded.last_login_at
          `
        )
        .run(
          customerId,
          payload.sub,
          payload.email.toLowerCase(),
          payload.name,
          payload.picture || null,
          timestamp,
          timestamp,
          timestamp
        );

      await setSessionUser(req, { id: customerId, role: "customer" });

      res.json({
        success: true,
        user: {
          role: "customer",
          ...sanitizeCustomer(getCustomerProfile(customerId))
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/driver/register",
    upload.fields([
      { name: "facePhoto", maxCount: 1 },
      { name: "carPhoto", maxCount: 1 },
      { name: "documents", maxCount: 6 }
    ]),
    async (req, res, next) => {
      try {
        const {
          fullName,
          email,
          phone,
          password,
          vehicle,
          plateNumber,
          licenseNumber,
          nationalIdNumber,
          insuranceNumber
        } = req.body;

        if (
          !fullName ||
          !email ||
          !phone ||
          !password ||
          !vehicle ||
          !plateNumber ||
          !licenseNumber ||
          !nationalIdNumber ||
          !insuranceNumber
        ) {
          throw apiError(400, "All driver registration fields are required");
        }

        const existing = database
          .prepare("SELECT id FROM drivers WHERE email = ? OR plate_number = ?")
          .get(email.trim().toLowerCase(), plateNumber.trim().toUpperCase());

        if (existing) {
          throw apiError(409, "A driver with this email or plate number already exists");
        }

        const driverId = randomUUID();
        const timestamp = nowIso();
        const facePhoto = req.files?.facePhoto?.[0] || null;
        const carPhoto = req.files?.carPhoto?.[0] || null;
        const documents = req.files?.documents || [];

        database
          .prepare(
            `
              INSERT INTO drivers (
                id, full_name, email, phone, password_hash, vehicle, plate_number,
                license_number, national_id_number, insurance_number, face_photo_path,
                car_photo_path, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            driverId,
            fullName.trim(),
            email.trim().toLowerCase(),
            phone.trim(),
            await bcrypt.hash(password, 10),
            vehicle.trim(),
            plateNumber.trim().toUpperCase(),
            licenseNumber.trim(),
            nationalIdNumber.trim(),
            insuranceNumber.trim(),
            facePhoto ? path.relative(config.projectRoot, facePhoto.path) : null,
            carPhoto ? path.relative(config.projectRoot, carPhoto.path) : null,
            timestamp,
            timestamp
          );

        const insertDocument = database.prepare(
          `
            INSERT INTO driver_documents (id, driver_id, original_name, stored_name, file_path, mime_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
        );

        for (const asset of [facePhoto, carPhoto].filter(Boolean)) {
          insertDocument.run(
            randomUUID(),
            driverId,
            asset.originalname,
            asset.filename,
            path.relative(config.projectRoot, asset.path),
            asset.mimetype,
            timestamp
          );
        }

        for (const document of documents) {
          insertDocument.run(
            randomUUID(),
            driverId,
            document.originalname,
            document.filename,
            path.relative(config.projectRoot, document.path),
            document.mimetype,
            timestamp
          );
        }

        const realtime = req.app.locals.realtime;
        createNotification(realtime, {
          targetRole: "admin",
          targetId: "admin-root",
          category: "driver_application",
          title: "New driver application",
          message: `${fullName.trim()} submitted a driver registration`,
          metadata: { driverId }
        });

        await sendOutboundNotice({
          email: config.email.notifyTo[0],
          subject: "New Teleka driver application",
          message: `${fullName.trim()} submitted a driver application for approval.`
        });

        res.status(201).json({
          success: true,
          message: "Driver registration submitted for admin review"
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/driver/login", async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        throw apiError(400, "Email and password are required");
      }

      const driver = database
        .prepare(
          `
            SELECT id, password_hash AS passwordHash, approval_status AS approvalStatus
            FROM drivers
            WHERE email = ?
          `
        )
        .get(email.trim().toLowerCase());

      if (!driver || !(await bcrypt.compare(password, driver.passwordHash))) {
        throw apiError(401, "Invalid driver credentials");
      }

      if (driver.approvalStatus !== "approved") {
        throw apiError(403, `Driver account is ${driver.approvalStatus}`);
      }

      database
        .prepare("UPDATE drivers SET last_login_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso(), nowIso(), driver.id);

      await setSessionUser(req, { id: driver.id, role: "driver" });

      res.json({
        success: true,
        user: {
          role: "driver",
          ...sanitizeDriver(getDriverProfile(driver.id))
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      await destroySession(req);
      res.clearCookie("teleka.sid");
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/notifications", (req, res, next) => {
    try {
      const current = getSessionUser(req);
      if (!current) {
        throw apiError(401, "Authentication required");
      }
      res.json({
        notifications: listNotifications(current.role, current.id)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/notifications/:id/read", (req, res, next) => {
    try {
      const current = getSessionUser(req);
      if (!current) {
        throw apiError(401, "Authentication required");
      }
      markNotificationRead(current.role, current.id, req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
