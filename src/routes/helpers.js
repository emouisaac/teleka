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

export function setSessionUser(req, user) {
  req.session.user = user;
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

export function getAdminProfile() {
  return database
    .prepare(
      `
        SELECT id, email, last_login_at AS lastLoginAt
        FROM admins
        WHERE id = 'admin-root'
      `
    )
    .get();
}

export function getCustomerProfile(customerId) {
  return database
    .prepare(
      `
        SELECT id, email, full_name AS fullName, avatar_url AS avatarUrl,
               phone, preferred_payment_method AS preferredPaymentMethod,
               last_login_at AS lastLoginAt
        FROM customers
        WHERE id = ?
      `
    )
    .get(customerId);
}

export function getDriverProfile(driverId) {
  return database
    .prepare(
      `
        SELECT id, full_name AS fullName, email, phone, vehicle, plate_number AS plateNumber,
               license_number AS licenseNumber, national_id_number AS nationalIdNumber,
               insurance_number AS insuranceNumber, approval_status AS approvalStatus,
               approval_notes AS approvalNotes, is_online AS isOnline, current_lat AS currentLat,
               current_lng AS currentLng, current_heading AS currentHeading,
               face_photo_path AS facePhotoPath, car_photo_path AS carPhotoPath,
               last_location_at AS lastLocationAt, created_at AS createdAt, last_login_at AS lastLoginAt
        FROM drivers
        WHERE id = ?
      `
    )
    .get(driverId);
}
