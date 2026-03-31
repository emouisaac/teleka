import express from "express";

import { config } from "../config.js";
import { database, getSettings, nowIso, setSetting } from "../db.js";
import { buildVehicleEstimates } from "../services/maps.js";
import { createNotification } from "../services/notifications.js";
import { sendOutboundNotice } from "../services/outbound.js";
import { emitRideSnapshot } from "../services/rides.js";
import { createSignedUrl, downloadFile } from "../storage.js";
import { apiError, requireRole } from "./helpers.js";

async function getAdminDashboard() {
  const [
    customers,
    drivers,
    approvedDrivers,
    driversOnline,
    pendingRides,
    activeRides,
    completedRides,
    totalRevenueUgx,
    rides,
    rawDrivers,
    settings
  ] = await Promise.all([
    database.prepare("SELECT COUNT(*)::int AS value FROM customers").get(),
    database.prepare("SELECT COUNT(*)::int AS value FROM drivers").get(),
    database.prepare("SELECT COUNT(*)::int AS value FROM drivers WHERE approval_status = 'approved'").get(),
    database
      .prepare("SELECT COUNT(*)::int AS value FROM drivers WHERE approval_status = 'approved' AND is_online = 1")
      .get(),
    database
      .prepare("SELECT COUNT(*)::int AS value FROM rides WHERE status IN ('pending_admin', 'assigned')")
      .get(),
    database
      .prepare("SELECT COUNT(*)::int AS value FROM rides WHERE status IN ('accepted', 'in_progress')")
      .get(),
    database.prepare("SELECT COUNT(*)::int AS value FROM rides WHERE status = 'completed'").get(),
    database
      .prepare(
        "SELECT COALESCE(SUM(COALESCE(final_fare_ugx, quoted_fare_ugx)), 0)::int AS value FROM rides WHERE status = 'completed'"
      )
      .get(),
    database
      .prepare(
        `
          SELECT
            rides.id,
            rides.status,
            rides.origin_label AS "originLabel",
            rides.destination_label AS "destinationLabel",
            rides.requested_vehicle_class AS "requestedVehicleClass",
            rides.quoted_fare_ugx AS "quotedFareUgx",
            rides.final_fare_ugx AS "finalFareUgx",
            rides.requested_at AS "requestedAt",
            customers.full_name AS "customerName",
            customers.phone AS "customerPhone",
            drivers.id AS "driverId",
            drivers.full_name AS "driverName",
            drivers.vehicle AS "driverVehicle",
            drivers.plate_number AS "driverPlateNumber",
            (
              SELECT COUNT(*)::int
              FROM ride_driver_offers
              WHERE ride_driver_offers.ride_id = rides.id
            ) AS "nearbyOfferCount",
            (
              SELECT COUNT(*)::int
              FROM ride_driver_offers
              WHERE ride_driver_offers.ride_id = rides.id
                AND ride_driver_offers.status = 'pending'
            ) AS "pendingOfferCount"
          FROM rides
          INNER JOIN customers ON customers.id = rides.customer_id
          LEFT JOIN drivers ON drivers.id = rides.driver_id
          ORDER BY rides.requested_at DESC
          LIMIT 40
        `
      )
      .all(),
    database
      .prepare(
        `
          SELECT
            drivers.id,
            drivers.full_name AS "fullName",
            drivers.email,
            drivers.phone,
            drivers.vehicle,
            drivers.plate_number AS "plateNumber",
            drivers.approval_status AS "approvalStatus",
            drivers.approval_notes AS "approvalNotes",
            drivers.is_online AS "isOnline",
            drivers.current_lat AS "currentLat",
            drivers.current_lng AS "currentLng",
            drivers.last_location_at AS "lastLocationAt",
            (
              SELECT COUNT(*) FROM driver_documents WHERE driver_documents.driver_id = drivers.id
            )::int AS "documentCount"
          FROM drivers
          ORDER BY drivers.created_at DESC
        `
      )
      .all(),
    getSettings()
  ]);

  return {
    summary: {
      customers: customers?.value || 0,
      drivers: drivers?.value || 0,
      approvedDrivers: approvedDrivers?.value || 0,
      driversOnline: driversOnline?.value || 0,
      pendingRides: pendingRides?.value || 0,
      activeRides: activeRides?.value || 0,
      completedRides: completedRides?.value || 0,
      totalRevenueUgx: totalRevenueUgx?.value || 0
    },
    rides,
    drivers: rawDrivers.map((driver) => ({
      ...driver,
      isOnline: Boolean(driver.isOnline)
    })),
    settings
  };
}

function calculateRideQuoteForFareSettings(ride, fareSettings) {
  const estimates = buildVehicleEstimates(
    Number(ride.distanceMeters || 0),
    Number(ride.durationSeconds || 0),
    fareSettings
  );
  const matchingEstimate =
    estimates.find((estimate) => estimate.key === ride.requestedVehicleClass) ||
    estimates.find((estimate) => estimate.key === "standard") ||
    estimates[0];

  return matchingEstimate?.fareUgx || Number(ride.quotedFareUgx || 0);
}

async function repriceOpenRides(fareSettings) {
  const openRides = await database
    .prepare(
      `
        SELECT
          id,
          distance_meters AS "distanceMeters",
          duration_seconds AS "durationSeconds",
          requested_vehicle_class AS "requestedVehicleClass",
          quoted_fare_ugx AS "quotedFareUgx"
        FROM rides
        WHERE status IN ('pending_admin', 'assigned', 'accepted', 'in_progress')
          AND final_fare_ugx IS NULL
      `
    )
    .all();

  const updatedRideIds = [];

  for (const ride of openRides) {
    const nextFare = calculateRideQuoteForFareSettings(ride, fareSettings);
    if (nextFare === Number(ride.quotedFareUgx || 0)) {
      continue;
    }

    await database
      .prepare("UPDATE rides SET quoted_fare_ugx = ? WHERE id = ?")
      .run(nextFare, ride.id);
    updatedRideIds.push(ride.id);
  }

  return updatedRideIds;
}

export function createAdminRouter() {
  const router = express.Router();

  router.use(requireRole("admin"));

  router.get("/dashboard", async (_req, res, next) => {
    try {
      res.json(await getAdminDashboard());
    } catch (error) {
      next(error);
    }
  });

  router.get("/drivers/:driverId/documents", async (req, res, next) => {
    try {
      const driver = await database
        .prepare(
          `
            SELECT id, full_name AS "fullName", face_photo_path AS "facePhotoPath", car_photo_path AS "carPhotoPath"
            FROM drivers
            WHERE id = ?
          `
        )
        .get(req.params.driverId);

      if (!driver) {
        throw apiError(404, "Driver not found");
      }

      const documents = await database
        .prepare(
          `
            SELECT id, document_type AS "documentType", original_name AS "originalName",
                   mime_type AS "mimeType", file_path AS "filePath", created_at AS "createdAt"
            FROM driver_documents
            WHERE driver_id = ?
            ORDER BY created_at ASC
          `
        )
        .all(req.params.driverId);

      const [facePhotoUrl, carPhotoUrl, mappedDocuments] = await Promise.all([
        createSignedUrl(driver.facePhotoPath),
        createSignedUrl(driver.carPhotoPath),
        Promise.all(
          documents.map(async (document) => ({
            ...document,
            downloadUrl: await createSignedUrl(document.filePath)
          }))
        )
      ]);

      res.json({
        driver: {
          ...driver,
          facePhotoUrl,
          carPhotoUrl
        },
        documents: mappedDocuments
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/documents/:documentId/download", async (req, res, next) => {
    try {
      const document = await database
        .prepare(
          `
            SELECT original_name AS "originalName", file_path AS "filePath"
            FROM driver_documents
            WHERE id = ?
          `
        )
        .get(req.params.documentId);

      if (!document) {
        throw apiError(404, "Document not found");
      }

      const file = await downloadFile(document.filePath);
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(document.originalName)}"`);
      res.send(file.buffer);
    } catch (error) {
      next(error);
    }
  });

  router.post("/drivers/:driverId/approve", async (req, res, next) => {
    try {
      const driver = await database
        .prepare("SELECT id, email, phone FROM drivers WHERE id = ?")
        .get(req.params.driverId);

      if (!driver) {
        throw apiError(404, "Driver not found");
      }

      await database
        .prepare(
          `
            UPDATE drivers
            SET approval_status = 'approved', approval_notes = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(req.body.notes?.trim() || null, nowIso(), driver.id);

      const realtime = req.app.locals.realtime;
      await createNotification(realtime, {
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

      res.json({ success: true, dashboard: await getAdminDashboard() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/drivers/:driverId/reject", async (req, res, next) => {
    try {
      const driver = await database
        .prepare("SELECT id, email, phone FROM drivers WHERE id = ?")
        .get(req.params.driverId);

      if (!driver) {
        throw apiError(404, "Driver not found");
      }

      const reason = req.body.notes?.trim() || "Your application needs changes before approval.";
      await database
        .prepare(
          `
            UPDATE drivers
            SET approval_status = 'rejected', approval_notes = ?, is_online = 0, updated_at = ?
            WHERE id = ?
          `
        )
        .run(reason, nowIso(), driver.id);

      const realtime = req.app.locals.realtime;
      await createNotification(realtime, {
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

      res.json({ success: true, dashboard: await getAdminDashboard() });
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

      const ride = await database
        .prepare(
          `
            SELECT id, status, customer_id AS "customerId"
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

      const driver = await database
        .prepare(
          `
            SELECT id, full_name AS "fullName", approval_status AS "approvalStatus", email, phone
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

      await database.withTransaction(async (tx) => {
        await tx
          .prepare("UPDATE rides SET driver_id = ?, status = 'assigned', accepted_at = NULL WHERE id = ?")
          .run(driverId, ride.id);
        await tx
          .prepare(
            `
              UPDATE ride_driver_offers
              SET status = CASE WHEN driver_id = ? THEN 'accepted' ELSE 'withdrawn' END,
                  responded_at = COALESCE(responded_at, ?)
              WHERE ride_id = ? AND status = 'pending'
            `
          )
          .run(driverId, nowIso(), ride.id);
      });

      const realtime = req.app.locals.realtime;
      const snapshot = await emitRideSnapshot(realtime, ride.id);
      await createNotification(realtime, {
        targetRole: "driver",
        targetId: driverId,
        category: "ride_assigned",
        title: "New ride assigned",
        message: `${snapshot?.originLabel || "Ride"} to ${snapshot?.destinationLabel || "destination"}`,
        rideId: ride.id
      });
      await createNotification(realtime, {
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
        message: `You have been assigned a ride from ${snapshot?.originLabel || "pickup"} to ${snapshot?.destinationLabel || "dropoff"}.`,
        whatsappTo: driver.phone
      });

      res.json({ success: true, ride: snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rides/:rideId/status", async (req, res, next) => {
    try {
      if (req.body.status !== "cancelled") {
        throw apiError(400, "Unsupported admin status update");
      }

      const ride = await database
        .prepare('SELECT id, customer_id AS "customerId", driver_id AS "driverId" FROM rides WHERE id = ?')
        .get(req.params.rideId);

      if (!ride) {
        throw apiError(404, "Ride not found");
      }

      await database
        .prepare("UPDATE rides SET status = 'cancelled', cancelled_at = ? WHERE id = ?")
        .run(nowIso(), ride.id);

      const realtime = req.app.locals.realtime;
      const snapshot = await emitRideSnapshot(realtime, ride.id);
      await createNotification(realtime, {
        targetRole: "customer",
        targetId: ride.customerId,
        category: "ride_status",
        title: "Ride cancelled",
        message: "An administrator cancelled this ride",
        rideId: ride.id
      });
      if (ride.driverId) {
        await createNotification(realtime, {
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

  router.put("/settings/fare", async (req, res, next) => {
    try {
      const fare = req.body;
      const required = ["baseFareUgx", "bookingFeeUgx", "perKmUgx", "perMinuteUgx", "minimumFareUgx"];
      for (const key of required) {
        if (!Number.isFinite(Number(fare[key]))) {
          throw apiError(400, `Invalid fare setting: ${key}`);
        }
      }

      await setSetting("fare", {
        baseFareUgx: Number(fare.baseFareUgx),
        bookingFeeUgx: Number(fare.bookingFeeUgx),
        perKmUgx: Number(fare.perKmUgx),
        perMinuteUgx: Number(fare.perMinuteUgx),
        minimumFareUgx: Number(fare.minimumFareUgx)
      });

      const settings = await getSettings();
      const updatedRideIds = await repriceOpenRides(settings.fare);
      const realtime = req.app.locals.realtime;

      await Promise.all(updatedRideIds.map((rideId) => emitRideSnapshot(realtime, rideId)));

      realtime.emitToAdmins("settings:updated", { key: "fare" });
      realtime.emitToRole("customer", "settings:updated", { key: "fare" });
      realtime.emitToRole("driver", "settings:updated", { key: "fare" });

      res.json({ success: true, settings });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
