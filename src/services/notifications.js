import { randomUUID } from "node:crypto";

import { database, nowIso } from "../db.js";

export async function listNotifications(targetRole, targetId, limit = 40) {
  const rows = await database
    .prepare(
      `
        SELECT id, category, title, message, ride_id AS "rideId", metadata_json AS "metadataJson",
               read_at AS "readAt", created_at AS "createdAt"
        FROM notifications
        WHERE target_role = ? AND target_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(targetRole, targetId, limit);

  return rows.map((item) => ({
    ...item,
    metadata: item.metadataJson ? JSON.parse(item.metadataJson) : null
  }));
}

export async function markNotificationRead(targetRole, targetId, notificationId) {
  await database
    .prepare(
      `
        UPDATE notifications
        SET read_at = COALESCE(read_at, ?)
        WHERE id = ? AND target_role = ? AND target_id = ?
      `
    )
    .run(nowIso(), notificationId, targetRole, targetId);
}

export async function createNotification(realtime, payload) {
  const notification = {
    id: randomUUID(),
    createdAt: nowIso(),
    metadata: payload.metadata || null,
    ...payload
  };

  await database
    .prepare(
      `
        INSERT INTO notifications (
          id, target_role, target_id, category, title, message, ride_id, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      notification.id,
      notification.targetRole,
      notification.targetId,
      notification.category,
      notification.title,
      notification.message,
      notification.rideId || null,
      notification.metadata ? JSON.stringify(notification.metadata) : null,
      notification.createdAt
    );

  realtime.emitToUser(notification.targetRole, notification.targetId, "notification:new", notification);
  return notification;
}
