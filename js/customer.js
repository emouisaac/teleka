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

const state = {
  auth: null,
  config: null,
  dashboard: null,
  notifications: [],
  selectedRideId: null,
  selectedQuote: null,
  placeInputs: {
    origin: null,
    destination: null
  },
  socket: null,
  map: null,
  markers: {}
};

const elements = {
  banner: document.querySelector("#customerBanner"),
  authState: document.querySelector("#customerAuthState"),
  logoutBtn: document.querySelector("#customerLogoutBtn"),
  authCard: document.querySelector("#customerAuthCard"),
  authMessage: document.querySelector("#customerAuthMessage"),
  googleLoginMount: document.querySelector("#googleLoginMount"),
  profileMini: document.querySelector("#customerProfileMini"),
  avatar: document.querySelector("#customerAvatar"),
  name: document.querySelector("#customerName"),
  email: document.querySelector("#customerEmail"),
  pickupInput: document.querySelector("#pickupInput"),
  destinationInput: document.querySelector("#destinationInput"),
  pickupSuggestions: document.querySelector("#pickupSuggestions"),
  destinationSuggestions: document.querySelector("#destinationSuggestions"),
  paymentMethod: document.querySelector("#paymentMethod"),
  customerNotes: document.querySelector("#customerNotes"),
  quoteRideBtn: document.querySelector("#quoteRideBtn"),
  submitRideBtn: document.querySelector("#submitRideBtn"),
  quoteDistance: document.querySelector("#quoteDistance"),
  quoteDuration: document.querySelector("#quoteDuration"),
  quoteFare: document.querySelector("#quoteFare"),
  recentPlaces: document.querySelector("#recentPlaces"),
  rides: document.querySelector("#customerRides"),
  notifications: document.querySelector("#customerNotifications"),
  messages: document.querySelector("#customerMessages"),
  sendMessageBtn: document.querySelector("#customerSendMessageBtn"),
  messageInput: document.querySelector("#customerMessageInput"),
  activeRideStatus: document.querySelector("#activeRideStatus"),
  activeRideSummary: document.querySelector("#activeRideSummary"),
  chatRideBadge: document.querySelector("#chatRideBadge"),
  useMyLocationBtn: document.querySelector("#useMyLocationBtn")
};

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

function ensureMap() {
  if (state.map || !window.L) {
    return;
  }
  state.map = L.map("customerMap", { zoomControl: false }).setView([0.3136, 32.5811], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.map);
}

function syncMap() {
  ensureMap();
  if (!state.map) {
    return;
  }

  const ride = getActiveRide();
  if (!ride) {
    setText(elements.activeRideSummary, "Your active ride route, driver marker, and latest status will appear here.");
    setText(elements.activeRideStatus, "No active ride");
    return;
  }

  const points = [];
  const origin = [ride.originLat, ride.originLng];
  const destination = [ride.destinationLat, ride.destinationLng];
  const driverPoint =
    Number.isFinite(ride.currentLat) && Number.isFinite(ride.currentLng)
      ? [ride.currentLat, ride.currentLng]
      : Number.isFinite(ride.driverCurrentLat) && Number.isFinite(ride.driverCurrentLng)
        ? [ride.driverCurrentLat, ride.driverCurrentLng]
        : null;

  if (Number.isFinite(origin[0]) && Number.isFinite(origin[1])) {
    points.push(origin);
    state.markers.origin = state.markers.origin || L.marker(origin).addTo(state.map);
    state.markers.origin.setLatLng(origin).bindPopup(`Pickup: ${ride.originLabel}`);
  }

  if (Number.isFinite(destination[0]) && Number.isFinite(destination[1])) {
    points.push(destination);
    state.markers.destination =
      state.markers.destination || L.marker(destination).addTo(state.map);
    state.markers.destination.setLatLng(destination).bindPopup(`Destination: ${ride.destinationLabel}`);
  }

  if (driverPoint) {
    points.push(driverPoint);
    state.markers.driver = state.markers.driver || L.circleMarker(driverPoint, {
      radius: 10,
      color: "#0e7969",
      fillColor: "#ef9b28",
      fillOpacity: 0.95
    }).addTo(state.map);
    state.markers.driver.setLatLng(driverPoint).bindPopup(`Driver: ${ride.driverName || "Assigned driver"}`);
  }

  if (points.length) {
    state.map.fitBounds(points, { padding: [40, 40] });
  }

  setText(elements.activeRideStatus, ride.status.replaceAll("_", " "));
  setText(
    elements.activeRideSummary,
    ride.driverName
      ? `${ride.originLabel} to ${ride.destinationLabel}. Driver: ${ride.driverName} ${ride.driverPlateNumber || ""}.`
      : `${ride.originLabel} to ${ride.destinationLabel}. Dispatch is still assigning a driver.`
  );
}

function renderRecentPlaces() {
  elements.recentPlaces.innerHTML = "";
  const places = state.dashboard?.recentPlaces || [];
  places.forEach((place) => {
    const button = document.createElement("button");
    button.textContent = place.label;
    button.addEventListener("click", () => {
      elements.destinationInput.value = place.address;
      state.placeInputs.destination = place;
    });
    elements.recentPlaces.appendChild(button);
  });
}

function renderRides() {
  const rides = state.dashboard?.rides || [];
  elements.rides.innerHTML = "";

  if (!rides.length) {
    elements.rides.innerHTML = '<div class="ride-card"><p>No rides yet. Sign in, calculate a route, and submit your first request.</p></div>';
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
      <p>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)} • ${Math.round((ride.distanceMeters || 0) / 1000)} km</p>
      <p>${ride.driverName ? `Driver: ${ride.driverName} (${ride.driverPlateNumber || ride.driverVehicle || "assigned"})` : "No driver assigned yet"}</p>
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
  } else {
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
}

function renderProfile() {
  const user = state.auth?.user;
  const signedIn = state.auth?.authenticated && user?.role === "customer";

  elements.profileMini.classList.toggle("hidden", !signedIn);
  elements.logoutBtn.hidden = !signedIn;
  if (!signedIn) {
    setText(elements.authState, "Guest");
    return;
  }

  setText(elements.authState, "Signed in");
  setText(elements.name, user.fullName || "Customer");
  setText(elements.email, user.email || "");
  if (user.avatarUrl) {
    elements.avatar.src = user.avatarUrl;
  }
  elements.authMessage.textContent = "Your session is active and stored server-side. Refreshing this page will keep you signed in.";
}

function renderQuote() {
  const quote = state.selectedQuote;
  if (!quote) {
    setText(elements.quoteDistance, "-");
    setText(elements.quoteDuration, "-");
    setText(elements.quoteFare, formatCurrency(0));
    return;
  }

  setText(elements.quoteDistance, `${(quote.distanceMeters / 1000).toFixed(1)} km`);
  setText(elements.quoteDuration, `${Math.round(quote.durationSeconds / 60)} mins`);
  setText(elements.quoteFare, formatCurrency(quote.fareUgx));
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
  await renderMessages();
}

function attachAutocomplete(input, dropdown, key) {
  const executeLookup = debounce(async () => {
    const value = input.value.trim();
    if (value.length < 3) {
      dropdown.classList.remove("active");
      dropdown.innerHTML = "";
      return;
    }
    const payload = await api.autocompletePlaces(value);
    dropdown.innerHTML = "";
    payload.suggestions.forEach((suggestion) => {
      const button = document.createElement("button");
      button.className = "suggestion-item";
      button.type = "button";
      button.textContent = suggestion.label;
      button.addEventListener("click", () => {
        input.value = suggestion.address;
        state.placeInputs[key] = suggestion;
        dropdown.classList.remove("active");
      });
      dropdown.appendChild(button);
    });
    dropdown.classList.toggle("active", payload.suggestions.length > 0);
  }, 220);

  input.addEventListener("input", () => {
    state.placeInputs[key] = null;
    executeLookup();
  });

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target) && event.target !== input) {
      dropdown.classList.remove("active");
    }
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
    state.auth = await api.request("/api/auth/google", {
      method: "POST",
      body: { credential: response.credential }
    });
    state.auth.authenticated = true;
    renderProfile();
    initSocket();
    await loadDashboard();
    await loadNotifications();
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
    callback: handleGoogleCredential
  });
  window.google.accounts.id.renderButton(elements.googleLoginMount, {
    theme: "filled_blue",
    size: "large",
    text: "continue_with"
  });
}

async function handleQuote() {
  try {
    const origin = toPlacePayload(elements.pickupInput, state.placeInputs.origin);
    const destination = toPlacePayload(elements.destinationInput, state.placeInputs.destination);
    if (!origin || !destination) {
      throw new Error("Pickup and destination are required");
    }
    const payload = await api.customerQuote({ origin, destination });
    state.selectedQuote = payload.quote;
    renderQuote();
    showBanner(elements.banner, "Fare calculated", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
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
    const payload = await api.createRide({
      origin,
      destination,
      paymentMethod: elements.paymentMethod.value,
      customerNotes: elements.customerNotes.value
    });
    state.selectedRideId = payload.ride.id;
    await loadDashboard();
    await loadNotifications();
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

function useMyLocation() {
  if (!navigator.geolocation) {
    showBanner(elements.banner, "Geolocation is not available in this browser", "danger");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      elements.pickupInput.value = "Current location";
      state.placeInputs.origin = {
        label: "Current location",
        address: `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        lat,
        lng
      };
      showBanner(elements.banner, "Pickup set from your device location", "success");
    },
    () => showBanner(elements.banner, "Unable to read your location", "danger"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function bootstrap() {
  showBanner(elements.banner, "Loading customer workspace", "neutral");
  state.config = await api.publicConfig();
  state.auth = await api.authStatus();
  renderProfile();
  attachAutocomplete(elements.pickupInput, elements.pickupSuggestions, "origin");
  attachAutocomplete(elements.destinationInput, elements.destinationSuggestions, "destination");
  initGoogleButton();

  if (state.auth?.authenticated && state.auth.user.role === "customer") {
    initSocket();
    await loadDashboard();
    await loadNotifications();
  } else {
    renderRecentPlaces();
    renderRides();
    renderNotifications();
    await renderMessages();
    syncMap();
  }

  showBanner(elements.banner, "Customer panel ready", "success");
}

elements.quoteRideBtn.addEventListener("click", handleQuote);
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
