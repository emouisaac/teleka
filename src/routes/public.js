import express from "express";

import { config } from "../config.js";
import { getSettings } from "../db.js";
import { autocompletePlaces } from "../services/maps.js";

export function createPublicRouter() {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    res.json({
      googleClientId: config.googleClientId,
      googleMapsApiKey: config.googleMapsApiKey,
      mapProvider: config.googleMapsApiKey ? "google" : "osm"
    });
  });

  router.get("/places/autocomplete", async (req, res, next) => {
    try {
      const suggestions = await autocompletePlaces(String(req.query.q || ""));
      res.json({ suggestions });
    } catch (error) {
      next(error);
    }
  });

  router.get("/settings", (_req, res) => {
    res.json({ settings: getSettings() });
  });

  return router;
}
