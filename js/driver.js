import { api } from "./shared/api.js";
import {
  createSocket,
  formatCurrency,
  formatDateTime,
  playTone,
  setText,
  showBanner
} from "./shared/utils.js";

const state = {
  auth: null,
  dashboard: null,
  notifications: [],
  selectedRideId: null,
  socket: null,
  map: null,
  markers: {},
  watchId: null
};

const elements = {
  banner: document.querySelector("#driverBanner"),
  authState: document.querySelector("#driverAuthState"),
  logoutBtn: document.querySelector("#driverLogoutBtn"),
  authPanel: document.querySelector("#driverAuthPanel"),
  profilePanel: document.querySelector("#driverProfilePanel"),
  mapPanel: document.querySelector("#driverMapPanel"),
  assignedPanel: document.querySelector("#driverAssignedPanel"),
  messagesPanel: document.querySelector("#driverMessagesPanel"),
  notificationsPanel: document.querySelector("#driverNotificationsPanel"),
  loginEmail: document.querySelector("#driverLoginEmail"),
  loginPassword: document.querySelector("#driverLoginPassword"),
  loginBtn: document.querySelector("#driverLoginBtn"),
  registerForm: document.querySelector("#driverRegisterForm"),
  logoutBtn2: document.querySelector("#driverLogoutBtn"),
  onlineToggle: document.querySelector("#driverOnlineToggle"),
  nameHeading: document.querySelector("#driverNameHeading"),
  vehicleText: document.querySelector("#driverVehicleText"),
  plateText: document.querySelector("#driverPlateText"),
  approvalText: document.querySelector("#driverApprovalText"),
  earningsText: document.querySelector("#driverEarningsText"),
  rides: document.querySelector("#driverRides"),
  rideStatus: document.querySelector("#driverRideStatus"),
  mapSummary: document.querySelector("#driverMapSummary"),
  messages: document.querySelector("#driverMessages"),
  chatBadge: document.querySelector("#driverChatBadge"),
  messageInput: document.querySelector("#driverMessageInput"),
  sendMessageBtn: document.querySelector("#driverSendMessageBtn"),
  notifications: document.querySelector("#driverNotifications"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabBodies: document.querySelectorAll(".tab-body")
};

function setAuthenticatedUi(active) {
  elements.authPanel.classList.toggle("hidden", active);
  elements.profilePanel.classList.toggle("hidden", !active);
  elements.mapPanel.classList.toggle("hidden", !active);
  elements.assignedPanel.classList.toggle("hidden", !active);
  elements.messagesPanel.classList.toggle("hidden", !active);
  elements.notificationsPanel.classList.toggle("hidden", !active);
  elements.logoutBtn.hidden = !active;
  setText(elements.authState, active ? "Signed in" : "Signed out");
}

function ensureMap() {
  if (state.map || !window.L) {
    return;
  }
  state.map = L.map("driverMap", { zoomControl: false }).setView([0.3136, 32.5811], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.map);
}

function getActiveRide() {
  const rides = state.dashboard?.rides || [];
  return (
    rides.find((ride) => ["assigned", "accepted", "in_progress"].includes(ride.status)) ||
    rides.find((ride) => ride.id === state.selectedRideId) ||
    null
  );
}

function syncMap() {
  ensureMap();
  if (!state.map) {
    return;
  }

  const ride = getActiveRide();
  const profile = state.dashboard?.profile;
  const points = [];

  if (Number.isFinite(profile?.currentLat) && Number.isFinite(profile?.currentLng)) {
    const coords = [profile.currentLat, profile.currentLng];
    state.markers.driver = state.markers.driver || L.circleMarker(coords, {
      radius: 10,
      color: "#0e7969",
      fillColor: "#ef9b28",
      fillOpacity: 0.95
    }).addTo(state.map);
    state.markers.driver.setLatLng(coords).bindPopup("Your live location");
    points.push(coords);
  }

  if (ride?.originLat && ride?.originLng) {
    const origin = [ride.originLat, ride.originLng];
    state.markers.origin = state.markers.origin || L.marker(origin).addTo(state.map);
    state.markers.origin.setLatLng(origin).bindPopup(`Pickup: ${ride.originLabel}`);
    points.push(origin);
  }

  if (ride?.destinationLat && ride?.destinationLng) {
    const destination = [ride.destinationLat, ride.destinationLng];
    state.markers.destination =
      state.markers.destination || L.marker(destination).addTo(state.map);
    state.markers.destination.setLatLng(destination).bindPopup(`Destination: ${ride.destinationLabel}`);
    points.push(destination);
  }

  if (points.length) {
    state.map.fitBounds(points, { padding: [40, 40] });
  }

  setText(elements.rideStatus, ride ? ride.status.replaceAll("_", " ") : "No active ride");
  setText(
    elements.mapSummary,
    ride
      ? `${ride.originLabel} to ${ride.destinationLabel}. Keep location enabled so the admin and customer can follow the trip.`
      : "Go online to publish live location updates for dispatch and active customers."
  );
}

function renderProfile() {
  const profile = state.dashboard?.profile;
  const stats = state.dashboard?.stats;
  if (!profile) {
    return;
  }
  setText(elements.nameHeading, profile.fullName);
  setText(elements.vehicleText, profile.vehicle);
  setText(elements.plateText, profile.plateNumber);
  setText(elements.approvalText, profile.approvalStatus);
  setText(elements.earningsText, formatCurrency(stats?.earningsUgx || 0));
  elements.onlineToggle.checked = Boolean(profile.isOnline);
}

function renderRides() {
  const rides = state.dashboard?.rides || [];
  elements.rides.innerHTML = "";

  if (!rides.length) {
    elements.rides.innerHTML = '<div class="ride-card"><p>No assigned rides yet. Stay approved and online to receive dispatches.</p></div>';
    return;
  }

  rides.forEach((ride) => {
    const card = document.createElement("article");
    card.className = "ride-card";
    const primaryAction =
      ride.status === "assigned"
        ? '<button class="primary-btn" data-action="accept">Accept</button>'
        : ride.status === "accepted"
          ? '<button class="primary-btn" data-action="start">Start trip</button>'
          : ride.status === "in_progress"
            ? '<button class="primary-btn" data-action="complete">Complete</button>'
            : "";

    card.innerHTML = `
      <div class="ride-card-header">
        <div>
          <p class="route">${ride.originLabel} -> ${ride.destinationLabel}</p>
          <p>${ride.customerName} • ${ride.customerPhone || "No phone"}</p>
        </div>
        <span class="pill">${ride.status.replaceAll("_", " ")}</span>
      </div>
      <p>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)} • ${Math.round((ride.distanceMeters || 0) / 1000)} km</p>
      <p>Requested ${formatDateTime(ride.requestedAt)}</p>
      <div class="ride-actions">
        ${primaryAction}
        <button class="secondary-btn" data-action="open">Open trip</button>
      </div>
    `;

    card.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.action;
        try {
          if (action === "accept") {
            await api.driverAcceptRide(ride.id);
          } else if (action === "start") {
            await api.driverStartRide(ride.id);
          } else if (action === "complete") {
            const finalFare = window.prompt("Final fare in UGX", ride.quotedFareUgx);
            await api.driverCompleteRide(ride.id, { finalFareUgx: Number(finalFare || 0) });
          } else if (action === "open") {
            await selectRide(ride.id);
            return;
          }
          await refreshAll();
        } catch (error) {
          showBanner(elements.banner, error.message, "danger");
        }
      });
    });

    elements.rides.appendChild(card);
  });
}

async function renderMessages() {
  elements.messages.innerHTML = "";
  if (!state.selectedRideId) {
    elements.messages.innerHTML = '<div class="message-item"><p>Select a ride to view the trip chat.</p></div>';
    return;
  }
  const payload = await api.driverRideMessages(state.selectedRideId);
  if (!payload.messages.length) {
    elements.messages.innerHTML = '<div class="message-item"><p>No messages yet for this ride.</p></div>';
    return;
  }
  payload.messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = `message-item ${message.senderRole === "driver" ? "self" : ""}`;
    item.innerHTML = `
      <div>
        <strong>${message.senderRole === "driver" ? "You" : "Customer"}</strong>
        <p>${message.body}</p>
      </div>
      <small>${formatDateTime(message.createdAt)}</small>
    `;
    elements.messages.appendChild(item);
  });
}

function renderNotifications() {
  elements.notifications.innerHTML = "";
  if (!state.notifications.length) {
    elements.notifications.innerHTML = '<div class="notification-item"><p>No dispatch notifications yet.</p></div>';
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

async function loadNotifications() {
  const payload = await api.notifications();
  state.notifications = payload.notifications;
  renderNotifications();
}

async function refreshAll() {
  state.dashboard = await api.driverDashboard();
  if (!state.selectedRideId) {
    state.selectedRideId = getActiveRide()?.id || null;
  }
  setText(elements.chatBadge, state.selectedRideId ? `Ride ${state.selectedRideId.slice(0, 8)}` : "No ride selected");
  renderProfile();
  renderRides();
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
  setText(elements.chatBadge, `Ride ${rideId.slice(0, 8)}`);
  await renderMessages();
  syncMap();
}

function startLocationWatch() {
  if (!navigator.geolocation || state.watchId || !state.dashboard?.profile?.isOnline) {
    return;
  }
  state.watchId = navigator.geolocation.watchPosition(
    async (position) => {
      try {
        await api.driverLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading: position.coords.heading || 0
        });
      } catch (error) {
        showBanner(elements.banner, error.message, "danger");
      }
    },
    () => showBanner(elements.banner, "Unable to publish live driver location", "warning"),
    { enableHighAccuracy: true, maximumAge: 8000, timeout: 12000 }
  );
}

function stopLocationWatch() {
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
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
    playTone(notification.category === "ride_assigned" ? "urgent" : "default");
    await loadNotifications();
  });
  state.socket.on("ride:updated", async () => {
    await refreshAll();
  });
  state.socket.on("message:new", async (message) => {
    if (message.rideId === state.selectedRideId) {
      playTone("default");
      await renderMessages();
    }
  });
}

async function handleDriverLogin() {
  try {
    state.auth = await api.driverLogin({
      email: elements.loginEmail.value,
      password: elements.loginPassword.value
    });
    state.auth.authenticated = true;
    setAuthenticatedUi(true);
    initSocket();
    await refreshAll();
    await loadNotifications();
    if (state.dashboard?.profile?.isOnline) {
      startLocationWatch();
    }
    showBanner(elements.banner, "Driver session restored", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

async function handleDriverRegister(event) {
  event.preventDefault();
  try {
    const formData = new FormData(elements.registerForm);
    await api.driverRegister(formData);
    elements.registerForm.reset();
    showBanner(elements.banner, "Registration submitted for admin approval", "success");
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
      throw new Error("Message body is required");
    }
    await api.driverSendRideMessage(state.selectedRideId, { body });
    elements.messageInput.value = "";
    await renderMessages();
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

function setupTabs() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      elements.tabButtons.forEach((item) => item.classList.toggle("active", item === button));
      elements.tabBodies.forEach((body) => {
        body.classList.toggle("active", body.id === button.dataset.target);
      });
    });
  });
}

async function bootstrap() {
  setupTabs();
  state.auth = await api.authStatus();
  const signedIn = state.auth?.authenticated && state.auth.user.role === "driver";
  setAuthenticatedUi(signedIn);
  if (signedIn) {
    initSocket();
    await refreshAll();
    await loadNotifications();
    if (state.dashboard?.profile?.isOnline) {
      startLocationWatch();
    }
    showBanner(elements.banner, "Driver hub ready", "success");
  } else {
    showBanner(elements.banner, "Log in with your approved driver account or submit a new registration.", "neutral");
  }
}

elements.loginBtn.addEventListener("click", handleDriverLogin);
elements.registerForm.addEventListener("submit", handleDriverRegister);
elements.sendMessageBtn.addEventListener("click", handleSendMessage);
elements.onlineToggle.addEventListener("change", async () => {
  try {
    await api.driverAvailability({ isOnline: elements.onlineToggle.checked });
    await refreshAll();
    if (elements.onlineToggle.checked) {
      startLocationWatch();
    } else {
      stopLocationWatch();
    }
    showBanner(elements.banner, elements.onlineToggle.checked ? "You are now online" : "You are now offline", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
});
elements.logoutBtn.addEventListener("click", async () => {
  stopLocationWatch();
  await api.logout();
  window.location.reload();
});

bootstrap().catch((error) => showBanner(elements.banner, error.message, "danger"));
