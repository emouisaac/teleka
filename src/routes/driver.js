import { randomUUID } from "node:crypto";

import express from "express";

import { database, nowIso } from "../db.js";
import { createNotification } from "../services/notifications.js";
import { sendOutboundNotice } from "../services/outbound.js";
import {
  createRideMessage,
  emitRideSnapshot,
  listRideMessages
} from "../services/rides.js";
import { apiError, getDriverProfile, requireRole } from "./helpers.js";

function getDriverRide(driverId, rideId) {
  const ride = database
    .prepare(
      `
        SELECT id, status, customer_id AS customerId
        FROM rides
        WHERE id = ? AND driver_id = ?
      `
    )
    .get(rideId, driverId);

  if (!ride) {
    throw apiError(404, "Ride not found");
  }

  return ride;
}

function listDriverRides(driverId) {
  return database
    .prepare(
      `
        SELECT
          rides.id,
          rides.status,
          rides.origin_label AS originLabel,
          rides.origin_address AS originAddress,
          rides.origin_lat AS originLat,
          rides.origin_lng AS originLng,
          rides.destination_label AS destinationLabel,
          rides.destination_address AS destinationAddress,
          rides.destination_lat AS destinationLat,
          rides.destination_lng AS destinationLng,
          rides.distance_meters AS distanceMeters,
          rides.duration_seconds AS durationSeconds,
          rides.quoted_fare_ugx AS quotedFareUgx,
          rides.final_fare_ugx AS finalFareUgx,
          rides.requested_at AS requestedAt,
          rides.accepted_at AS acceptedAt,
          rides.picked_up_at AS pickedUpAt,
          rides.completed_at AS completedAt,
          rides.current_lat AS currentLat,
          rides.current_lng AS currentLng,
          customers.full_name AS customerName,
          customers.phone AS customerPhone,
          customers.avatar_url AS customerAvatarUrl
        FROM rides
        INNER JOIN customers ON customers.id = rides.customer_id
        WHERE rides.driver_id = ?
        ORDER BY rides.requested_at DESC
      `
    )
    .all(driverId);
}

function getDriverStats(driverId) {
  return {
    totalTrips: database
      .prepare("SELECT COUNT(*) AS value FROM rides WHERE driver_id = ? AND status = 'completed'")
      .get(driverId).value,
    activeTrips: database
      .prepare("SELECT COUNT(*) AS value FROM rides WHERE driver_id = ? AND status IN ('assigned', 'accepted', 'in_progress')")
      .get(driverId).value,
    earningsUgx: database
      .prepare(
        "SELECT COALESCE(SUM(COALESCE(final_fare_ugx, quoted_fare_ugx)), 0) AS value FROM rides WHERE driver_id = ? AND status = 'completed'"
      )
      .get(driverId).value
  };
}

export function createDriverRouter() {
  const router = express.Router();

  router.use(requireRole("driver"));

  router.get("/dashboard", (req, res) => {
    const driverId = req.session.user.id;
    res.json({
      profile: getDriverProfile(driverId),
      stats: getDriverStats(driverId),
      rides: listDriverRides(driverId)
    });
  });

  router.post("/availability", (req, res, next) => {
    try {
      const isOnline = Boolean(req.body.isOnline);
      database
        .prepare("UPDATE drivers SET is_online = ?, updated_at = ? WHERE id = ?")
        .run(isOnline ? 1 : 0, nowIso(), req.session.user.id);

      req.app.locals.realtime.emitToAdmins("driver:updated", getDriverProfile(req.session.user.id));
      res.json({
        success: true,
        profile: getDriverProfile(req.session.user.id)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/location", (req, res, next) => {
    try {
      const lat = Number(req.body.lat);
      const lng = Number(req.body.lng);
      const heading = Number(req.body.heading || 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw apiError(400, "Valid location coordinates are required");
      }

      const driverId = req.session.user.id;
      const timestamp = nowIso();
      database
        .prepare(
          `
            UPDATE drivers
            SET current_lat = ?, current_lng = ?, current_heading = ?, last_location_at = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(lat, lng, heading, timestamp, timestamp, driverId);

      const activeRide = database
        .prepare(
          `
            SELECT id
            FROM rides
            WHERE driver_id = ? AND status IN ('accepted', 'in_progress')
            ORDER BY requested_at DESC
            LIMIT 1
          `
        )
        .get(driverId);

      if (activeRide) {
        database
          .prepare("UPDATE rides SET current_lat = ?, current_lng = ? WHERE id = ?")
          .run(lat, lng, activeRide.id);
        database
          .prepare(
            `
              INSERT INTO location_events (id, driver_id, ride_id, lat, lng, heading, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(randomUUID(), driverId, activeRide.id, lat, lng, heading, timestamp);
        emitRideSnapshot(req.app.locals.realtime, activeRide.id);
      }

      req.app.locals.realtime.emitToAdmins("driver:updated", getDriverProfile(driverId));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rides/:rideId/accept", async (req, res, next) => {
    try {
      const ride = getDriverRide(req.session.user.id, req.params.rideId);
      if (ride.status !== "assigned") {
        throw apiError(409, "Ride is not awaiting driver acceptance");
      }

      database
        .prepare("UPDATE rides SET status = 'accepted', accepted_at = ? WHERE id = ?")
        .run(nowIso(), ride.id);

      const realtime = req.app.locals.realtime;
      const snapshot = emitRideSnapshot(realtime, ride.id);
      createNotification(realtime, {
        targetRole: "customer",
        targetId: ride.customerId,
        category: "ride_status",
        title: "Driver accepted your ride",
        message: "Your driver is now on the way",
        rideId: ride.id
      });

      await sendOutboundNotice({
        email: snapshot.customerEmail,
        subject: "Teleka driver accepted your ride",
        message: `${snapshot.driverName} accepted your ride and is on the way.`
      });

      res.json({ success: true, ride: snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rides/:rideId/start", (req, res, next) => {
    try {
      const ride = getDriverRide(req.session.user.id, req.params.rideId);
      if (ride.status !== "accepted") {
        throw apiError(409, "Ride cannot be started");
      }

      database
        .prepare("UPDATE rides SET status = 'in_progress', picked_up_at = ? WHERE id = ?")
        .run(nowIso(), ride.id);

      const realtime = req.app.locals.realtime;
      const snapshot = emitRideSnapshot(realtime, ride.id);
      createNotification(realtime, {
        targetRole: "customer",
        targetId: ride.customerId,
        category: "ride_status",
        title: "Trip started",
        message: "Your trip is in progress",
        rideId: ride.id
      });

      res.json({ success: true, ride: snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rides/:rideId/complete", async (req, res, next) => {
    try {
      const ride = getDriverRide(req.session.user.id, req.params.rideId);
      if (ride.status !== "in_progress") {
        throw apiError(409, "Only in-progress rides can be completed");
      }

      const finalFareUgx = Number(req.body.finalFareUgx || 0);
      database
        .prepare(
          `
            UPDATE rides
            SET status = 'completed', completed_at = ?, final_fare_ugx = CASE WHEN ? > 0 THEN ? ELSE final_fare_ugx END
            WHERE id = ?
          `
        )
        .run(nowIso(), finalFareUgx, finalFareUgx, ride.id);

      const realtime = req.app.locals.realtime;
      const snapshot = emitRideSnapshot(realtime, ride.id);
      createNotification(realtime, {
        targetRole: "customer",
        targetId: ride.customerId,
        category: "ride_status",
        title: "Ride completed",
        message: "Thanks for riding with Teleka",
        rideId: ride.id
      });

      await sendOutboundNotice({
        email: snapshot.customerEmail,
        subject: "Teleka ride completed",
        message: `Your ride is complete. Final fare: UGX ${snapshot.finalFareUgx || snapshot.quotedFareUgx}.`
      });

      res.json({ success: true, ride: snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get("/rides/:rideId/messages", (req, res, next) => {
    try {
      getDriverRide(req.session.user.id, req.params.rideId);
      res.json({ messages: listRideMessages(req.params.rideId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rides/:rideId/messages", (req, res, next) => {
    try {
      const { body } = req.body;
      if (!body || !body.trim()) {
        throw apiError(400, "Message body is required");
      }

      getDriverRide(req.session.user.id, req.params.rideId);
      const message = createRideMessage(req.app.locals.realtime, {
        rideId: req.params.rideId,
        senderRole: "driver",
        senderId: req.session.user.id,
        body
      });
      res.status(201).json({ message });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
