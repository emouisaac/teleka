import { randomUUID } from "node:crypto";

import { database, nowIso } from "../db.js";
import { createNotification } from "./notifications.js";
import { getRideSnapshot } from "./rides.js";

export const NEARBY_DRIVER_RADIUS_METERS = 3000;
export const NEARBY_DRIVER_LIMIT = 3;

function haversineDistanceMeters(origin, target) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(target.lat - origin.lat);
  const dLng = toRadians(target.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const targetLat = toRadians(target.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(originLat) * Math.cos(targetLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

async function listEligibleNearbyDrivers({ rideId, origin, limit, maxDistanceMeters }) {
  const [drivers, existingOffers] = await Promise.all([
    database
      .prepare(
        `
          SELECT
            drivers.id,
            drivers.full_name AS "fullName",
            drivers.email,
            drivers.phone,
            drivers.current_lat AS "currentLat",
            drivers.current_lng AS "currentLng",
            COALESCE(active_rides.active_count, 0)::int AS "activeRideCount"
          FROM drivers
          LEFT JOIN (
            SELECT driver_id, COUNT(*)::int AS active_count
            FROM rides
            WHERE driver_id IS NOT NULL
              AND status IN ('assigned', 'accepted', 'in_progress')
            GROUP BY driver_id
          ) active_rides ON active_rides.driver_id = drivers.id
          WHERE drivers.approval_status = 'approved'
            AND drivers.is_online = 1
            AND drivers.current_lat IS NOT NULL
            AND drivers.current_lng IS NOT NULL
        `
      )
      .all(),
    database
      .prepare(
        `
          SELECT driver_id AS "driverId"
          FROM ride_driver_offers
          WHERE ride_id = ?
        `
      )
      .all(rideId)
  ]);

  const excludedDriverIds = new Set(existingOffers.map((offer) => offer.driverId));

  return drivers
    .filter((driver) => !excludedDriverIds.has(driver.id))
    .filter((driver) => Number(driver.activeRideCount || 0) === 0)
    .map((driver) => ({
      ...driver,
      distanceMeters: haversineDistanceMeters(origin, {
        lat: Number(driver.currentLat),
        lng: Number(driver.currentLng)
      })
    }))
    .filter((driver) => Number.isFinite(driver.distanceMeters) && driver.distanceMeters <= maxDistanceMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, limit);
}

export async function offerRideToNearbyDrivers(
  realtime,
  rideId,
  {
    limit = NEARBY_DRIVER_LIMIT,
    maxDistanceMeters = NEARBY_DRIVER_RADIUS_METERS
  } = {}
) {
  const ride = await getRideSnapshot(rideId);
  if (
    !ride ||
    ride.driverId ||
    ride.status !== "pending_admin" ||
    !Number.isFinite(Number(ride.originLat)) ||
    !Number.isFinite(Number(ride.originLng))
  ) {
    return { ride, offeredDrivers: [] };
  }

  const existingPendingOffers = await database
    .prepare(
      `
        SELECT COUNT(*)::int AS value
        FROM ride_driver_offers
        WHERE ride_id = ? AND status = 'pending'
      `
    )
    .get(rideId);

  const remainingSlots = Math.max(0, limit - Number(existingPendingOffers?.value || 0));
  if (!remainingSlots) {
    return { ride, offeredDrivers: [] };
  }

  const offeredDrivers = await listEligibleNearbyDrivers({
    rideId,
    origin: {
      lat: Number(ride.originLat),
      lng: Number(ride.originLng)
    },
    limit: remainingSlots,
    maxDistanceMeters
  });

  if (!offeredDrivers.length) {
    return { ride, offeredDrivers: [] };
  }

  const timestamp = nowIso();

  for (const driver of offeredDrivers) {
    await database
      .prepare(
        `
          INSERT INTO ride_driver_offers (
            id, ride_id, driver_id, status, distance_meters, created_at
          )
          VALUES (?, ?, ?, 'pending', ?, ?)
          ON CONFLICT(ride_id, driver_id) DO NOTHING
        `
      )
      .run(randomUUID(), rideId, driver.id, Math.round(driver.distanceMeters), timestamp);

    await createNotification(realtime, {
      targetRole: "driver",
      targetId: driver.id,
      category: "ride_offer",
      title: "New nearby ride request",
      message: `${ride.originLabel} to ${ride.destinationLabel}`,
      rideId,
      metadata: {
        distanceMeters: Math.round(driver.distanceMeters)
      }
    });

    realtime.emitToUser("driver", driver.id, "ride:offer", {
      rideId,
      distanceMeters: Math.round(driver.distanceMeters)
    });
  }

  return { ride, offeredDrivers };
}
