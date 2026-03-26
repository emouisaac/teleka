import { config } from "../config.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Teleka Taxi/1.0",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status}`);
  }

  return response.json();
}

export async function autocompletePlaces(query) {
  if (!query || query.trim().length < 3) {
    return [];
  }

  if (config.googleMapsApiKey) {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    );
    url.searchParams.set("input", query.trim());
    url.searchParams.set("components", "country:ug");
    url.searchParams.set("key", config.googleMapsApiKey);
    const payload = await requestJson(url.toString());
    return (payload.predictions || []).map((item) => ({
      label: item.description,
      address: item.description,
      placeId: item.place_id || "",
      lat: null,
      lng: null
    }));
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "ug");
  url.searchParams.set("q", query.trim());
  const payload = await requestJson(url.toString());
  return payload.map((item) => ({
    label: item.display_name,
    address: item.display_name,
    placeId: item.place_id ? String(item.place_id) : "",
    lat: toNumber(item.lat),
    lng: toNumber(item.lon)
  }));
}

export async function geocodePlace(place) {
  if (!place) {
    throw new Error("Place is required");
  }

  const lat = toNumber(place.lat);
  const lng = toNumber(place.lng);
  if (lat !== null && lng !== null) {
    return {
      label: place.label || place.address,
      address: place.address || place.label,
      placeId: place.placeId || "",
      lat,
      lng
    };
  }

  if (config.googleMapsApiKey) {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    if (place.placeId) {
      url.searchParams.set("place_id", place.placeId);
    } else {
      url.searchParams.set("address", place.address || place.label || "");
    }
    url.searchParams.set("key", config.googleMapsApiKey);
    const payload = await requestJson(url.toString());
    const result = payload.results?.[0];
    if (!result) {
      throw new Error("Unable to geocode selected place");
    }
    return {
      label: place.label || result.formatted_address,
      address: result.formatted_address,
      placeId: result.place_id || place.placeId || "",
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng
    };
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", place.address || place.label || "");
  const payload = await requestJson(url.toString());
  const result = payload[0];
  if (!result) {
    throw new Error("Unable to geocode selected place");
  }
  return {
    label: place.label || result.display_name,
    address: result.display_name,
    placeId: result.place_id ? String(result.place_id) : "",
    lat: toNumber(result.lat),
    lng: toNumber(result.lon)
  };
}

export function calculateFare(distanceMeters, durationSeconds, fareSettings) {
  const distanceKm = distanceMeters / 1000;
  const durationMinutes = durationSeconds / 60;
  const rawFare =
    fareSettings.baseFareUgx +
    fareSettings.bookingFeeUgx +
    distanceKm * fareSettings.perKmUgx +
    durationMinutes * fareSettings.perMinuteUgx;

  return Math.max(fareSettings.minimumFareUgx, Math.round(rawFare));
}

async function getGoogleDirections(origin, destination) {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("key", config.googleMapsApiKey);
  const payload = await requestJson(url.toString());
  const leg = payload.routes?.[0]?.legs?.[0];
  if (!leg) {
    throw new Error("Unable to calculate route");
  }
  return {
    distanceMeters: leg.distance.value,
    durationSeconds: leg.duration.value
  };
}

async function getOsrmDirections(origin, destination) {
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`
  );
  url.searchParams.set("overview", "false");
  const payload = await requestJson(url.toString());
  const route = payload.routes?.[0];
  if (!route) {
    throw new Error("Unable to calculate route");
  }
  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration
  };
}

export async function buildQuote(originInput, destinationInput, fareSettings) {
  const origin = await geocodePlace(originInput);
  const destination = await geocodePlace(destinationInput);
  const route = config.googleMapsApiKey
    ? await getGoogleDirections(origin, destination)
    : await getOsrmDirections(origin, destination);
  return {
    origin,
    destination,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    fareUgx: calculateFare(route.distanceMeters, route.durationSeconds, fareSettings)
  };
}
