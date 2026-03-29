import { api } from "./shared/api.js";
import {
  createSocket,
  formatCurrency,
  formatDateTime,
  playTone,
  setText,
  showBanner
} from "./shared/utils.js";

const DEFAULT_CENTER = { lat: 0.3136, lng: 32.5811 };
const SESSION_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

const state = {
  auth: null,
  config: null,
  dashboard: null,
  notifications: [],
  socket: null,
  keepAliveId: null,
  map: null,
  trafficLayer: null,
  markers: new Map(),
  infoWindow: null,
  pendingActions: {
    approvingDrivers: new Set(),
    rejectingDrivers: new Set(),
    assigningRides: new Set(),
    cancellingRides: new Set(),
    savingFare: false
  }
};

const elements = {
  banner: document.querySelector("#adminBanner"),
  siteNav: document.querySelector("#siteNav"),
  siteNavToggle: document.querySelector("#siteNavToggle"),
  authState: document.querySelector("#adminAuthState"),
  logoutBtn: document.querySelector("#adminLogoutBtn"),
  loginPanel: document.querySelector("#adminLoginPanel"),
  summaryPanel: document.querySelector("#adminSummaryPanel"),
  ridesPanel: document.querySelector("#adminRidesPanel"),
  driversPanel: document.querySelector("#adminDriversPanel"),
  farePanel: document.querySelector("#adminFarePanel"),
  docsPanel: document.querySelector("#adminDocsPanel"),
  notificationsPanel: document.querySelector("#adminNotificationsPanel"),
  mapPanel: document.querySelector("#adminMapPanel"),
  emailInput: document.querySelector("#adminEmailInput"),
  passwordInput: document.querySelector("#adminPasswordInput"),
  loginBtn: document.querySelector("#adminLoginBtn"),
  statsGrid: document.querySelector("#adminStatsGrid"),
  rides: document.querySelector("#adminRides"),
  drivers: document.querySelector("#adminDrivers"),
  notifications: document.querySelector("#adminNotifications"),
  documents: document.querySelector("#adminDocuments"),
  mapSummary: document.querySelector("#adminMapSummary"),
  fareBase: document.querySelector("#fareBase"),
  fareBooking: document.querySelector("#fareBooking"),
  farePerKm: document.querySelector("#farePerKm"),
  farePerMinute: document.querySelector("#farePerMinute"),
  fareMinimum: document.querySelector("#fareMinimum"),
  saveFareBtn: document.querySelector("#saveFareBtn")
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
  state.map = new google.maps.Map(document.getElementById("adminMap"), {
    center: DEFAULT_CENTER,
    zoom: 11,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
    mapTypeControl: true,
    streetViewControl: true,
    fullscreenControl: true,
    zoomControl: true,
    gestureHandling: "greedy"
  });
  state.infoWindow = new google.maps.InfoWindow();
  state.trafficLayer = new google.maps.TrafficLayer();
  state.trafficLayer.setMap(state.map);
}

function renderAuth() {
  const signedIn = state.auth?.authenticated && state.auth.user.role === "admin";
  elements.loginPanel.classList.toggle("hidden", signedIn);
  elements.summaryPanel.classList.toggle("hidden", !signedIn);
  elements.ridesPanel.classList.toggle("hidden", !signedIn);
  elements.driversPanel.classList.toggle("hidden", !signedIn);
  elements.farePanel.classList.toggle("hidden", !signedIn);
  elements.docsPanel.classList.toggle("hidden", !signedIn);
  elements.notificationsPanel.classList.toggle("hidden", !signedIn);
  elements.mapPanel.classList.toggle("hidden", !signedIn);
  elements.logoutBtn.hidden = !signedIn;
  setText(elements.authState, signedIn ? "Signed in" : "Signed out");
}

function renderSummary() {
  const summary = state.dashboard?.summary;
  elements.statsGrid.innerHTML = "";
  if (!summary) {
    return;
  }

  const cards = [
    ["Customers", summary.customers],
    ["Drivers", summary.drivers],
    ["Approved drivers", summary.approvedDrivers],
    ["Drivers online", summary.driversOnline],
    ["Pending rides", summary.pendingRides],
    ["Active rides", summary.activeRides],
    ["Completed rides", summary.completedRides],
    ["Revenue", formatCurrency(summary.totalRevenueUgx)]
  ];

  cards.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "stat-card";
    card.innerHTML = `<p>${label}</p><strong>${value}</strong>`;
    elements.statsGrid.appendChild(card);
  });
}

function renderFareSettings() {
  const fare = state.dashboard?.settings?.fare;
  if (!fare) {
    return;
  }
  elements.fareBase.value = fare.baseFareUgx;
  elements.fareBooking.value = fare.bookingFeeUgx;
  elements.farePerKm.value = fare.perKmUgx;
  elements.farePerMinute.value = fare.perMinuteUgx;
  elements.fareMinimum.value = fare.minimumFareUgx;
  elements.saveFareBtn.disabled = state.pendingActions.savingFare;
  elements.saveFareBtn.textContent = state.pendingActions.savingFare
    ? "Saving fare settings..."
    : "Save fare settings";
}

function formatAdminStatus(value) {
  const labels = {
    pending_admin: "Pending Review",
    assigned: "Assigned",
    accepted: "Accepted",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
    approved: "Approved",
    rejected: "Rejected",
    pending: "Pending"
  };

  return labels[value] || String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatVehicleClass(value) {
  return String(value || "standard").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDocumentType(value) {
  return String(value || "document")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isRideDispatchEditable(status) {
  return ["pending_admin", "assigned"].includes(status);
}

function isRideCancellable(status) {
  return !["completed", "cancelled"].includes(status);
}

function getApprovedDrivers() {
  return (state.dashboard?.drivers || []).filter((driver) => driver.approvalStatus === "approved");
}

function getDriverActionMarkup(driver) {
  const isApproving = state.pendingActions.approvingDrivers.has(driver.id);
  const isRejecting = state.pendingActions.rejectingDrivers.has(driver.id);

  if (isApproving) {
    return `
      <div class="table-actions">
        <button class="secondary-btn" data-docs="${driver.id}">Docs</button>
        <button class="primary-btn" type="button" disabled>Approving...</button>
      </div>
    `;
  }

  if (isRejecting) {
    return `
      <div class="table-actions">
        <button class="secondary-btn" data-docs="${driver.id}">Docs</button>
        <button class="ghost-btn" type="button" disabled>Rejecting...</button>
      </div>
    `;
  }

  if (driver.approvalStatus === "approved") {
    return `
      <div class="table-actions">
        <button class="secondary-btn" data-docs="${driver.id}">Docs</button>
        <span class="pill">Approved</span>
      </div>
    `;
  }

  if (driver.approvalStatus === "rejected") {
    return `
      <div class="table-actions">
        <button class="secondary-btn" data-docs="${driver.id}">Docs</button>
        <button class="primary-btn" data-approve="${driver.id}">Approve</button>
        <span class="pill">Rejected</span>
      </div>
    `;
  }

  return `
    <div class="table-actions">
      <button class="secondary-btn" data-docs="${driver.id}">Docs</button>
      <button class="primary-btn" data-approve="${driver.id}">Approve</button>
      <button class="ghost-btn" data-reject="${driver.id}">Reject</button>
    </div>
  `;
}

function getRideDispatchMarkup(ride, options) {
  const isAssigning = state.pendingActions.assigningRides.has(ride.id);
  const isCancelling = state.pendingActions.cancellingRides.has(ride.id);
  const assignLabel = ride.driverId ? "Reassign" : "Assign";
  const canAssign = isRideDispatchEditable(ride.status);
  const canCancel = isRideCancellable(ride.status);

  if (isAssigning) {
    return `
      <div class="table-actions">
        <button class="primary-btn" type="button" disabled>Assigning...</button>
      </div>
    `;
  }

  if (isCancelling) {
    return `
      <div class="table-actions">
        <button class="ghost-btn" type="button" disabled>Rejecting...</button>
      </div>
    `;
  }

  if (!canAssign && !canCancel) {
    return `
      <div class="table-actions">
        <span class="pill">${formatAdminStatus(ride.status)}</span>
      </div>
    `;
  }

  return `
    <div class="table-actions">
      ${
        canAssign
          ? `
            <select data-driver-select="${ride.id}">
              <option value="">Select driver</option>
              ${options}
            </select>
            <button class="primary-btn" data-assign="${ride.id}">${assignLabel}</button>
          `
          : `<span class="pill">${formatAdminStatus(ride.status)}</span>`
      }
      ${
        canCancel
          ? `<button class="ghost-btn" data-cancel="${ride.id}">Reject</button>`
          : ""
      }
    </div>
  `;
}

function syncMap() {
  if (!state.config?.googleMapsApiKey) {
    setText(elements.mapSummary, "Add a Google Maps API key to enable the Google live driver map.");
    return;
  }

  ensureMap();
  if (!state.map) {
    return;
  }

  state.markers.forEach((marker) => marker.setMap(null));
  state.markers.clear();

  const drivers = state.dashboard?.drivers || [];
  const points = [];

  drivers
    .filter((driver) => Number.isFinite(driver.currentLat) && Number.isFinite(driver.currentLng))
    .forEach((driver) => {
      const position = { lat: driver.currentLat, lng: driver.currentLng };
      const marker = new google.maps.Marker({
        map: state.map,
        position,
        title: driver.fullName,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#ef9b28",
          fillOpacity: 0.95,
          strokeColor: driver.isOnline ? "#1f7a42" : "#b53a2d",
          strokeWeight: 3
        }
      });
      marker.addListener("click", () => {
        state.infoWindow?.setContent(
          `<strong>${driver.fullName}</strong><br>${driver.vehicle}<br>${formatAdminStatus(driver.approvalStatus)}`
        );
        state.infoWindow?.open({
          anchor: marker,
          map: state.map
        });
      });
      state.markers.set(driver.id, marker);
      points.push(position);
    });

  if (points.length) {
    if (points.length === 1) {
      state.map.setCenter(points[0]);
      state.map.setZoom(14);
    } else {
      const bounds = new google.maps.LatLngBounds();
      points.forEach((point) => bounds.extend(point));
      state.map.fitBounds(bounds, 80);
    }
    setText(
      elements.mapSummary,
      `Google live map tracking ${points.length} approved driver location${points.length === 1 ? "" : "s"}.`
    );
  } else {
    state.map.setCenter(DEFAULT_CENTER);
    state.map.setZoom(11);
    setText(elements.mapSummary, "Google live map is ready, but no approved drivers have shared coordinates yet.");
  }
}

async function loadDriverDocuments(driverId) {
  const payload = await api.adminDriverDocuments(driverId);
  elements.documents.innerHTML = "";

  const title = document.createElement("div");
  title.className = "document-item";
  title.innerHTML = `
    <strong>${payload.driver.fullName}</strong>
    <p>Face photo: ${payload.driver.facePhotoUrl ? `<a href="${payload.driver.facePhotoUrl}" target="_blank" rel="noreferrer">Open file</a>` : "Not uploaded"}</p>
    <p>Car photo: ${payload.driver.carPhotoUrl ? `<a href="${payload.driver.carPhotoUrl}" target="_blank" rel="noreferrer">Open file</a>` : "Not uploaded"}</p>
  `;
  elements.documents.appendChild(title);

  payload.documents.forEach((document) => {
    const article = document.createElement("article");
    article.className = "document-item";
    article.innerHTML = `
      <strong>${formatDocumentType(document.documentType)}</strong>
      <p>${document.originalName}</p>
      <p>${document.mimeType || "file"}</p>
      <a class="ghost-btn" href="${document.downloadUrl || `/api/admin/documents/${document.id}/download`}" target="_blank" rel="noreferrer">Download</a>
    `;
    elements.documents.appendChild(article);
  });
}

async function assignRide(rideId, driverId) {
  if (!driverId) {
    showBanner(elements.banner, "Select a driver first", "warning");
    return;
  }

  state.pendingActions.assigningRides.add(rideId);
  renderRides();
  try {
    await api.adminAssignRide(rideId, { driverId });
    showBanner(elements.banner, "Ride accepted and assigned", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  } finally {
    state.pendingActions.assigningRides.delete(rideId);
    await refreshAll();
    await loadNotifications();
  }
}

async function rejectRide(rideId) {
  state.pendingActions.cancellingRides.add(rideId);
  renderRides();
  try {
    await api.adminUpdateRideStatus(rideId, { status: "cancelled" });
    showBanner(elements.banner, "Ride request rejected", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  } finally {
    state.pendingActions.cancellingRides.delete(rideId);
    await refreshAll();
    await loadNotifications();
  }
}

function renderDrivers() {
  const drivers = state.dashboard?.drivers || [];
  if (!drivers.length) {
    elements.drivers.innerHTML = "<p>No driver applications yet.</p>";
    return;
  }

  const rows = drivers
    .map(
      (driver) => `
        <tr>
          <td>${driver.fullName}<br><small>${driver.email}</small></td>
          <td>${driver.vehicle}<br><small>${driver.plateNumber}</small></td>
          <td>${formatAdminStatus(driver.approvalStatus)}</td>
          <td>${driver.isOnline ? "Online" : "Offline"}</td>
          <td>${driver.documentCount}</td>
          <td>${getDriverActionMarkup(driver)}</td>
        </tr>
      `
    )
    .join("");

  elements.drivers.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Driver</th>
          <th>Vehicle</th>
          <th>Status</th>
          <th>Live</th>
          <th>Docs</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  elements.drivers.querySelectorAll("[data-docs]").forEach((button) => {
    button.addEventListener("click", () => loadDriverDocuments(button.dataset.docs));
  });

  elements.drivers.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      const driverId = button.dataset.approve;
      const notes = window.prompt("Approval notes (optional)") || "";
      state.pendingActions.approvingDrivers.add(driverId);
      renderDrivers();
      try {
        await api.adminApproveDriver(driverId, { notes });
      } catch (error) {
        showBanner(elements.banner, error.message, "danger");
      } finally {
        state.pendingActions.approvingDrivers.delete(driverId);
        await refreshAll();
      }
    });
  });

  elements.drivers.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", async () => {
      const driverId = button.dataset.reject;
      const notes = window.prompt("Rejection reason") || "Application needs updates before approval.";
      state.pendingActions.rejectingDrivers.add(driverId);
      renderDrivers();
      try {
        await api.adminRejectDriver(driverId, { notes });
      } catch (error) {
        showBanner(elements.banner, error.message, "danger");
      } finally {
        state.pendingActions.rejectingDrivers.delete(driverId);
        await refreshAll();
      }
    });
  });
}

function renderRides() {
  const rides = state.dashboard?.rides || [];
  const approvedDrivers = getApprovedDrivers();

  if (!rides.length) {
    elements.rides.innerHTML = "<p>No rides in the system yet.</p>";
    return;
  }

  const rows = rides
    .map((ride) => {
      const options = approvedDrivers
        .map(
          (driver) =>
            `<option value="${driver.id}" ${ride.driverId === driver.id ? "selected" : ""}>${driver.fullName} - ${driver.vehicle}</option>`
        )
        .join("");

      return `
        <tr>
          <td>${ride.id.slice(0, 8)}</td>
          <td>${ride.customerName}<br><small>${ride.customerPhone || ""}</small></td>
          <td>${ride.originLabel}<br><small>${ride.destinationLabel}</small><br><small>${formatVehicleClass(ride.requestedVehicleClass)}</small></td>
          <td>${formatAdminStatus(ride.status)}</td>
          <td>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)}</td>
          <td>${ride.driverName || "Unassigned"}</td>
          <td>${getRideDispatchMarkup(ride, options)}</td>
        </tr>
      `;
    })
    .join("");

  elements.rides.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Ride</th>
          <th>Customer</th>
          <th>Route</th>
          <th>Status</th>
          <th>Fare</th>
          <th>Driver</th>
          <th>Dispatch</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  elements.rides.querySelectorAll("[data-assign]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rideId = button.dataset.assign;
      const select = elements.rides.querySelector(`[data-driver-select="${rideId}"]`);
      await assignRide(rideId, select?.value || "");
    });
  });

  elements.rides.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      await rejectRide(button.dataset.cancel);
    });
  });
}

function renderNotifications() {
  elements.notifications.innerHTML = "";
  if (!state.notifications.length) {
    elements.notifications.innerHTML = '<div class="notification-item"><p>No operational alerts yet.</p></div>';
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
  state.dashboard = await api.adminDashboard();
  renderSummary();
  renderFareSettings();
  renderDrivers();
  renderRides();
  syncMap();
}

function initSocket() {
  if (state.socket || !state.auth?.authenticated) {
    return;
  }
  state.socket = createSocket();
  if (!state.socket) {
    return;
  }

  state.socket.on("notification:new", async (notification) => {
    playTone("urgent");
    await refreshAll();
    await loadNotifications();
  });

  state.socket.on("ride:updated", async () => {
    await refreshAll();
  });

  state.socket.on("driver:updated", async () => {
    await refreshAll();
  });

  state.socket.on("settings:updated", async (payload) => {
    if (payload?.key === "fare") {
      await refreshAll();
    }
  });
}

async function handleLogin() {
  try {
    showBanner(elements.banner, "Signing in admin", "neutral");
    state.auth = await api.adminLogin({
      email: elements.emailInput.value,
      password: elements.passwordInput.value
    });
    state.auth.authenticated = true;
    renderAuth();
    startSessionKeepAlive();
    initSocket();
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Admin session restored", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

async function bootstrap() {
  attachSiteNav();
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
  renderAuth();
  if (state.auth?.authenticated && state.auth.user.role === "admin") {
    startSessionKeepAlive();
    initSocket();
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Admin console ready", "success");
  } else {
    stopSessionKeepAlive();
    showBanner(elements.banner, "Sign in with the admin credentials from your env file", "neutral");
  }
}

elements.loginBtn.addEventListener("click", handleLogin);
elements.saveFareBtn.addEventListener("click", async () => {
  try {
    state.pendingActions.savingFare = true;
    renderFareSettings();
    await api.adminFareSettings({
      baseFareUgx: Number(elements.fareBase.value),
      bookingFeeUgx: Number(elements.fareBooking.value),
      perKmUgx: Number(elements.farePerKm.value),
      perMinuteUgx: Number(elements.farePerMinute.value),
      minimumFareUgx: Number(elements.fareMinimum.value)
    });
    await refreshAll();
    showBanner(elements.banner, "Fare settings saved", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  } finally {
    state.pendingActions.savingFare = false;
    renderFareSettings();
  }
});
elements.logoutBtn.addEventListener("click", async () => {
  stopSessionKeepAlive();
  await api.logout();
  window.location.reload();
});
window.addEventListener("beforeunload", () => {
  stopSessionKeepAlive();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.auth?.authenticated) {
    void api.keepAlive().catch(() => {});
  }
});

bootstrap().catch((error) => showBanner(elements.banner, error.message, "danger"));
