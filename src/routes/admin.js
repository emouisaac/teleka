import path from "node:path";

import express from "express";

import { database, getSettings, nowIso, setSetting } from "../db.js";
import { createNotification } from "../services/notifications.js";
import { sendOutboundNotice } from "../services/outbound.js";
import { emitRideSnapshot } from "../services/rides.js";
import { apiError, requireRole } from "./helpers.js";

function getAdminDashboard() {
  const summary = {
    customers: database.prepare("SELECT COUNT(*) AS value FROM customers").get().value,
    drivers: database.prepare("SELECT COUNT(*) AS value FROM drivers").get().value,
    approvedDrivers: database
      .prepare("SELECT COUNT(*) AS value FROM drivers WHERE approval_status = 'approved'")
      .get().value,
    driversOnline: database
      .prepare("SELECT COUNT(*) AS value FROM drivers WHERE approval_status = 'approved' AND is_online = 1")
      .get().value,
    pendingRides: database
      .prepare("SELECT COUNT(*) AS value FROM rides WHERE status IN ('pending_admin', 'assigned')")
      .get().value,
    activeRides: database
      .prepare("SELECT COUNT(*) AS value FROM rides WHERE status IN ('accepted', 'in_progress')")
      .get().value,
    completedRides: database
      .prepare("SELECT COUNT(*) AS value FROM rides WHERE status = 'completed'")
      .get().value,
    totalRevenueUgx: database
      .prepare(
        "SELECT COALESCE(SUM(COALESCE(final_fare_ugx, quoted_fare_ugx)), 0) AS value FROM rides WHERE status = 'completed'"
      )
      .get().value
  };

  const rides = database
    .prepare(
      `
        SELECT
          rides.id,
          rides.status,
          rides.origin_label AS originLabel,
          rides.destination_label AS destinationLabel,
          rides.quoted_fare_ugx AS quotedFareUgx,
          rides.final_fare_ugx AS finalFareUgx,
          rides.requested_at AS requestedAt,
          customers.full_name AS customerName,
          customers.phone AS customerPhone,
          drivers.id AS driverId,
          drivers.full_name AS driverName,
          drivers.vehicle AS driverVehicle,
          drivers.plate_number AS driverPlateNumber
        FROM rides
        INNER JOIN customers ON customers.id = rides.customer_id
        LEFT JOIN drivers ON drivers.id = rides.driver_id
        ORDER BY rides.requested_at DESC
        LIMIT 40
      `
    )
    .all();

  const drivers = database
    .prepare(
      `
        SELECT
          drivers.id,
          drivers.full_name AS fullName,
          drivers.email,
          drivers.phone,
          drivers.vehicle,
          drivers.plate_number AS plateNumber,
          drivers.approval_status AS approvalStatus,
          drivers.approval_notes AS approvalNotes,
          drivers.is_online AS isOnline,
          drivers.current_lat AS currentLat,
          drivers.current_lng AS currentLng,
          drivers.last_location_at AS lastLocationAt,
          (
            SELECT COUNT(*) FROM driver_documents WHERE driver_documents.driver_id = drivers.id
          ) AS documentCount
        FROM drivers
        ORDER BY drivers.created_at DESC
      `
    )
    .all()
    .map((driver) => ({
      ...driver,
      isOnline: Boolean(driver.isOnline)
    }));

  return {
    summary,
    rides,
    drivers,
    settings: getSettings()
  };
}

export function createAdminRouter() {
  const router = express.Router();

  router.use(requireRole("admin"));

  router.get("/dashboard", (_req, res) => {
    res.json(getAdminDashboard());
  });

  router.get("/drivers/:driverId/documents", (req, res, next) => {
    try {
      const driver = database
        .prepare(
          `
            SELECT id, full_name AS fullName, face_photo_path AS facePhotoPath, car_photo_path AS carPhotoPath
            FROM drivers
            WHERE id = ?
          `
        )
        .get(req.params.driverId);

      if (!driver) {
        throw apiError(404, "Driver not found");
      }

      const documents = database
        .prepare(
          `
            SELECT id, original_name AS originalName, mime_type AS mimeType, file_path AS filePath, created_at AS createdAt
            FROM driver_documents
            WHERE driver_id = ?
            ORDER BY created_at ASC
          `
        )
        .all(req.params.driverId);

      res.json({ driver, documents });
    } catch (error) {
      next(error);
    }
  });

  router.get("/documents/:documentId/download", (req, res, next) => {
    try {
      const document = database
        .prepare(
          `
            SELECT original_name AS originalName, file_path AS filePath
            FROM driver_documents
            WHERE id = ?
          `
        )
        .get(req.params.documentId);

      if (!document) {
        throw apiError(404, "Document not found");
      }

      res.download(path.join(process.cwd(), document.filePath), document.originalName);
    } catch (error) {
      next(error);
    }
  });

  router.post("/drivers/:driverId/approve", async (req, res, next) => {
    try {
      const driver = database
        .prepare("SELECT id, email, phone FROM drivers WHERE id = ?")
        .get(req.params.driverId);

      if (!driver) {
        throw apiError(404, "Driver not found");
      }

      database
        .prepare(
          `
            UPDATE drivers
            SET approval_status = 'approved', approval_notes = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(req.body.notes?.trim() || null, nowIso(), driver.id);

      const realtime = req.app.locals.realtime;
      createNotification(realtime, {
        targetRole: "driver",
        targetId: driver.id,
        category: "driver_approved",
        title: "Application approved",
        message: "Your driver account is approved. You can now log in."
      });

      await sendOutboundNotice({
        email: driver.email,
        subject: "Teleka driver account approved",
        message: "Your driver account has been approved. Log in to go online and receive rides.",
        whatsappTo: driver.phone
      });

      res.json({ success: true, dashboard: getAdminDashboard() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/drivers/:driverId/reject", async (req, res, next) => {
    try {
      const driver = database
        .prepare("SELECT id, email, phone FROM drivers WHERE id = ?")
        .get(req.params.driverId);

      if (!driver) {
        throw apiError(404, "Driver not found");
      }

      const reason = req.body.notes?.trim() || "Your application needs changes before approval.";
      database
        .prepare(
          `
            UPDATE drivers
            SET approval_status = 'rejected', approval_notes = ?, is_online = 0, updated_at = ?
            WHERE id = ?
          `
        )
        .run(reason, nowIso(), driver.id);

      const realtime = req.app.locals.realtime;
      createNotification(realtime, {
        targetRole: "driver",
        targetId: driver.id,
        category: "driver_rejected",
        title: "Application needs updates",
        message: reason
      });

      await sendOutboundNotice({
        email: driver.email,
        subject: "Teleka driver application update",
        message: reason,
        whatsappTo: driver.phone
      });

      res.json({ success: true, dashboard: getAdminDashboard() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rides/:rideId/assign", async (req, res, next) => {
    try {
      const { driverId } = req.body;
      if (!driverId) {
        throw apiError(400, "Driver selection is required");
      }

      const ride = database
        .prepare(
          `
            SELECT id, status, customer_id AS customerId
            FROM rides
            WHERE id = ?
          `
        )
        .get(req.params.rideId);

      if (!ride) {
        throw apiError(404, "Ride not found");
      }
      if (!["pending_admin", "assigned"].includes(ride.status)) {
        throw apiError(409, "Ride can no longer be assigned");
      }

      const driver = database
        .prepare(
          `
            SELECT id, full_name AS fullName, approval_status AS approvalStatus, email, phone
            FROM drivers
            WHERE id = ?
          `
        )
        .get(driverId);

      if (!driver) {
        throw apiError(404, "Driver not found");
      }
      if (driver.approvalStatus !== "approved") {
        throw apiError(409, "Driver is not approved");
      }

      database
        .prepare("UPDATE rides SET driver_id = ?, status = 'assigned' WHERE id = ?")
        .run(driverId, ride.id);

      const realtime = req.app.locals.realtime;
      const snapshot = emitRideSnapshot(realtime, ride.id);
      createNotification(realtime, {
        targetRole: "driver",
        targetId: driverId,
        category: "ride_assigned",
        title: "New ride assigned",
        message: `${snapshot.originLabel} to ${snapshot.destinationLabel}`,
        rideId: ride.id
      });
      createNotification(realtime, {
        targetRole: "customer",
        targetId: ride.customerId,
        category: "ride_status",
        title: "Driver assigned",
        message: `${driver.fullName} has been assigned to your ride`,
        rideId: ride.id
      });

      await sendOutboundNotice({
        email: driver.email,
        subject: "Teleka ride assigned",
        message: `You have been assigned a ride from ${snapshot.originLabel} to ${snapshot.destinationLabel}.`,
        whatsappTo: driver.phone
      });

      res.json({ success: true, ride: snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rides/:rideId/status", (req, res, next) => {
    try {
      if (req.body.status !== "cancelled") {
        throw apiError(400, "Unsupported admin status update");
      }

      const ride = database
        .prepare("SELECT id, customer_id AS customerId, driver_id AS driverId FROM rides WHERE id = ?")
        .get(req.params.rideId);

      if (!ride) {
        throw apiError(404, "Ride not found");
      }

      database
        .prepare("UPDATE rides SET status = 'cancelled', cancelled_at = ? WHERE id = ?")
        .run(nowIso(), ride.id);

      const realtime = req.app.locals.realtime;
      const snapshot = emitRideSnapshot(realtime, ride.id);
      createNotification(realtime, {
        targetRole: "customer",
        targetId: ride.customerId,
        category: "ride_status",
        title: "Ride cancelled",
        message: "An administrator cancelled this ride",
        rideId: ride.id
      });
      if (ride.driverId) {
        createNotification(realtime, {
          targetRole: "driver",
          targetId: ride.driverId,
          category: "ride_status",
          title: "Ride cancelled",
          message: "This ride has been cancelled",
          rideId: ride.id
        });
      }

      res.json({ success: true, ride: snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.put("/settings/fare", (req, res, next) => {
    try {
      const fare = req.body;
      const required = ["baseFareUgx", "bookingFeeUgx", "perKmUgx", "perMinuteUgx", "minimumFareUgx"];
      for (const key of required) {
        if (!Number.isFinite(Number(fare[key]))) {
          throw apiError(400, `Invalid fare setting: ${key}`);
        }
      }

      setSetting("fare", {
        baseFareUgx: Number(fare.baseFareUgx),
        bookingFeeUgx: Number(fare.bookingFeeUgx),
        perKmUgx: Number(fare.perKmUgx),
        perMinuteUgx: Number(fare.perMinuteUgx),
        minimumFareUgx: Number(fare.minimumFareUgx)
      });

      res.json({ success: true, settings: getSettings() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
