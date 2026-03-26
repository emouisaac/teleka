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
  socket: null,
  map: null,
  markers: new Map()
};

const elements = {
  banner: document.querySelector("#adminBanner"),
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

function ensureMap() {
  if (state.map || !window.L) {
    return;
  }
  state.map = L.map("adminMap", { zoomControl: false }).setView([0.3136, 32.5811], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.map);
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
}

function syncMap() {
  ensureMap();
  if (!state.map) {
    return;
  }

  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  const drivers = state.dashboard?.drivers || [];
  const points = [];

  drivers
    .filter((driver) => Number.isFinite(driver.currentLat) && Number.isFinite(driver.currentLng))
    .forEach((driver) => {
      const marker = L.circleMarker([driver.currentLat, driver.currentLng], {
        radius: 9,
        color: driver.isOnline ? "#1f7a42" : "#b53a2d",
        fillColor: "#ef9b28",
        fillOpacity: 0.9
      }).addTo(state.map);
      marker.bindPopup(`${driver.fullName}<br>${driver.vehicle}<br>${driver.approvalStatus}`);
      state.markers.set(driver.id, marker);
      points.push([driver.currentLat, driver.currentLng]);
    });

  if (points.length) {
    state.map.fitBounds(points, { padding: [40, 40] });
    setText(elements.mapSummary, `${points.length} driver locations plotted.`);
  } else {
    setText(elements.mapSummary, "No live driver coordinates available yet.");
  }
}

async function loadDriverDocuments(driverId) {
  const payload = await api.adminDriverDocuments(driverId);
  elements.documents.innerHTML = "";

  const title = document.createElement("div");
  title.className = "document-item";
  title.innerHTML = `<strong>${payload.driver.fullName}</strong><p>Face photo: ${payload.driver.facePhotoPath || "Not uploaded"}</p><p>Car photo: ${payload.driver.carPhotoPath || "Not uploaded"}</p>`;
  elements.documents.appendChild(title);

  payload.documents.forEach((document) => {
    const article = document.createElement("article");
    article.className = "document-item";
    article.innerHTML = `
      <strong>${document.originalName}</strong>
      <p>${document.mimeType || "file"}</p>
      <a class="ghost-btn" href="/api/admin/documents/${document.id}/download">Download</a>
    `;
    elements.documents.appendChild(article);
  });
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
          <td>${driver.approvalStatus}</td>
          <td>${driver.isOnline ? "Online" : "Offline"}</td>
          <td>${driver.documentCount}</td>
          <td>
            <div class="table-actions">
              <button class="secondary-btn" data-docs="${driver.id}">Docs</button>
              <button class="primary-btn" data-approve="${driver.id}">Approve</button>
              <button class="ghost-btn" data-reject="${driver.id}">Reject</button>
            </div>
          </td>
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
      const notes = window.prompt("Approval notes (optional)") || "";
      await api.adminApproveDriver(button.dataset.approve, { notes });
      await refreshAll();
    });
  });

  elements.drivers.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", async () => {
      const notes = window.prompt("Rejection reason") || "Application needs updates before approval.";
      await api.adminRejectDriver(button.dataset.reject, { notes });
      await refreshAll();
    });
  });
}

function renderRides() {
  const rides = state.dashboard?.rides || [];
  const approvedDrivers = (state.dashboard?.drivers || []).filter(
    (driver) => driver.approvalStatus === "approved"
  );

  if (!rides.length) {
    elements.rides.innerHTML = "<p>No rides in the system yet.</p>";
    return;
  }

  const rows = rides
    .map((ride) => {
      const options = approvedDrivers
        .map(
          (driver) =>
            `<option value="${driver.id}" ${ride.driverId === driver.id ? "selected" : ""}>${driver.fullName} • ${driver.vehicle}</option>`
        )
        .join("");

      return `
        <tr>
          <td>${ride.id.slice(0, 8)}</td>
          <td>${ride.customerName}<br><small>${ride.customerPhone || ""}</small></td>
          <td>${ride.originLabel}<br><small>${ride.destinationLabel}</small></td>
          <td>${ride.status}</td>
          <td>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)}</td>
          <td>${ride.driverName || "Unassigned"}</td>
          <td>
            <div class="table-actions">
              <select data-driver-select="${ride.id}">
                <option value="">Select driver</option>
                ${options}
              </select>
              <button class="primary-btn" data-assign="${ride.id}">Assign</button>
              <button class="ghost-btn" data-cancel="${ride.id}">Cancel</button>
            </div>
          </td>
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
      const select = elements.rides.querySelector(`[data-driver-select="${button.dataset.assign}"]`);
      const driverId = select.value;
      if (!driverId) {
        showBanner(elements.banner, "Select a driver first", "warning");
        return;
      }
      await api.adminAssignRide(button.dataset.assign, { driverId });
      await refreshAll();
    });
  });

  elements.rides.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api.adminUpdateRideStatus(button.dataset.cancel, { status: "cancelled" });
      await refreshAll();
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
  state.socket.on("notification:new", async () => {
    playTone("urgent");
    await loadNotifications();
  });
  state.socket.on("ride:updated", async () => {
    playTone("default");
    await refreshAll();
  });
  state.socket.on("driver:updated", async () => {
    await refreshAll();
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
    initSocket();
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Admin session restored", "success");
  } catch (error) {
    showBanner(elements.banner, error.message, "danger");
  }
}

async function bootstrap() {
  state.auth = await api.authStatus();
  renderAuth();
  if (state.auth?.authenticated && state.auth.user.role === "admin") {
    initSocket();
    await refreshAll();
    await loadNotifications();
    showBanner(elements.banner, "Admin console ready", "success");
  } else {
    showBanner(elements.banner, "Sign in with the admin credentials from your env file", "neutral");
  }
}

elements.loginBtn.addEventListener("click", handleLogin);
elements.saveFareBtn.addEventListener("click", async () => {
  try {
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
  }
});
elements.logoutBtn.addEventListener("click", async () => {
  await api.logout();
  window.location.reload();
});

bootstrap().catch((error) => showBanner(elements.banner, error.message, "danger"));
