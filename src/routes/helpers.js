import { config, getSessionTtlMsForRole } from "../config.js";
import { database } from "../db.js";

export function apiError(statusCode, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

export function requireRole(role) {
  return (req, _res, next) => {
    const current = req.session?.user;
    if (!current || current.role !== role) {
      next(apiError(401, "Authentication required"));
      return;
    }
    next();
  };
}

export function getSessionUser(req) {
  return req.session?.user || null;
}

export function applySessionLifetime(req, role = req.session?.user?.role) {
  if (!req.session || !role) {
    return config.sessionTtlMs;
  }

  const ttlMs = getSessionTtlMsForRole(role);
  req.session.cookie.maxAge = ttlMs;
  return ttlMs;
}

export function setSessionUser(req, user) {
  req.session.user = user;
  applySessionLifetime(req, user.role);
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function refreshSession(req) {
  applySessionLifetime(req);
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function getAdminProfile() {
  return database
    .prepare(
      `
        SELECT id, email, last_login_at AS "lastLoginAt"
        FROM admins
        WHERE id = 'admin-root'
      `
    )
    .get();
}

export async function getCustomerProfile(customerId) {
  return database
    .prepare(
      `
        SELECT id, email, full_name AS "fullName", avatar_url AS "avatarUrl",
               phone, preferred_payment_method AS "preferredPaymentMethod",
               last_login_at AS "lastLoginAt"
        FROM customers
        WHERE id = ?
      `
    )
    .get(customerId);
}

export async function getDriverProfile(driverId) {
  const driver = await database
    .prepare(
      `
        SELECT id, full_name AS "fullName", email, phone, vehicle, plate_number AS "plateNumber",
               license_number AS "licenseNumber", national_id_number AS "nationalIdNumber",
               insurance_number AS "insuranceNumber", approval_status AS "approvalStatus",
               approval_notes AS "approvalNotes", is_online AS "isOnline", current_lat AS "currentLat",
               current_lng AS "currentLng", current_heading AS "currentHeading",
               face_photo_path AS "facePhotoPath", car_photo_path AS "carPhotoPath",
               last_location_at AS "lastLocationAt", created_at AS "createdAt", last_login_at AS "lastLoginAt"
        FROM drivers
        WHERE id = ?
      `
    )
    .get(driverId);

  return driver
    ? {
        ...driver,
        isOnline: Boolean(driver.isOnline)
      }
    : null;
}
