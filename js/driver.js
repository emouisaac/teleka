import { api } from "./shared/api.js";
import {
  createSocket,
  formatCurrency,
  formatDateTime,
  playTone,
  setText,
  showBanner,
  startLoopingTone
} from "./shared/utils.js";

const DEFAULT_CENTER = { lat: 0.3136, lng: 32.5811 };
const SESSION_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

const state = {
  auth: null,
  config: null,
  dashboard: null,
  notifications: [],
  selectedRideId: null,
  socket: null,
  map: null,
  mapMarkers: {},
  mapPolyline: null,
  watchId: null,
  keepAliveId: null,
  rideAlert: {
    rideId: null,
    stopTone: null
  },
  faceCapture: {
    blob: null,
    previewUrl: "",
    stream: null
  }
};

const elements = {
  banner: document.querySelector("#driverBanner"),
  siteNav: document.querySelector("#siteNav"),
  siteNavToggle: document.querySelector("#siteNavToggle"),
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
  tabBodies: document.querySelectorAll(".tab-body"),
  faceVideo: document.querySelector("#driverFaceVideo"),
  facePreview: document.querySelector("#driverFacePreview"),
  faceEmpty: document.querySelector("#driverFaceEmpty"),
  faceStartBtn: document.querySelector("#driverFaceStartBtn"),
  faceCaptureBtn: document.querySelector("#driverFaceCaptureBtn"),
  faceRetakeBtn: document.querySelector("#driverFaceRetakeBtn"),
  rideAlertModal: document.querySelector("#driverRideAlertModal"),
  rideAlertRoute: document.querySelector("#driverRideAlertRoute"),
  rideAlertMeta: document.querySelector("#driverRideAlertMeta"),
  rideAlertAcceptBtn: document.querySelector("#driverRideAlertAcceptBtn"),
  rideAlertRejectBtn: document.querySelector("#driverRideAlertRejectBtn")
};

let googleMapsPromise = null;

function stopSessionKeepAlive() {
  if (state.keepAliveId) {
    window.clearInterval(state.keepAliveId);
    state.keepAliveId = null;
  }
}

function startSessionKeepAlive() {
  stopSessionKeepAlive();
  if (!state.auth?.authenticated) {
    return;
  }

  state.keepAliveId = window.setInterval(async () => {
    try {
      await api.keepAlive();
    } catch {
      stopSessionKeepAlive();
    }
  }, SESSION_KEEPALIVE_INTERVAL_MS);
}

function closeSiteNav() {
  if (!elements.siteNav || !elements.siteNavToggle) {
    return;
  }
  elements.siteNav.classList.remove("open");
  elements.siteNavToggle.setAttribute("aria-expanded", "false");
}

function toggleSiteNav() {
  if (!elements.siteNav || !elements.siteNavToggle) {
    return;
  }
  const willOpen = !elements.siteNav.classList.contains("open");
  elements.siteNav.classList.toggle("open", willOpen);
  elements.siteNavToggle.setAttribute("aria-expanded", String(willOpen));
}

function attachSiteNav() {
  if (!elements.siteNav || !elements.siteNavToggle) {
    return;
  }

  elements.siteNavToggle.addEventListener("click", toggleSiteNav);

  elements.siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      closeSiteNav();
    });
  });

  document.addEventListener("click", (event) => {
    if (
      elements.siteNav.classList.contains("open") &&
      !elements.siteNav.contains(event.target) &&
      !elements.siteNavToggle.contains(event.target)
    ) {
      closeSiteNav();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSiteNav();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 720) {
      closeSiteNav();
    }
  });
}

function activateTab(targetId) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.target === targetId);
  });
  elements.tabBodies.forEach((body) => {
    body.classList.toggle("active", body.id === targetId);
  });
}

function setupTabs() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.target);
    });
  });
}

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Unable to load Google Maps"));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

function ensureMap() {
  if (state.map || !window.google?.maps) {
    return;
  }

  state.map = new google.maps.Map(document.getElementById("driverMap"), {
    center: DEFAULT_CENTER,
    zoom: 12,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
    mapTypeControl: true,
    streetViewControl: true,
    fullscreenControl: true,
    zoomControl: true,
    gestureHandling: "greedy"
  });
}

function setMapMarker(key, options) {
  if (!state.map || !window.google?.maps || !options?.position) {
    return;
  }

  if (!state.mapMarkers[key]) {
    state.mapMarkers[key] = new google.maps.Marker({
      map: state.map,
      ...options
    });
    return;
  }

  state.mapMarkers[key].setOptions({
    ...options,
    map: state.map
  });
}

function clearMapMarker(key) {
  if (!state.mapMarkers[key]) {
    return;
  }

  state.mapMarkers[key].setMap(null);
  delete state.mapMarkers[key];
}

function setRouteLine(points) {
  if (!state.map || !window.google?.maps) {
    return;
  }

  if (!points.length) {
    if (state.mapPolyline) {
      state.mapPolyline.setMap(null);
      state.mapPolyline = null;
    }
    return;
  }

  if (!state.mapPolyline) {
    state.mapPolyline = new google.maps.Polyline({
      strokeColor: "#0e7969",
      strokeOpacity: 0.82,
      strokeWeight: 4,
      map: state.map
    });
  }

  state.mapPolyline.setPath(points);
}

function fitMap(points) {
  if (!state.map || !window.google?.maps) {
    return;
  }

  if (!points.length) {
    state.map.setCenter(DEFAULT_CENTER);
    state.map.setZoom(12);
    return;
  }

  if (points.length === 1) {
    state.map.setCenter(points[0]);
    state.map.setZoom(15);
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  points.forEach((point) => bounds.extend(point));
  state.map.fitBounds(bounds, 80);
}

function getActiveRide() {
  const rides = state.dashboard?.rides || [];
  return (
    rides.find((ride) => ["accepted", "in_progress", "assigned"].includes(ride.status)) ||
    rides.find((ride) => ride.id === state.selectedRideId) ||
    null
  );
}

function getRideById(rideId) {
  return (state.dashboard?.rides || []).find((ride) => ride.id === rideId) || null;
}

function isRideOfferPending(ride) {
  return ride?.status === "pending_admin" && ride?.driverOfferStatus === "pending";
}

function isRideAwaitingDriverDecision(ride) {
  return ride?.status === "assigned" || isRideOfferPending(ride);
}

function formatRideStatusLabel(ride) {
  if (isRideOfferPending(ride)) {
    return "nearby offer";
  }
  return String(ride?.status || "pending_admin").replaceAll("_", " ");
}

function getPendingAssignedRideAlerts() {
  return (state.dashboard?.rides || [])
    .filter((ride) => isRideAwaitingDriverDecision(ride))
    .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt));
}

function stopRideAlertTone() {
  if (state.rideAlert.stopTone) {
    state.rideAlert.stopTone();
    state.rideAlert.stopTone = null;
  }
}

function clearRideAlert() {
  state.rideAlert.rideId = null;
  stopRideAlertTone();
  elements.rideAlertModal.classList.add("hidden");
}

function ensureRideAlertTone() {
  if (!state.rideAlert.stopTone) {
    state.rideAlert.stopTone = startLoopingTone("alarm", 1300);
  }
}

function syncMap() {
  if (!state.config?.googleMapsApiKey) {
    setText(elements.mapSummary, "Add a Google Maps API key to enable the live driver map.");
    return;
  }

  ensureMap();
  if (!state.map || !window.google?.maps) {
    return;
  }

  const ride = getActiveRide() || getRideById(state.selectedRideId);
  const profile = state.dashboard?.profile;
  const points = [];
  const routePoints = [];

  if (Number.isFinite(profile?.currentLat) && Number.isFinite(profile?.currentLng)) {
    const position = { lat: profile.currentLat, lng: profile.currentLng };
    setMapMarker("driver", {
      position,
      title: "Your live location",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: "#ef9b28",
        fillOpacity: 0.95,
        strokeColor: "#0e7969",
        strokeWeight: 3
      }
    });
    points.push(position);
    routePoints.push(position);
  } else {
    clearMapMarker("driver");
  }

  if (Number.isFinite(ride?.originLat) && Number.isFinite(ride?.originLng)) {
    const origin = { lat: ride.originLat, lng: ride.originLng };
    setMapMarker("origin", {
      position: origin,
      title: `Pickup: ${ride.originLabel}`,
      label: { text: "P", color: "#ffffff", fontWeight: "700" }
    });
    points.push(origin);
    routePoints.push(origin);
  } else {
    clearMapMarker("origin");
  }

  if (Number.isFinite(ride?.destinationLat) && Number.isFinite(ride?.destinationLng)) {
    const destination = { lat: ride.destinationLat, lng: ride.destinationLng };
    setMapMarker("destination", {
      position: destination,
      title: `Destination: ${ride.destinationLabel}`,
      label: { text: "D", color: "#ffffff", fontWeight: "700" }
    });
    points.push(destination);
    routePoints.push(destination);
  } else {
    clearMapMarker("destination");
  }

  setRouteLine(routePoints.length >= 2 ? routePoints : []);
  fitMap(points);

  setText(elements.rideStatus, ride ? ride.status.replaceAll("_", " ") : "No active ride");
  setText(
    elements.mapSummary,
    ride
      ? `${ride.originLabel} to ${ride.destinationLabel}. Keep your live location on so admin and customers can follow the trip on Google Maps.`
      : "Go online to publish live location updates on Google Maps for dispatch and active customers."
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
    elements.rides.innerHTML =
      '<div class="ride-card"><p>No assigned rides yet. Stay approved and online to receive dispatches.</p></div>';
    return;
  }

  rides.forEach((ride) => {
    const card = document.createElement("article");
    card.className = "ride-card";
    const primaryAction =
      isRideAwaitingDriverDecision(ride)
        ? '<button class="primary-btn" data-action="accept">Accept</button><button class="ghost-btn" data-action="reject">Reject</button>'
        : ride.status === "accepted"
          ? '<button class="primary-btn" data-action="start">Start trip</button>'
          : ride.status === "in_progress"
            ? '<button class="primary-btn" data-action="complete">Complete</button>'
            : "";

    card.innerHTML = `
      <div class="ride-card-header">
        <div>
          <p class="route">${ride.originLabel} -> ${ride.destinationLabel}</p>
          <p>${ride.customerName} - ${ride.customerPhone || "No phone"}</p>
        </div>
        <span class="pill">${formatRideStatusLabel(ride)}</span>
      </div>
      <p>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)} - ${Math.round((ride.distanceMeters || 0) / 1000)} km</p>
      ${
        isRideOfferPending(ride)
          ? `<p>Nearby offer - about ${Math.round((ride.driverOfferDistanceMeters || 0) / 1000 * 10) / 10} km from your last live location</p>`
          : ""
      }
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
          } else if (action === "reject") {
            await api.driverRejectRide(ride.id);
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
    elements.messages.innerHTML =
      '<div class="message-item"><p>Select a ride to view the trip chat.</p></div>';
    return;
  }

  const payload = await api.driverRideMessages(state.selectedRideId);
  if (!payload.messages.length) {
    elements.messages.innerHTML =
      '<div class="message-item"><p>No messages yet for this ride.</p></div>';
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
    elements.notifications.innerHTML =
      '<div class="notification-item"><p>No dispatch notifications yet.</p></div>';
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

function syncLocationWatchState() {
  if (state.dashboard?.profile?.isOnline) {
    startLocationWatch();
  } else {
    stopLocationWatch();
  }
}

function renderRideAlertModal() {
  const ride = getRideById(state.rideAlert.rideId);

  if (!ride || !isRideAwaitingDriverDecision(ride)) {
    elements.rideAlertModal.classList.add("hidden");
    return;
  }

  elements.rideAlertModal.classList.remove("hidden");
  setText(elements.rideAlertRoute, `${ride.originLabel} to ${ride.destinationLabel}`);
  elements.rideAlertMeta.innerHTML = `
    <div class="profile-card">
      <strong>Customer</strong>
      <p>${ride.customerName || "Unknown customer"}</p>
    </div>
    <div class="profile-card">
      <strong>Requested</strong>
      <p>${formatDateTime(ride.requestedAt)}</p>
    </div>
    <div class="profile-card">
      <strong>Fare</strong>
      <p>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)}</p>
    </div>
    ${
      isRideOfferPending(ride)
        ? `
          <div class="profile-card">
            <strong>Distance</strong>
            <p>${((ride.driverOfferDistanceMeters || 0) / 1000).toFixed(1)} km away</p>
          </div>
        `
        : ""
    }
  `;
}

function syncRideAlert() {
  const pendingRides = getPendingAssignedRideAlerts();
  if (!pendingRides.length) {
    clearRideAlert();
    return;
  }

  const targetRide =
    pendingRides.find((ride) => ride.id === state.rideAlert.rideId) ||
    pendingRides[0];

  state.rideAlert.rideId = targetRide.id;
  renderRideAlertModal();
  ensureRideAlertTone();
}

async function refreshAll() {
  state.dashboard = await api.driverDashboard();
  if (!state.selectedRideId) {
    state.selectedRideId = getActiveRide()?.id || getPendingAssignedRideAlerts()[0]?.id || null;
  }

  setText(
    elements.chatBadge,
    state.selectedRideId ? `Ride ${state.selectedRideId.slice(0, 8)}` : "No ride selected"
  );

  renderProfile();
  renderRides();
  syncMap();
  syncRideAlert();
  syncLocationWatchState();
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

        if (state.dashboard?.profile) {
          state.dashboard.profile.currentLat = position.coords.latitude;
          state.dashboard.profile.currentLng = position.coords.longitude;
          state.dashboard.profile.currentHeading = position.coords.heading || 0;
          syncMap();
        }
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

function revokeFacePreview() {
  if (state.faceCapture.previewUrl) {
    URL.revokeObjectURL(state.faceCapture.previewUrl);
    state.faceCapture.previewUrl = "";
  }
}

function stopFaceCamera() {
  if (state.faceCapture.stream) {
    state.faceCapture.stream.getTracks().forEach((track) => track.stop());
    state.faceCapture.stream = null;
  }

  if (elements.faceVideo) {
    elements.faceVideo.srcObject = null;
  }
}

function renderFaceCaptureState() {
  const hasStream = Boolean(state.faceCapture.stream);
  const hasCapture = Boolean(state.faceCapture.blob && state.faceCapture.previewUrl);

  elements.faceVideo.classList.toggle("hidden", !hasStream);
  elements.facePreview.classList.toggle("hidden", !hasCapture);
  elements.faceEmpty.classList.toggle("hidden", hasStream || hasCapture);
  elements.faceCaptureBtn.disabled = !hasStream;
  elements.faceRetakeBtn.classList.toggle("hidden", !hasCapture);
  elements.faceStartBtn.disabled = hasStream;
}

async function startFaceCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This device does not support camera capture");
    }

    revokeFacePreview();
    state.faceCapture.blob = null;
    stopFaceCamera();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 720 },
        height: { ideal: 720 }
      },
      audio: false
    });

    state.faceCapture.stream = stream;
    elements.faceVideo.srcObject = stream;
    await elements.faceVideo.play().catch(() => {});
    renderFaceCaptureState();
  } catch (error) {
    showBanner(elements.banner, error.message || "Unable to access the front camera", "danger");
  }
}

async function captureFacePhoto() {
  try {
    if (!state.faceCapture.stream) {
      throw new Error("Open the front camera first");
    }

    const width = elements.faceVideo.videoWidth || 720;
    const height = elements.faceVideo.videoHeight || 720;
    const side = Math.min(width, height);
    const sourceX = Math.max(0, (width - side) / 2);
    const sourceY = Math.max(0, (height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 720;

    const context = canvas.getContext("2d");
    context.drawImage(elements.faceVideo, sourceX, sourceY, side, side, 0, 0, 720, 720);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      throw new Error("Unable to capture the face photo");
    }

    revokeFacePreview();
    state.faceCapture.blob = blob;
    state.faceCapture.previewUrl = URL.createObjectURL(blob);
    elements.facePreview.src = state.faceCapture.previewUrl;
    stopFaceCamera();
    renderFaceCaptureState();
    showBanner(elements.banner, "Face photo captured from the live camera", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

function resetFaceCapture() {
  revokeFacePreview();
  state.faceCapture.blob = null;
  stopFaceCamera();
  elements.facePreview.removeAttribute("src");
  renderFaceCaptureState();
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
    if (notification.category === "ride_assigned" || notification.category === "ride_offer") {
      await refreshAll();
      await loadNotifications();
      syncRideAlert();
      return;
    }

    playTone("default");
    await loadNotifications();
    if (notification.rideId) {
      await refreshAll();
    }
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
    startSessionKeepAlive();
    initSocket();
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Driver session restored", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

async function handleDriverRegister(event) {
  event.preventDefault();

  try {
    if (!state.faceCapture.blob) {
      throw new Error("Capture your face photo with the front camera before submitting");
    }

    const formData = new FormData(elements.registerForm);
    const registeredEmail = String(formData.get("email") || "").trim();
    formData.set("facePhoto", state.faceCapture.blob, `face-capture-${Date.now()}.jpg`);

    await api.driverRegister(formData);

    elements.registerForm.reset();
    resetFaceCapture();
    activateTab("driverLoginTab");
    elements.loginEmail.value = registeredEmail;
    elements.loginPassword.value = "";
    document.getElementById("driverAuthPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showBanner(
      elements.banner,
      "Registration submitted. You have been returned to the login tab and can sign in after admin approval.",
      "success"
    );
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

async function bootstrap() {
  attachSiteNav();
  setupTabs();
  renderFaceCaptureState();

  state.config = await api.publicConfig().catch(() => null);
  if (state.config?.googleMapsApiKey) {
    try {
      await loadGoogleMaps(state.config.googleMapsApiKey);
      ensureMap();
    } catch (error) {
      showBanner(elements.banner, error.message, "warning");
    }
  }

  state.auth = await api.authStatus();
  const signedIn = state.auth?.authenticated && state.auth.user.role === "driver";
  setAuthenticatedUi(signedIn);

  if (signedIn) {
    startSessionKeepAlive();
    initSocket();
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Driver hub ready", "success");
  } else {
    stopSessionKeepAlive();
    showBanner(
      elements.banner,
      "Log in with your approved driver account or submit a new registration.",
      "neutral"
    );
  }
}

elements.loginBtn.addEventListener("click", handleDriverLogin);
elements.registerForm.addEventListener("submit", handleDriverRegister);
elements.sendMessageBtn.addEventListener("click", handleSendMessage);
elements.faceStartBtn.addEventListener("click", startFaceCamera);
elements.faceCaptureBtn.addEventListener("click", captureFacePhoto);
elements.faceRetakeBtn.addEventListener("click", startFaceCamera);
elements.onlineToggle.addEventListener("change", async () => {
  try {
    await api.driverAvailability({ isOnline: elements.onlineToggle.checked });
    await refreshAll();
    showBanner(
      elements.banner,
      elements.onlineToggle.checked ? "You are now online" : "You are now offline",
      "success"
    );
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
});
elements.rideAlertAcceptBtn.addEventListener("click", async () => {
  const rideId = state.rideAlert.rideId;
  if (!rideId) {
    return;
  }

  try {
    await api.driverAcceptRide(rideId);
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Ride accepted", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
});
elements.rideAlertRejectBtn.addEventListener("click", async () => {
  const rideId = state.rideAlert.rideId;
  if (!rideId) {
    return;
  }

  try {
    await api.driverRejectRide(rideId);
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Ride rejected and sent back for reassignment", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
});
elements.logoutBtn.addEventListener("click", async () => {
  stopLocationWatch();
  stopFaceCamera();
  stopSessionKeepAlive();
  clearRideAlert();
  await api.logout();
  window.location.reload();
});
window.addEventListener("beforeunload", () => {
  stopLocationWatch();
  stopFaceCamera();
  stopSessionKeepAlive();
  clearRideAlert();
  revokeFacePreview();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.auth?.authenticated) {
    void api.keepAlive().catch(() => {});
  }
});

bootstrap().catch((error) => showBanner(elements.banner, error.message, "danger"));
