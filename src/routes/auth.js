import { randomUUID } from "node:crypto";

import express from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";

import { config } from "../config.js";
import { database, nowIso } from "../db.js";
import { removeFiles, uploadFile } from "../storage.js";
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

const upload = multer({
  storage: multer.memoryStorage(),
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

async function getCurrentProfile(user) {
  if (!user) {
    return null;
  }
  if (user.role === "admin") {
    return sanitizeAdmin(await getAdminProfile());
  }
  if (user.role === "customer") {
    return sanitizeCustomer(await getCustomerProfile(user.id));
  }
  if (user.role === "driver") {
    return sanitizeDriver(await getDriverProfile(user.id));
  }
  return null;
}

export function createAuthRouter() {
  const router = express.Router();

  router.get("/status", async (req, res, next) => {
    try {
      const current = getSessionUser(req);
      if (!current) {
        res.json({ authenticated: false });
        return;
      }

      res.json({
        authenticated: true,
        user: {
          role: current.role,
          ...(await getCurrentProfile(current))
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/login", async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        throw apiError(400, "Email and password are required");
      }

      const admin = await database
        .prepare(
          `
            SELECT id, email, password_hash AS "passwordHash"
            FROM admins
            WHERE email = ?
          `
        )
        .get(email.trim().toLowerCase());

      if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
        throw apiError(401, "Invalid admin credentials");
      }

      await database
        .prepare("UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso(), nowIso(), admin.id);

      await setSessionUser(req, { id: admin.id, role: "admin" });

      res.json({
        success: true,
        user: {
          role: "admin",
          ...sanitizeAdmin(await getAdminProfile())
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
      await database
        .prepare(
          `
            INSERT INTO customers (
              id, google_sub, email, full_name, avatar_url, created_at, updated_at, last_login_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(google_sub) DO UPDATE SET
              email = EXCLUDED.email,
              full_name = EXCLUDED.full_name,
              avatar_url = EXCLUDED.avatar_url,
              updated_at = EXCLUDED.updated_at,
              last_login_at = EXCLUDED.last_login_at
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
          ...sanitizeCustomer(await getCustomerProfile(customerId))
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

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedPlate = plateNumber.trim().toUpperCase();
        const existing = await database
          .prepare("SELECT id FROM drivers WHERE email = ? OR plate_number = ?")
          .get(normalizedEmail, normalizedPlate);

        if (existing) {
          throw apiError(409, "A driver with this email or plate number already exists");
        }

        const driverId = randomUUID();
        const timestamp = nowIso();
        const facePhoto = req.files?.facePhoto?.[0] || null;
        const carPhoto = req.files?.carPhoto?.[0] || null;
        const documents = req.files?.documents || [];
        const passwordHash = await bcrypt.hash(password, 10);
        const uploadedObjects = [];

        const uploadAsset = async (file, folder) => {
          if (!file) {
            return null;
          }

          const uploaded = await uploadFile({ folder, file });
          uploadedObjects.push(uploaded.objectPath);
          return uploaded;
        };

        const baseFolder = `driver-applications/${driverId}`;
        const uploadedFacePhoto = await uploadAsset(facePhoto, `${baseFolder}/face-photo`);
        const uploadedCarPhoto = await uploadAsset(carPhoto, `${baseFolder}/car-photo`);
        const uploadedDocuments = [];

        for (const document of documents) {
          uploadedDocuments.push(
            await uploadAsset(document, `${baseFolder}/documents`)
          );
        }

        try {
          await database.withTransaction(async (tx) => {
            await tx
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
                normalizedEmail,
                phone.trim(),
                passwordHash,
                vehicle.trim(),
                normalizedPlate,
                licenseNumber.trim(),
                nationalIdNumber.trim(),
                insuranceNumber.trim(),
                uploadedFacePhoto?.objectPath || null,
                uploadedCarPhoto?.objectPath || null,
                timestamp,
                timestamp
              );

            const insertDocument = tx.prepare(
              `
                INSERT INTO driver_documents (id, driver_id, original_name, stored_name, file_path, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `
            );

            for (const asset of [uploadedFacePhoto, uploadedCarPhoto].filter(Boolean)) {
              await insertDocument.run(
                randomUUID(),
                driverId,
                asset.originalName,
                asset.storedName,
                asset.objectPath,
                asset.mimeType,
                timestamp
              );
            }

            for (const document of uploadedDocuments) {
              await insertDocument.run(
                randomUUID(),
                driverId,
                document.originalName,
                document.storedName,
                document.objectPath,
                document.mimeType,
                timestamp
              );
            }
          });
        } catch (error) {
          await removeFiles(uploadedObjects);
          throw error;
        }

        const realtime = req.app.locals.realtime;
        await createNotification(realtime, {
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

      const driver = await database
        .prepare(
          `
            SELECT id, password_hash AS "passwordHash", approval_status AS "approvalStatus"
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

      await database
        .prepare("UPDATE drivers SET last_login_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso(), nowIso(), driver.id);

      await setSessionUser(req, { id: driver.id, role: "driver" });

      res.json({
        success: true,
        user: {
          role: "driver",
          ...sanitizeDriver(await getDriverProfile(driver.id))
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

  router.get("/notifications", async (req, res, next) => {
    try {
      const current = getSessionUser(req);
      if (!current) {
        throw apiError(401, "Authentication required");
      }
      res.json({
        notifications: await listNotifications(current.role, current.id)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/notifications/:id/read", async (req, res, next) => {
    try {
      const current = getSessionUser(req);
      if (!current) {
        throw apiError(401, "Authentication required");
      }
      await markNotificationRead(current.role, current.id, req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
