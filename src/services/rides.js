import { randomUUID } from "node:crypto";

import { database, nowIso } from "../db.js";
import { createNotification } from "./notifications.js";

export function savePlaceForUser({ userRole, userId, place }) {
  database
    .prepare(
      `
        INSERT INTO saved_places (
          id, user_role, user_id, label, address, place_id, lat, lng, last_used_at, usage_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(user_role, user_id, address) DO UPDATE SET
          label = excluded.label,
          place_id = excluded.place_id,
          lat = excluded.lat,
          lng = excluded.lng,
          last_used_at = excluded.last_used_at,
          usage_count = saved_places.usage_count + 1
      `
    )
    .run(
      randomUUID(),
      userRole,
      userId,
      place.label,
      place.address,
      place.placeId || null,
      place.lat,
      place.lng,
      nowIso()
    );
}

export function listRecentPlaces(userRole, userId) {
  return database
    .prepare(
      `
        SELECT id, label, address, place_id AS placeId, lat, lng, last_used_at AS lastUsedAt, usage_count AS usageCount
        FROM saved_places
        WHERE user_role = ? AND user_id = ?
        ORDER BY usage_count DESC, last_used_at DESC
        LIMIT 8
      `
    )
    .all(userRole, userId);
}

export function getRideSnapshot(rideId) {
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
          rides.driver_notes AS driverNotes,
          rides.requested_at AS requestedAt,
          rides.accepted_at AS acceptedAt,
          rides.picked_up_at AS pickedUpAt,
          rides.completed_at AS completedAt,
          rides.cancelled_at AS cancelledAt,
          rides.current_lat AS currentLat,
          rides.current_lng AS currentLng,
          customers.id AS customerId,
          customers.full_name AS customerName,
          customers.email AS customerEmail,
          customers.phone AS customerPhone,
          customers.avatar_url AS customerAvatarUrl,
          drivers.id AS driverId,
          drivers.full_name AS driverName,
          drivers.email AS driverEmail,
          drivers.phone AS driverPhone,
          drivers.vehicle AS driverVehicle,
          drivers.plate_number AS driverPlateNumber,
          drivers.current_lat AS driverCurrentLat,
          drivers.current_lng AS driverCurrentLng,
          drivers.current_heading AS driverCurrentHeading,
          drivers.is_online AS driverIsOnline
        FROM rides
        INNER JOIN customers ON customers.id = rides.customer_id
        LEFT JOIN drivers ON drivers.id = rides.driver_id
        WHERE rides.id = ?
      `
    )
    .get(rideId);
}

export function emitRideSnapshot(realtime, rideId) {
  const ride = getRideSnapshot(rideId);
  if (!ride) {
    return null;
  }

  realtime.emitToAdmins("ride:updated", ride);
  realtime.emitToUser("customer", ride.customerId, "ride:updated", ride);
  if (ride.driverId) {
    realtime.emitToUser("driver", ride.driverId, "ride:updated", ride);
  }
  realtime.emitToRide(ride.id, "ride:updated", ride);
  return ride;
}

export function listRideMessages(rideId) {
  return database
    .prepare(
      `
        SELECT id, sender_role AS senderRole, sender_id AS senderId, body, created_at AS createdAt
        FROM ride_messages
        WHERE ride_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(rideId);
}

export function createRideMessage(realtime, { rideId, senderRole, senderId, body }) {
  const message = {
    id: randomUUID(),
    rideId,
    senderRole,
    senderId,
    body: body.trim(),
    createdAt: nowIso()
  };

  database
    .prepare(
      `
        INSERT INTO ride_messages (id, ride_id, sender_role, sender_id, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .run(message.id, message.rideId, message.senderRole, message.senderId, message.body, message.createdAt);

  const ride = getRideSnapshot(rideId);
  realtime.emitToRide(rideId, "message:new", message);
  realtime.emitToUser("customer", ride.customerId, "message:new", message);
  if (ride.driverId) {
    realtime.emitToUser("driver", ride.driverId, "message:new", message);
  }
  realtime.emitToAdmins("message:new", { rideId, ...message });

  if (ride.customerId && senderRole !== "customer") {
    createNotification(realtime, {
      targetRole: "customer",
      targetId: ride.customerId,
      category: "ride_message",
      title: "New ride message",
      message: body,
      rideId
    });
  }

  if (ride.driverId && senderRole !== "driver") {
    createNotification(realtime, {
      targetRole: "driver",
      targetId: ride.driverId,
      category: "ride_message",
      title: "New ride message",
      message: body,
      rideId
    });
  }

  return message;
}
