import { createHash, randomUUID } from "node:crypto";

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

function normalizeDriverIdentifier(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function hashUploadedFile(file) {
  return createHash("sha256").update(file.buffer).digest("hex");
}

function getDocumentTypeLabel(documentType) {
  const labels = {
    face_photo: "face photo",
    car_photo: "car photo",
    supporting_document: "supporting document"
  };

  return labels[documentType] || "document";
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
        const normalizedPlate = normalizeDriverIdentifier(plateNumber);
        const normalizedLicenseNumber = normalizeDriverIdentifier(licenseNumber);
        const normalizedNationalIdNumber = normalizeDriverIdentifier(nationalIdNumber);
        const normalizedInsuranceNumber = normalizeDriverIdentifier(insuranceNumber);
        const facePhoto = req.files?.facePhoto?.[0] || null;
        const carPhoto = req.files?.carPhoto?.[0] || null;
        const documents = req.files?.documents || [];

        if (!facePhoto) {
          throw apiError(400, "A live face photo captured with the camera is required");
        }

        const existingIdentity = await database
          .prepare(
            `
              SELECT id, email, plate_number AS "plateNumber", license_number AS "licenseNumber",
                     national_id_number AS "nationalIdNumber", insurance_number AS "insuranceNumber"
              FROM drivers
              WHERE email = ?
                 OR plate_number = ?
                 OR license_number = ?
                 OR national_id_number = ?
                 OR insurance_number = ?
              LIMIT 1
            `
          )
          .get(
            normalizedEmail,
            normalizedPlate,
            normalizedLicenseNumber,
            normalizedNationalIdNumber,
            normalizedInsuranceNumber
          );

        if (existingIdentity) {
          if (existingIdentity.email === normalizedEmail) {
            throw apiError(409, "This email is already registered");
          }
          if (existingIdentity.plateNumber === normalizedPlate) {
            throw apiError(409, "This vehicle number plate is already registered");
          }
          if (existingIdentity.licenseNumber === normalizedLicenseNumber) {
            throw apiError(409, "This driving licence number is already registered");
          }
          if (existingIdentity.nationalIdNumber === normalizedNationalIdNumber) {
            throw apiError(409, "This national ID number is already registered");
          }
          if (existingIdentity.insuranceNumber === normalizedInsuranceNumber) {
            throw apiError(409, "This third-party insurance number is already registered");
          }
        }

        const driverId = randomUUID();
        const timestamp = nowIso();
        const passwordHash = await bcrypt.hash(password, 10);
        const uploadedObjects = [];

        const uploadedAssets = [
          { file: facePhoto, documentType: "face_photo", label: "face photo" },
          ...(carPhoto ? [{ file: carPhoto, documentType: "car_photo", label: "car photo" }] : []),
          ...documents.map((file, index) => ({
            file,
            documentType: "supporting_document",
            label: `supporting document ${index + 1}`
          }))
        ].map((entry) => ({
          ...entry,
          fileHash: hashUploadedFile(entry.file)
        }));

        const seenHashes = new Set();
        for (const asset of uploadedAssets) {
          if (seenHashes.has(asset.fileHash)) {
            throw apiError(409, `The same file was uploaded more than once for ${asset.label}`);
          }
          seenHashes.add(asset.fileHash);
        }

        const duplicateDocument = uploadedAssets.length
          ? await database
              .prepare(
                `
                  SELECT driver_id AS "driverId", document_type AS "documentType"
                  FROM driver_documents
                  WHERE file_hash = ANY(?)
                  LIMIT 1
                `
              )
              .get(uploadedAssets.map((asset) => asset.fileHash))
          : null;

        if (duplicateDocument) {
          throw apiError(
            409,
            `This ${getDocumentTypeLabel(duplicateDocument.documentType)} is already in use by another account`
          );
        }

        const uploadAsset = async (file, folder, documentType, fileHash) => {
          if (!file) {
            return null;
          }

          const uploaded = await uploadFile({ folder, file });
          uploadedObjects.push(uploaded.objectPath);
          return {
            ...uploaded,
            documentType,
            fileHash
          };
        };

        const baseFolder = `driver-applications/${driverId}`;
        const uploadedFacePhoto = await uploadAsset(
          facePhoto,
          `${baseFolder}/face-photo`,
          "face_photo",
          uploadedAssets.find((asset) => asset.documentType === "face_photo")?.fileHash || null
        );
        const uploadedCarPhoto = await uploadAsset(
          carPhoto,
          `${baseFolder}/car-photo`,
          "car_photo",
          uploadedAssets.find((asset) => asset.documentType === "car_photo")?.fileHash || null
        );
        const uploadedDocuments = [];

        for (const document of documents) {
          const fileHash = uploadedAssets.find(
            (asset) => asset.file === document && asset.documentType === "supporting_document"
          )?.fileHash;
          uploadedDocuments.push(
            await uploadAsset(document, `${baseFolder}/documents`, "supporting_document", fileHash)
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
                normalizedLicenseNumber,
                normalizedNationalIdNumber,
                normalizedInsuranceNumber,
                uploadedFacePhoto?.objectPath || null,
                uploadedCarPhoto?.objectPath || null,
                timestamp,
                timestamp
              );

            const insertDocument = tx.prepare(
              `
                INSERT INTO driver_documents (
                  id, driver_id, document_type, original_name, stored_name, file_path, file_hash, mime_type, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `
            );

            for (const asset of [uploadedFacePhoto, uploadedCarPhoto].filter(Boolean)) {
              await insertDocument.run(
                randomUUID(),
                driverId,
                asset.documentType,
                asset.originalName,
                asset.storedName,
                asset.objectPath,
                asset.fileHash,
                asset.mimeType,
                timestamp
              );
            }

            for (const document of uploadedDocuments) {
              await insertDocument.run(
                randomUUID(),
                driverId,
                document.documentType,
                document.originalName,
                document.storedName,
                document.objectPath,
                document.fileHash,
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
        if (error?.code === "23505") {
          const details = `${error.constraint || ""} ${error.detail || ""}`.toLowerCase();
          if (details.includes("email")) {
            next(apiError(409, "This email is already registered"));
            return;
          }
          if (details.includes("plate")) {
            next(apiError(409, "This vehicle number plate is already registered"));
            return;
          }
          if (details.includes("license")) {
            next(apiError(409, "This driving licence number is already registered"));
            return;
          }
          if (details.includes("national")) {
            next(apiError(409, "This national ID number is already registered"));
            return;
          }
          if (details.includes("insurance")) {
            next(apiError(409, "This third-party insurance number is already registered"));
            return;
          }
          if (details.includes("driver_documents_hash")) {
            next(apiError(409, "One of the uploaded documents is already in use by another account"));
            return;
          }
        }
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
        throw apiError(
          403,
          driver.approvalStatus === "pending"
            ? "Driver account is pending approval"
            : "Driver account is not approved yet"
        );
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
