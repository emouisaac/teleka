import { api } from "./shared/api.js";
import {
  createSocket,
  debounce,
  formatCurrency,
  formatDateTime,
  playTone,
  setText,
  showBanner
} from "./shared/utils.js";

const defaultVehicleOptions = [
  {
    key: "mini",
    label: "Teleka Mini",
    fareUgx: null
  },
  {
    key: "standard",
    label: "Standard",
    fareUgx: null
  },
  {
    key: "premium",
    label: "Premium",
    fareUgx: null
  },
  {
    key: "suv",
    label: "SUV",
    fareUgx: null
  }
];

const vehicleFareConfig = {
  mini: { fareMultiplier: 0.84, minimumMultiplier: 0.9 },
  standard: { fareMultiplier: 1, minimumMultiplier: 1 },
  premium: { fareMultiplier: 1.55, minimumMultiplier: 1.45 },
  suv: { fareMultiplier: 1.34, minimumMultiplier: 1.25 }
};

const defaultFareSettings = {
  baseFareUgx: 5000,
  bookingFeeUgx: 1000,
  perKmUgx: 1800,
  perMinuteUgx: 150,
  minimumFareUgx: 10000
};

const authCopy = {
  guest: "Sign in with Google to request rides and keep your account active across refreshes.",
  signedIn: "You are signed in and ready to request, track, and manage rides."
};

const state = {
  auth: null,
  config: null,
  settings: null,
  dashboard: null,
  notifications: [],
  selectedRideId: null,
  selectedQuote: null,
  selectedVehicleClass: "standard",
  placeInputs: {
    origin: null,
    destination: null
  },
  socket: null,
  map: null,
  mapMarkers: {},
  directionsService: null,
  directionsRenderer: null,
  geocoder: null,
  quoteRequestId: 0
};

const elements = {
  banner: document.querySelector("#customerBanner"),
  authState: document.querySelector("#customerAuthState"),
  logoutBtn: document.querySelector("#customerLogoutBtn"),
  authCard: document.querySelector("#customerAuthCard"),
  accessTitle: document.querySelector("#customerAccessTitle"),
  authMessage: document.querySelector("#customerAuthMessage"),
  googleLoginMount: document.querySelector("#googleLoginMount"),
  profileMini: document.querySelector("#customerProfileMini"),
  avatar: document.querySelector("#customerAvatar"),
  name: document.querySelector("#customerName"),
  email: document.querySelector("#customerEmail"),
  pickupInput: document.querySelector("#pickupInput"),
  destinationInput: document.querySelector("#destinationInput"),
  vehicleOptions: document.querySelector("#vehicleOptions"),
  selectedVehicleHint: document.querySelector("#selectedVehicleHint"),
  estimateState: document.querySelector("#estimateState"),
  paymentMethod: document.querySelector("#paymentMethod"),
  customerNotes: document.querySelector("#customerNotes"),
  submitRideBtn: document.querySelector("#submitRideBtn"),
  quoteDistance: document.querySelector("#quoteDistance"),
  quoteDuration: document.querySelector("#quoteDuration"),
  quoteFare: document.querySelector("#quoteFare"),
  recentPlaces: document.querySelector("#recentPlaces"),
  rides: document.querySelector("#customerRides"),
  notifications: document.querySelector("#customerNotifications"),
  routeSteps: document.querySelector("#customerRouteSteps"),
  messages: document.querySelector("#customerMessages"),
  sendMessageBtn: document.querySelector("#customerSendMessageBtn"),
  messageInput: document.querySelector("#customerMessageInput"),
  activeRideStatus: document.querySelector("#activeRideStatus"),
  activeRideSummary: document.querySelector("#activeRideSummary"),
  chatRideBadge: document.querySelector("#chatRideBadge"),
  useMyLocationBtn: document.querySelector("#useMyLocationBtn")
};

let googleMapsPromise = null;

function getCustomerDisplayName(user) {
  if (!user) {
    return "Customer";
  }
  return user.fullName || user.email || "Customer";
}

function calculateBaseFare(distanceMeters, durationSeconds, fareSettings) {
  if (!fareSettings) {
    return 0;
  }

  const distanceKm = distanceMeters / 1000;
  const durationMinutes = durationSeconds / 60;
  const rawFare =
    fareSettings.baseFareUgx +
    fareSettings.bookingFeeUgx +
    distanceKm * fareSettings.perKmUgx +
    durationMinutes * fareSettings.perMinuteUgx;

  return Math.max(fareSettings.minimumFareUgx, Math.round(rawFare));
}

function buildVehicleEstimates(distanceMeters, durationSeconds) {
  const fareSettings = state.settings?.settings?.fare || state.settings?.fare || defaultFareSettings;
  const baseFareUgx = calculateBaseFare(distanceMeters, durationSeconds, fareSettings);

  return defaultVehicleOptions.map((vehicleOption) => {
    const config = vehicleFareConfig[vehicleOption.key] || vehicleFareConfig.standard;
    return {
      ...vehicleOption,
      fareUgx: Math.max(
        Math.round(fareSettings.minimumFareUgx * config.minimumMultiplier),
        Math.round(baseFareUgx * config.fareMultiplier)
      )
    };
  });
}

function getRouteRequestValue(place, input) {
  if (place?.lat !== null && place?.lat !== undefined && place?.lng !== null && place?.lng !== undefined) {
    return { lat: Number(place.lat), lng: Number(place.lng) };
  }
  return input.value.trim();
}

function getVehicleOptions() {
  return state.selectedQuote?.estimates || defaultVehicleOptions;
}

function getSelectedEstimate() {
  const options = getVehicleOptions();
  return (
    options.find((option) => option.key === state.selectedVehicleClass) ||
    options.find((option) => option.key === "standard") ||
    options[0] ||
    null
  );
}

function toPlacePayload(input, selected) {
  if (selected) {
    return selected;
  }
  const value = input.value.trim();
  if (!value) {
    return null;
  }
  return {
    label: value,
    address: value
  };
}

function getActiveRide() {
  const rides = state.dashboard?.rides || [];
  return (
    rides.find((ride) => ["assigned", "accepted", "in_progress"].includes(ride.status)) ||
    rides.find((ride) => ride.id === state.selectedRideId) ||
    rides[0] ||
    null
  );
}

function updateEstimateState(message) {
  setText(elements.estimateState, message);
}

function updateRequestButton() {
  const canRequest =
    state.auth?.authenticated &&
    state.auth.user?.role === "customer" &&
    Boolean(state.selectedQuote) &&
    Boolean(getSelectedEstimate());

  elements.submitRideBtn.disabled = !canRequest;
  elements.submitRideBtn.textContent = canRequest ? "Request ride" : "Sign in to request ride";
}

function renderVehicleOptions() {
  const options = getVehicleOptions();
  elements.vehicleOptions.innerHTML = "";

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vehicle-card ${option.key === state.selectedVehicleClass ? "selected" : ""}`;
    button.innerHTML = `
      <span class="vehicle-name">${option.label}</span>
      <strong class="fare">${option.fareUgx ? formatCurrency(option.fareUgx) : "--"}</strong>
    `;
    button.addEventListener("click", () => {
      state.selectedVehicleClass = option.key;
      renderVehicleOptions();
      renderQuote();
    });
    elements.vehicleOptions.appendChild(button);
  });
}

function renderProfile() {
  const user = state.auth?.user;
  const signedIn = state.auth?.authenticated && user?.role === "customer";

  elements.authCard.classList.toggle("hidden", signedIn);
  elements.profileMini.classList.toggle("hidden", !signedIn);
  elements.logoutBtn.hidden = !signedIn;
  if (!signedIn) {
    setText(elements.authState, "Guest");
    setText(elements.accessTitle, "Customer access");
    elements.authMessage.textContent = authCopy.guest;
    elements.googleLoginMount.classList.remove("hidden");
    updateRequestButton();
    return;
  }

  setText(elements.authState, getCustomerDisplayName(user));
  setText(elements.accessTitle, "Customer ready");
  setText(elements.name, getCustomerDisplayName(user));
  setText(elements.email, user.email || "");
  if (user.avatarUrl) {
    elements.avatar.src = user.avatarUrl;
  }
  elements.authMessage.textContent = authCopy.signedIn;
  elements.googleLoginMount.classList.add("hidden");
  updateRequestButton();
}

function renderQuote() {
  const quote = state.selectedQuote;
  const selectedEstimate = getSelectedEstimate();

  if (!quote || !selectedEstimate) {
    setText(elements.quoteDistance, "-");
    setText(elements.quoteDuration, "-");
    setText(elements.quoteFare, formatCurrency(0));
    elements.selectedVehicleHint.textContent =
      "Choose pickup and destination to see live estimates.";
    renderVehicleOptions();
    updateRequestButton();
    return;
  }

  setText(elements.quoteDistance, `${(quote.distanceMeters / 1000).toFixed(1)} km`);
  setText(elements.quoteDuration, `${Math.round(quote.durationSeconds / 60)} mins`);
  setText(elements.quoteFare, formatCurrency(selectedEstimate.fareUgx));
  elements.selectedVehicleHint.textContent = `${selectedEstimate.label} selected.`;
  renderVehicleOptions();
  updateRequestButton();
}

function renderRouteSteps(steps = []) {
  if (!elements.routeSteps) {
    return;
  }

  if (!steps.length) {
    elements.routeSteps.innerHTML =
      '<div class="route-step-empty">Type pickup and destination to see route directions.</div>';
    return;
  }

  elements.routeSteps.innerHTML = steps
    .map(
      (step, index) => `
        <div class="route-step">
          <span class="route-step-index">${index + 1}</span>
          <div>
            <p>${step.instructions}</p>
            <small>${step.distanceText} ${step.durationText ? `| ${step.durationText}` : ""}</small>
          </div>
        </div>
      `
    )
    .join("");
}

function renderRecentPlaces() {
  elements.recentPlaces.innerHTML = "";
  const places = state.dashboard?.recentPlaces || [];
  places.forEach((place) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = place.label;
    button.addEventListener("click", () => {
      elements.destinationInput.value = place.address;
      state.placeInputs.destination = place;
      void refreshQuote({ silentErrors: true });
    });
    elements.recentPlaces.appendChild(button);
  });
}

function renderRides() {
  const rides = state.dashboard?.rides || [];
  elements.rides.innerHTML = "";

  if (!rides.length) {
    elements.rides.innerHTML =
      '<div class="ride-card"><p>No rides yet. Pick a route, choose a vehicle class, and submit your first request.</p></div>';
    return;
  }

  rides.forEach((ride) => {
    const card = document.createElement("article");
    card.className = "ride-card";
    card.innerHTML = `
      <div class="ride-card-header">
        <div>
          <p class="route">${ride.originLabel} -> ${ride.destinationLabel}</p>
          <p>${formatDateTime(ride.requestedAt)}</p>
        </div>
        <span class="pill">${ride.status.replaceAll("_", " ")}</span>
      </div>
      <p>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)} | ${Math.round((ride.distanceMeters || 0) / 1000)} km</p>
      <p>${ride.requestedVehicleClass || "standard"} | ${ride.driverName ? `Driver: ${ride.driverName} (${ride.driverPlateNumber || ride.driverVehicle || "assigned"})` : "No driver assigned yet"}</p>
      <div class="ride-actions">
        <button class="secondary-btn" data-action="select">Open trip</button>
      </div>
    `;
    card.querySelector("[data-action='select']").addEventListener("click", async () => {
      await selectRide(ride.id);
    });
    elements.rides.appendChild(card);
  });
}

function renderNotifications() {
  elements.notifications.innerHTML = "";
  if (!state.notifications.length) {
    elements.notifications.innerHTML = '<div class="notification-item"><p>No notifications yet.</p></div>';
    return;
  }

  state.notifications.forEach((notification) => {
    const item = document.createElement("article");
    item.className = `notification-item ${notification.readAt ? "" : "unread"}`;
    item.innerHTML = `
      <div>
        <strong>${notification.title}</strong>
        <p>${notification.message}</p>
        <small>${formatDateTime(notification.createdAt)}</small>
      </div>
      ${notification.readAt ? "" : '<button class="ghost-btn">Mark read</button>'}
    `;
    const button = item.querySelector("button");
    if (button) {
      button.addEventListener("click", async () => {
        await api.markNotificationRead(notification.id);
        await loadNotifications();
      });
    }
    elements.notifications.appendChild(item);
  });
}

async function renderMessages() {
  elements.messages.innerHTML = "";
  if (!state.selectedRideId) {
    elements.messages.innerHTML = '<div class="message-item"><p>Select a ride to view messages.</p></div>';
    return;
  }

  const payload = await api.customerRideMessages(state.selectedRideId);
  if (!payload.messages.length) {
    elements.messages.innerHTML = '<div class="message-item"><p>No messages yet for this ride.</p></div>';
    return;
  }

  payload.messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = `message-item ${message.senderRole === "customer" ? "self" : ""}`;
    item.innerHTML = `
      <div>
        <strong>${message.senderRole === "customer" ? "You" : "Driver"}</strong>
        <p>${message.body}</p>
      </div>
      <small>${formatDateTime(message.createdAt)}</small>
    `;
    elements.messages.appendChild(item);
  });
}

async function loadNotifications() {
  if (!state.auth?.authenticated) {
    state.notifications = [];
    renderNotifications();
    return;
  }
  const payload = await api.notifications();
  state.notifications = payload.notifications;
  renderNotifications();
}

async function loadDashboard() {
  if (!state.auth?.authenticated || state.auth.user.role !== "customer") {
    state.dashboard = null;
    renderRecentPlaces();
    renderRides();
    renderQuote();
    await renderMessages();
    syncMap();
    return;
  }

  state.dashboard = await api.customerDashboard();
  const activeRide = getActiveRide();
  if (!state.selectedRideId && activeRide) {
    state.selectedRideId = activeRide.id;
  }
  if (state.selectedRideId) {
    setText(elements.chatRideBadge, `Ride ${state.selectedRideId.slice(0, 8)}`);
  } else {
    setText(elements.chatRideBadge, "No ride selected");
  }
  renderRecentPlaces();
  renderRides();
  renderQuote();
  syncMap();
  await renderMessages();
}

async function selectRide(rideId) {
  if (state.socket && state.selectedRideId) {
    state.socket.emit("ride:unwatch", state.selectedRideId);
  }
  state.selectedRideId = rideId;
  if (state.socket && rideId) {
    state.socket.emit("ride:watch", rideId);
  }
  setText(elements.chatRideBadge, `Ride ${rideId.slice(0, 8)}`);
  syncMap();
  await renderMessages();
}

function loadGoogleMaps(apiKey) {
  if (!apiKey) {
    return Promise.resolve(false);
  }
  if (window.google?.maps) {
    return Promise.resolve(true);
  }
  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Unable to load Google Maps"));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

function resetDirectionsRenderer() {
  if (!state.map || !window.google?.maps) {
    return;
  }
  if (state.directionsRenderer) {
    state.directionsRenderer.setMap(null);
  }
  state.directionsRenderer = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    polylineOptions: {
      strokeColor: "#0e7969",
      strokeOpacity: 0.92,
      strokeWeight: 6
    }
  });
  state.directionsRenderer.setMap(state.map);
}

function requestDirections(origin, destination) {
  return new Promise((resolve, reject) => {
    if (!state.directionsService || !window.google?.maps) {
      reject(new Error("Google directions service is not available"));
      return;
    }

    state.directionsService.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING
      },
      (result, status) => {
        if (status === "OK" && result) {
          resolve(result);
          return;
        }
        reject(new Error("Unable to calculate route"));
      }
    );
  });
}

function ensureMap() {
  if (state.map || !window.google?.maps) {
    return;
  }

  state.map = new google.maps.Map(document.getElementById("customerMap"), {
    center: { lat: 0.3136, lng: 32.5811 },
    zoom: 12,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false
  });
  state.geocoder = new google.maps.Geocoder();
  state.directionsService = new google.maps.DirectionsService();
  resetDirectionsRenderer();
}

function clearMapMarkers() {
  Object.values(state.mapMarkers).forEach((marker) => marker?.setMap?.(null));
  state.mapMarkers = {};
}

function placeMarker(key, position, options = {}) {
  if (!state.map || !window.google?.maps) {
    return;
  }

  if (state.mapMarkers[key]) {
    state.mapMarkers[key].setMap(null);
  }

  state.mapMarkers[key] = new google.maps.Marker({
    map: state.map,
    position,
    title: options.title || "",
    label: options.label,
    icon: options.icon
  });
}

function fitMapToPoints(points) {
  if (!state.map || !window.google?.maps || !points.length) {
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  points.forEach((point) => bounds.extend(point));
  state.map.fitBounds(bounds, 80);
}

async function renderQuoteMap(quote) {
  if (!quote) {
    return;
  }

  ensureMap();
  if (!state.map) {
    return;
  }

  clearMapMarkers();
  resetDirectionsRenderer();

  const origin = { lat: quote.origin.lat, lng: quote.origin.lng };
  const destination = { lat: quote.destination.lat, lng: quote.destination.lng };
  const directions = quote.directionsResult || null;

  try {
    if (directions) {
      state.directionsRenderer.setDirections(directions);
      renderRouteSteps(quote.routeSteps || []);
    } else if (state.directionsService) {
      const fallbackDirections = await requestDirections(origin, destination);
      state.directionsRenderer.setDirections(fallbackDirections);
      const steps =
        fallbackDirections.routes?.[0]?.legs?.[0]?.steps?.map((step) => ({
          instructions: step.instructions,
          distanceText: step.distance?.text || "",
          durationText: step.duration?.text || ""
        })) || [];
      renderRouteSteps(steps);
    }
  } catch {
    // Route preview is optional; markers and summary still provide a usable fallback.
    renderRouteSteps();
  }

  placeMarker("origin", origin, {
    label: "P",
    title: `Pickup: ${quote.origin.label}`
  });
  placeMarker("destination", destination, {
    label: "D",
    title: `Destination: ${quote.destination.label}`
  });
  fitMapToPoints([origin, destination]);

  setText(elements.activeRideStatus, "Route preview");
  setText(
    elements.activeRideSummary,
    `${quote.origin.label} to ${quote.destination.label}. ${(
      quote.distanceMeters / 1000
    ).toFixed(1)} km, about ${Math.round(quote.durationSeconds / 60)} mins.`
  );
}

async function renderActiveRideMap(ride) {
  ensureMap();
  if (!state.map) {
    return;
  }

  clearMapMarkers();
  resetDirectionsRenderer();

  const points = [];
  const origin = { lat: ride.originLat, lng: ride.originLng };
  const destination = { lat: ride.destinationLat, lng: ride.destinationLng };
  const driverPoint =
    Number.isFinite(ride.currentLat) && Number.isFinite(ride.currentLng)
      ? { lat: ride.currentLat, lng: ride.currentLng }
      : Number.isFinite(ride.driverCurrentLat) && Number.isFinite(ride.driverCurrentLng)
        ? { lat: ride.driverCurrentLat, lng: ride.driverCurrentLng }
        : null;

  if (Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
    points.push(origin);
    placeMarker("origin", origin, { label: "P", title: `Pickup: ${ride.originLabel}` });
  }

  if (Number.isFinite(destination.lat) && Number.isFinite(destination.lng)) {
    points.push(destination);
    placeMarker("destination", destination, {
      label: "D",
      title: `Destination: ${ride.destinationLabel}`
    });
  }

  if (driverPoint) {
    points.push(driverPoint);
    placeMarker("driver", driverPoint, {
      label: "R",
      title: `Driver: ${ride.driverName || "Assigned driver"}`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#ef9b28",
        fillOpacity: 0.95,
        strokeColor: "#0e7969",
        strokeWeight: 3
      }
    });
  }

  if (points.length) {
    fitMapToPoints(points);
  }

  renderRouteSteps([
    {
      instructions: `${ride.originLabel} to ${ride.destinationLabel}`,
      distanceText: `${Math.round((ride.distanceMeters || 0) / 1000)} km`,
      durationText: ride.durationSeconds ? `${Math.round(ride.durationSeconds / 60)} mins` : ""
    }
  ]);

  setText(elements.activeRideStatus, ride.status.replaceAll("_", " "));
  setText(
    elements.activeRideSummary,
    ride.driverName
      ? `${ride.originLabel} to ${ride.destinationLabel}. Driver: ${ride.driverName} ${ride.driverPlateNumber || ""}.`
      : `${ride.originLabel} to ${ride.destinationLabel}. Dispatch is still assigning a driver.`
  );
}

async function syncMapInternal() {
  if (state.selectedQuote) {
    await renderQuoteMap(state.selectedQuote);
    return;
  }

  const activeRide = getActiveRide();
  if (activeRide) {
    await renderActiveRideMap(activeRide);
    return;
  }

  ensureMap();
  if (!state.map) {
    return;
  }

  clearMapMarkers();
  resetDirectionsRenderer();
  state.map.setCenter({ lat: 0.3136, lng: 32.5811 });
  state.map.setZoom(12);
  renderRouteSteps();
  setText(
    elements.activeRideSummary,
    "Select pickup and destination to preview a live route, or open a trip to track your assigned driver."
  );
  setText(elements.activeRideStatus, "No active ride");
}

function syncMap() {
  void syncMapInternal();
}

async function refreshQuote({ silentErrors = false } = {}) {
  if (!state.config?.googleMapsApiKey || !window.google?.maps || !state.directionsService) {
    state.selectedQuote = null;
    renderQuote();
    syncMap();
    updateEstimateState("Google Maps not ready");
    return;
  }

  const origin = toPlacePayload(elements.pickupInput, state.placeInputs.origin);
  const destination = toPlacePayload(elements.destinationInput, state.placeInputs.destination);
  if (!origin || !destination) {
    state.selectedQuote = null;
    renderQuote();
    syncMap();
    updateEstimateState("Waiting for route");
    return;
  }

  const requestId = ++state.quoteRequestId;
  updateEstimateState("Estimating route");

  try {
    const directions = await requestDirections(
      getRouteRequestValue(state.placeInputs.origin, elements.pickupInput),
      getRouteRequestValue(state.placeInputs.destination, elements.destinationInput)
    );

    if (requestId !== state.quoteRequestId) {
      return;
    }

    const leg = directions.routes?.[0]?.legs?.[0];
    if (!leg) {
      throw new Error("Unable to calculate route");
    }

    const distanceMeters = Number(leg.distance?.value || 0);
    const durationSeconds = Number(leg.duration?.value || 0);
    const estimates = buildVehicleEstimates(distanceMeters, durationSeconds);
    const selectedEstimate =
      estimates.find((estimate) => estimate.key === state.selectedVehicleClass) ||
      estimates.find((estimate) => estimate.key === "standard") ||
      estimates[0];

    state.selectedQuote = {
      origin: {
        label: state.placeInputs.origin?.label || leg.start_address,
        address: leg.start_address,
        placeId: state.placeInputs.origin?.placeId || "",
        lat: leg.start_location?.lat?.() ?? state.placeInputs.origin?.lat,
        lng: leg.start_location?.lng?.() ?? state.placeInputs.origin?.lng
      },
      destination: {
        label: state.placeInputs.destination?.label || leg.end_address,
        address: leg.end_address,
        placeId: state.placeInputs.destination?.placeId || "",
        lat: leg.end_location?.lat?.() ?? state.placeInputs.destination?.lat,
        lng: leg.end_location?.lng?.() ?? state.placeInputs.destination?.lng
      },
      distanceMeters,
      durationSeconds,
      vehicleClass: selectedEstimate?.key || "standard",
      fareUgx: selectedEstimate?.fareUgx || 0,
      estimates,
      directionsResult: directions,
      routeSteps:
        leg.steps?.map((step) => ({
          instructions: step.instructions,
          distanceText: step.distance?.text || "",
          durationText: step.duration?.text || ""
        })) || []
    };
    state.selectedVehicleClass = state.selectedQuote.vehicleClass;
    renderQuote();
    syncMap();
    updateEstimateState("Estimates ready");
  } catch (error) {
    if (requestId !== state.quoteRequestId) {
      return;
    }
    state.selectedQuote = null;
    renderQuote();
    syncMap();
    updateEstimateState("Route unavailable");
    if (!silentErrors) {
      showBanner(elements.banner, error.message, "danger");
    }
  }
}

const debouncedRefreshQuote = debounce(() => {
  void refreshQuote({ silentErrors: true });
}, 450);

function attachLocationInputs() {
  [
    [elements.pickupInput, "origin"],
    [elements.destinationInput, "destination"]
  ].forEach(([input, key]) => {
    const handleDraftChange = () => {
      state.placeInputs[key] = null;
      state.selectedQuote = null;
      renderQuote();
      syncMap();
      debouncedRefreshQuote();
    };

    input.addEventListener("input", handleDraftChange);
    input.addEventListener("change", handleDraftChange);

    input.addEventListener("blur", () => {
      void refreshQuote({ silentErrors: true });
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void refreshQuote({ silentErrors: true });
      }
    });
  });
}

function attachGooglePlaces() {
  if (!window.google?.maps?.places) {
    return;
  }

  [
    [elements.pickupInput, "origin"],
    [elements.destinationInput, "destination"]
  ].forEach(([input, key]) => {
    const autocomplete = new google.maps.places.Autocomplete(input, {
      componentRestrictions: { country: "ug" },
      fields: ["formatted_address", "geometry", "name", "place_id"]
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place?.geometry?.location) {
        return;
      }

      const payload = {
        label: place.name || place.formatted_address || input.value.trim(),
        address: place.formatted_address || input.value.trim(),
        placeId: place.place_id || "",
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng()
      };

      input.value = payload.address;
      state.placeInputs[key] = payload;
      void refreshQuote({ silentErrors: true });
    });
  });
}

function initSocket() {
  if (state.socket || !state.auth?.authenticated) {
    return;
  }

  state.socket = createSocket();
  if (!state.socket) {
    return;
  }

  state.socket.on("connect", () => {
    if (state.selectedRideId) {
      state.socket.emit("ride:watch", state.selectedRideId);
    }
  });

  state.socket.on("notification:new", async (notification) => {
    playTone(notification.category === "ride_status" ? "urgent" : "default");
    showBanner(elements.banner, notification.title, "success");
    await loadNotifications();
  });

  state.socket.on("ride:updated", async (ride) => {
    if (!state.selectedRideId || ride.id === state.selectedRideId) {
      playTone("default");
    }
    await loadDashboard();
  });

  state.socket.on("message:new", async (message) => {
    if (message.rideId === state.selectedRideId) {
      playTone("default");
      await renderMessages();
    }
  });
}

async function handleGoogleCredential(response) {
  try {
    showBanner(elements.banner, "Signing in with Google", "neutral");
    await api.request("/api/auth/google", {
      method: "POST",
      body: { credential: response.credential }
    });
    state.auth = await api.authStatus();
    if (!state.auth?.authenticated || state.auth.user?.role !== "customer") {
      throw new Error("Google sign-in completed, but the customer session was not restored");
    }
    renderProfile();
    initSocket();
    await loadDashboard();
    await loadNotifications();
    await refreshQuote({ silentErrors: true });
    showBanner(elements.banner, "Google sign-in complete", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

function initGoogleButton() {
  if (!state.config?.googleClientId || !window.google?.accounts?.id) {
    elements.authMessage.textContent = "Google sign-in is not configured on this deployment.";
    return;
  }

  window.google.accounts.id.initialize({
    client_id: state.config.googleClientId,
    ux_mode: "popup",
    callback: handleGoogleCredential
  });
  window.google.accounts.id.renderButton(elements.googleLoginMount, {
    theme: "filled_blue",
    size: "large",
    text: "continue_with"
  });
}

async function handleRideRequest() {
  try {
    if (!state.auth?.authenticated) {
      throw new Error("Sign in before requesting a ride");
    }

    const origin = toPlacePayload(elements.pickupInput, state.placeInputs.origin);
    const destination = toPlacePayload(elements.destinationInput, state.placeInputs.destination);
    if (!origin || !destination) {
      throw new Error("Pickup and destination are required");
    }

    if (!getSelectedEstimate()) {
      throw new Error("Wait for the route estimate before requesting a ride");
    }

    const payload = await api.createRide({
      origin,
      destination,
      vehicleClass: state.selectedVehicleClass,
      paymentMethod: elements.paymentMethod.value,
      customerNotes: elements.customerNotes.value
    });

    state.selectedRideId = payload.ride.id;
    state.selectedQuote = null;
    await loadDashboard();
    await loadNotifications();
    updateEstimateState("Ride requested");
    showBanner(elements.banner, "Ride request submitted", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

async function handleSendMessage() {
  try {
    if (!state.selectedRideId) {
      throw new Error("Select a ride first");
    }
    const body = elements.messageInput.value.trim();
    if (!body) {
      throw new Error("Enter a message first");
    }
    await api.customerSendRideMessage(state.selectedRideId, { body });
    elements.messageInput.value = "";
    await renderMessages();
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

function reverseGeocodeLocation(lat, lng) {
  if (!state.geocoder || !window.google?.maps) {
    return Promise.resolve(`Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
  }

  return new Promise((resolve, reject) => {
    state.geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        resolve(results[0]);
        return;
      }
      reject(new Error("Unable to identify your current address"));
    });
  });
}

function useMyLocation() {
  if (!navigator.geolocation) {
    showBanner(elements.banner, "Geolocation is not available in this browser", "danger");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const result = await reverseGeocodeLocation(lat, lng);
        const formattedAddress =
          typeof result === "string" ? result : result.formatted_address || "Current location";

        elements.pickupInput.value = formattedAddress;
        state.placeInputs.origin = {
          label: formattedAddress,
          address: formattedAddress,
          placeId: typeof result === "string" ? "" : result.place_id || "",
          lat,
          lng
        };

        await refreshQuote({ silentErrors: true });
        showBanner(elements.banner, "Pickup filled from your current location", "success");
      } catch (error) {
        showBanner(elements.banner, error.message, "danger");
      }
    },
    () => showBanner(elements.banner, "Unable to read your location", "danger"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function bootstrap() {
  showBanner(elements.banner, "Loading customer workspace", "neutral");
  state.config = await api.publicConfig();
  state.settings = await api.publicSettings().catch(() => null);

  attachLocationInputs();
  renderVehicleOptions();
  renderQuote();

  if (state.config?.googleMapsApiKey) {
    try {
      await loadGoogleMaps(state.config.googleMapsApiKey);
      ensureMap();
      attachGooglePlaces();
    } catch (error) {
      showBanner(elements.banner, error.message, "warning");
    }
  }

  state.auth = await api.authStatus();
  renderProfile();
  initGoogleButton();

  if (state.auth?.authenticated && state.auth.user.role === "customer") {
    initSocket();
    await loadDashboard();
    await loadNotifications();
    await refreshQuote({ silentErrors: true });
  } else {
    renderRecentPlaces();
    renderRides();
    renderNotifications();
    await renderMessages();
    syncMap();
    await refreshQuote({ silentErrors: true });
  }

  showBanner(elements.banner, "Customer panel ready", "success");
}

elements.submitRideBtn.addEventListener("click", handleRideRequest);
elements.sendMessageBtn.addEventListener("click", handleSendMessage);
elements.logoutBtn.addEventListener("click", async () => {
  await api.logout();
  window.location.reload();
});
elements.useMyLocationBtn.addEventListener("click", useMyLocation);

bootstrap().catch((error) => {
  showBanner(elements.banner, error.message, "danger");
});
