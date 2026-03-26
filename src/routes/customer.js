import { randomUUID } from "node:crypto";

import express from "express";

import { database, getSettings, nowIso } from "../db.js";
import { buildQuote } from "../services/maps.js";
import { createNotification } from "../services/notifications.js";
import { sendOutboundNotice } from "../services/outbound.js";
import {
  createRideMessage,
  emitRideSnapshot,
  listRecentPlaces,
  listRideMessages,
  savePlaceForUser
} from "../services/rides.js";
import { apiError, getCustomerProfile, requireRole } from "./helpers.js";

function listCustomerRides(customerId) {
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
          rides.payment_method AS paymentMethod,
          rides.customer_notes AS customerNotes,
          rides.requested_at AS requestedAt,
          rides.accepted_at AS acceptedAt,
          rides.picked_up_at AS pickedUpAt,
          rides.completed_at AS completedAt,
          rides.cancelled_at AS cancelledAt,
          rides.current_lat AS currentLat,
          rides.current_lng AS currentLng,
          drivers.id AS driverId,
          drivers.full_name AS driverName,
          drivers.phone AS driverPhone,
          drivers.vehicle AS driverVehicle,
          drivers.plate_number AS driverPlateNumber,
          drivers.current_lat AS driverCurrentLat,
          drivers.current_lng AS driverCurrentLng,
          drivers.current_heading AS driverCurrentHeading
        FROM rides
        LEFT JOIN drivers ON drivers.id = rides.driver_id
        WHERE rides.customer_id = ?
        ORDER BY rides.requested_at DESC
      `
    )
    .all(customerId);
}

function getOwnedRide(customerId, rideId) {
  const ride = database
    .prepare("SELECT id FROM rides WHERE id = ? AND customer_id = ?")
    .get(rideId, customerId);
  if (!ride) {
    throw apiError(404, "Ride not found");
  }
}

export function createCustomerRouter() {
  const router = express.Router();

  router.use(requireRole("customer"));

  router.get("/dashboard", (req, res) => {
    const customerId = req.session.user.id;
    res.json({
      profile: getCustomerProfile(customerId),
      recentPlaces: listRecentPlaces("customer", customerId),
      rides: listCustomerRides(customerId)
    });
  });

  router.post("/quote", async (req, res, next) => {
    try {
      const settings = getSettings();
      const quote = await buildQuote(req.body.origin, req.body.destination, settings.fare);
      res.json({ quote });
    } catch (error) {
      next(apiError(400, error.message || "Unable to calculate quote"));
    }
  });

  router.get("/places/recent", (req, res) => {
    res.json({
      places: listRecentPlaces("customer", req.session.user.id)
    });
  });

  router.post("/rides", async (req, res, next) => {
    try {
      const { origin, destination, paymentMethod, customerNotes } = req.body;
      if (!origin || !destination || !paymentMethod) {
        throw apiError(400, "Pickup, destination, and payment method are required");
      }

      const customerId = req.session.user.id;
      const settings = getSettings();
      const quote = await buildQuote(origin, destination, settings.fare);
      const rideId = randomUUID();
      const timestamp = nowIso();

      database
        .prepare(
          `
            INSERT INTO rides (
              id, customer_id, status, origin_label, origin_address, origin_place_id,
              origin_lat, origin_lng, destination_label, destination_address,
              destination_place_id, destination_lat, destination_lng,
              distance_meters, duration_seconds, quoted_fare_ugx, payment_method,
              customer_notes, requested_at
            )
            VALUES (?, ?, 'pending_admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          rideId,
          customerId,
          quote.origin.label,
          quote.origin.address,
          quote.origin.placeId || null,
          quote.origin.lat,
          quote.origin.lng,
          quote.destination.label,
          quote.destination.address,
          quote.destination.placeId || null,
          quote.destination.lat,
          quote.destination.lng,
          quote.distanceMeters,
          quote.durationSeconds,
          quote.fareUgx,
          paymentMethod,
          customerNotes?.trim() || null,
          timestamp
        );

      savePlaceForUser({ userRole: "customer", userId: customerId, place: quote.origin });
      savePlaceForUser({ userRole: "customer", userId: customerId, place: quote.destination });

      const realtime = req.app.locals.realtime;
      createNotification(realtime, {
        targetRole: "admin",
        targetId: "admin-root",
        category: "new_ride",
        title: "New ride request",
        message: `${quote.origin.label} to ${quote.destination.label}`,
        rideId
      });
      createNotification(realtime, {
        targetRole: "customer",
        targetId: customerId,
        category: "ride_status",
        title: "Ride request submitted",
        message: "Your ride request is awaiting driver assignment",
        rideId
      });

      await sendOutboundNotice({
        email: getCustomerProfile(customerId)?.email,
        subject: "Teleka ride requested",
        message: `Your ride from ${quote.origin.label} to ${quote.destination.label} is pending dispatch.`
      });

      const ride = emitRideSnapshot(realtime, rideId);

      res.status(201).json({
        success: true,
        ride
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/rides", (req, res) => {
    res.json({
      rides: listCustomerRides(req.session.user.id)
    });
  });

  router.get("/rides/:rideId/messages", (req, res, next) => {
    try {
      getOwnedRide(req.session.user.id, req.params.rideId);
      res.json({
        messages: listRideMessages(req.params.rideId)
      });
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

      getOwnedRide(req.session.user.id, req.params.rideId);
      const message = createRideMessage(req.app.locals.realtime, {
        rideId: req.params.rideId,
        senderRole: "customer",
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
