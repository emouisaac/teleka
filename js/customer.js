import { api } from "./shared/api.js";
import { hasSessionHint, syncSessionHint } from "./shared/session.js";
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
const SESSION_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_ROLE = "customer";

const state = {
  auth: null,
  config: null,
  settings: null,
  dashboard: null,
  notifications: [],
  selectedRideId: null,
  selectedQuote: null,
  selectedVehicleClass: null,
  placeInputs: {
    origin: null,
    destination: null
  },
  socket: null,
  keepAliveId: null,
  map: null,
  mapMarkers: {},
  directionsService: null,
  directionsRenderer: null,
  geocoder: null,
  quoteRequestId: 0,
  requestSheetState: "form",
  pickupAutofillAttempted: false,
  forceVehicleSheet: false
};

const elements = {
  banner: document.querySelector("#customerBanner"),
  siteNav: document.querySelector("#siteNav"),
  siteNavToggle: document.querySelector("#siteNavToggle"),
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
  requestOverlay: document.querySelector("#requestOverlay"),
  selectedTripCard: document.querySelector("#selectedTripCard"),
  selectedTripVisual: document.querySelector("#selectedTripVisual"),
  selectedTripName: document.querySelector("#selectedTripName"),
  selectedTripFare: document.querySelector("#selectedTripFare"),
  bookingWhenGrid: document.querySelector(".booking-when-grid"),
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
  requestFormToggleBtn: document.querySelector("#requestFormToggleBtn"),
  requestMobileShell: document.querySelector("#requestMobileShell"),
  requestPanel: document.querySelector("#requestPanel"),
  pickupDate: document.querySelector("#pickupDate"),
  pickupTime: document.querySelector("#pickupTime"),
  quoteCard: document.querySelector("#quoteCard"),
  mapDriverChatBtn: document.querySelector("#mapDriverChatBtn")
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

function hasSelectedVehicle() {
  if (!state.selectedVehicleClass) {
    return false;
  }

  return getVehicleOptions().some((option) => option.key === state.selectedVehicleClass);
}

function getSelectedEstimate() {
  if (!hasSelectedVehicle()) {
    return null;
  }

  return getVehicleOptions().find((option) => option.key === state.selectedVehicleClass) || null;
}

function getVehiclePreviewImage(option) {
  const imageByKey = {
    mini: { src: "ims/4sit.png", alt: "4-seat vehicle" },
    standard: { src: "ims/Standared.png", alt: "Standard vehicle" },
    premium: { src: "ims/prem.png", alt: "Premium vehicle" },
    suv: { src: "ims/SUV1.png", alt: "SUV vehicle" }
  };

  return imageByKey[option.key] || null;
}

function getVehiclePreviewSvg(option) {
  const iconByKey = {
    mini: {
      fill: "#d88914",
      bodyPath:
        "M20 56 L30 43 C34 37 42 33 51 33 H82 C90 33 96 36 102 41 L112 49 H123 C129 49 134 53 134 59 V64 H18 V59 C18 58 19 57 20 56 Z",
      windowPath: "M42 43 L51 35 H75 V49 H36 Z",
      rearWindowPath: "M78 35 H91 C96 35 101 38 105 43 L108 49 H78 Z"
    },
    standard: {
      fill: "#0e7969",
      bodyPath:
        "M16 56 L27 40 C31 34 40 29 50 29 H98 C108 29 118 33 125 40 L136 48 H148 C154 48 160 53 160 59 V64 H16 Z",
      windowPath: "M39 40 L50 31 H77 V48 H32 Z",
      rearWindowPath: "M80 31 H100 C108 31 115 35 121 40 L126 48 H80 Z"
    },
    premium: {
      fill: "#5b6270",
      bodyPath:
        "M14 56 L25 39 C30 31 41 25 54 25 H112 C124 25 136 30 145 39 L156 48 H168 C174 48 178 53 178 59 V64 H14 Z",
      windowPath: "M40 39 L56 28 H86 V48 H31 Z",
      rearWindowPath: "M90 28 H115 C126 28 134 32 142 39 L148 48 H90 Z"
    },
    suv: {
      fill: "#b7682f",
      bodyPath:
        "M16 56 L25 41 C30 34 39 30 49 30 H105 C117 30 126 33 134 40 L145 48 H157 C163 48 168 53 168 59 V64 H16 Z",
      windowPath: "M38 41 L48 32 H75 V48 H30 Z",
      rearWindowPath: "M78 32 H103 C112 32 119 35 127 41 L132 48 H78 Z"
    }
  };

  const icon = iconByKey[option.key] || iconByKey.standard;

  return `
    <svg class="vehicle-svg" viewBox="0 0 192 84" aria-hidden="true" focusable="false">
      <rect x="18" y="18" width="156" height="50" rx="18" fill="rgba(27, 26, 23, 0.05)"></rect>
      <path d="${icon.bodyPath}" fill="${icon.fill}" stroke="rgba(27, 26, 23, 0.16)" stroke-width="2"></path>
      <path d="${icon.windowPath}" fill="#e8f2fb"></path>
      <path d="${icon.rearWindowPath}" fill="#d6e7f6"></path>
      <circle cx="54" cy="64" r="10" fill="#1d2126"></circle>
      <circle cx="54" cy="64" r="4" fill="#9ca6b2"></circle>
      <circle cx="122" cy="64" r="10" fill="#1d2126"></circle>
      <circle cx="122" cy="64" r="4" fill="#9ca6b2"></circle>
      <rect x="146" y="52" width="9" height="5" rx="2.5" fill="#fff0b8"></rect>
      <rect x="21" y="54" width="8" height="4" rx="2" fill="#b53a2d"></rect>
    </svg>
  `;
}

function getVehiclePreviewMarkup(option) {
  const image = getVehiclePreviewImage(option);
  if (image) {
    return `<img class="vehicle-image" src="${image.src}" alt="${image.alt}">`;
  }
  return getVehiclePreviewSvg(option);
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

function hasPickupSchedule() {
  return Boolean(elements.pickupDate?.value && elements.pickupTime?.value);
}

function setRequestSheetState(nextState) {
  state.requestSheetState = nextState;
  if (!elements.requestPanel) {
    return;
  }
  elements.requestPanel.dataset.sheetState = nextState;
}

function syncRequestSheetState({ focusEstimate = false } = {}) {
  const activeRide = getActiveRide();
  const rideIsLive = ["assigned", "accepted", "in_progress"].includes(activeRide?.status);
  let nextState = "form";

  if (rideIsLive || elements.requestPanel?.dataset.dashboardMode === "tracking") {
    nextState = "tracking";
  } else if (state.selectedQuote && getSelectedEstimate()) {
    nextState = "estimate";
  } else if (state.selectedQuote || state.forceVehicleSheet) {
    nextState = "vehicle";
  }

  const changed = state.requestSheetState !== nextState;
  setRequestSheetState(nextState);

  if (
    focusEstimate &&
    nextState === "estimate" &&
    changed &&
    elements.quoteCard?.scrollIntoView
  ) {
    elements.quoteCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function scrollRequestOverlayTo(target, { offset = 0 } = {}) {
  if (!target || !elements.requestOverlay) {
    return;
  }

  const overlayRect = elements.requestOverlay.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextScrollTop =
    elements.requestOverlay.scrollTop +
    (targetRect.top - overlayRect.top) -
    offset;

  elements.requestOverlay.scrollTo({
    top: Math.max(0, nextScrollTop),
    behavior: "smooth"
  });
}

function syncMapRideActions(ride) {
  if (!elements.mapDriverChatBtn) {
    return;
  }

  const canChat = ["assigned", "accepted", "in_progress"].includes(ride?.status);
  elements.mapDriverChatBtn.hidden = !canChat;
  if (!canChat) {
    return;
  }

  elements.mapDriverChatBtn.textContent = ride?.driverName
    ? `Chat ${ride.driverName}`
    : "Driver chat";
}

function buildPickupScheduleNote() {
  if (!hasPickupSchedule()) {
    return "";
  }

  const date = elements.pickupDate.value;
  const time = elements.pickupTime.value;
  return `Pickup schedule: ${date} ${time}`;
}

function canChooseVehicle() {
  return Boolean(state.selectedQuote);
}

function revealVehicleSelection() {
  if (!elements.vehicleOptions || !elements.requestOverlay) {
    return;
  }

  if (window.innerWidth <= 720 && elements.requestMobileShell && !elements.requestMobileShell.classList.contains("open")) {
    setRequestFormOpen(true);
  }

  state.forceVehicleSheet = true;
  setRequestSheetState("vehicle");
  elements.requestPanel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  document.activeElement?.blur?.();

  const reveal = () => {
    scrollRequestOverlayTo(elements.vehicleOptions, { offset: 72 });
  };

  reveal();
  window.requestAnimationFrame(reveal);
  window.setTimeout(reveal, 180);
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
}

function focusBookingAction() {
  if (elements.requestOverlay && elements.bookingWhenGrid) {
    scrollRequestOverlayTo(elements.bookingWhenGrid, { offset: 28 });
  } else {
    elements.requestOverlay?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  elements.requestPanel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 160);
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 420);
}

function updateRequestButton() {
  const isSignedInCustomer =
    state.auth?.authenticated &&
    state.auth.user?.role === "customer";
  const canRequest =
    isSignedInCustomer &&
    Boolean(state.selectedQuote) &&
    hasPickupSchedule() &&
    hasSelectedVehicle();

  elements.submitRideBtn.disabled = !canRequest;
  if (canRequest) {
    elements.submitRideBtn.textContent = "Request ride";
    return;
  }

  if (!isSignedInCustomer) {
    elements.submitRideBtn.textContent = "Sign in to request ride";
    return;
  }

  if (!state.selectedQuote) {
    elements.submitRideBtn.textContent = "Set route first";
    return;
  }

  if (!hasSelectedVehicle()) {
    elements.submitRideBtn.textContent = "Choose vehicle type";
    return;
  }

  if (!hasPickupSchedule()) {
    elements.submitRideBtn.textContent = "Select date and time";
    return;
  }

  elements.submitRideBtn.textContent = "Request ride";
}

function renderSelectedTripSummary(selectedEstimate) {
  if (!elements.selectedTripCard || !elements.selectedTripVisual || !elements.selectedTripName || !elements.selectedTripFare) {
    return;
  }

  if (!selectedEstimate) {
    elements.selectedTripCard.classList.add("hidden");
    elements.selectedTripVisual.innerHTML = "";
    setText(elements.selectedTripName, "Choose a trip");
    setText(elements.selectedTripFare, "Fare appears here");
    return;
  }

  elements.selectedTripCard.classList.remove("hidden");
  elements.selectedTripVisual.innerHTML = getVehiclePreviewMarkup(selectedEstimate);
  setText(elements.selectedTripName, selectedEstimate.label);
  setText(elements.selectedTripFare, formatCurrency(selectedEstimate.fareUgx || 0));
}

function renderVehicleOptions() {
  const options = getVehicleOptions();
  const vehicleSelectionReady = canChooseVehicle();
  elements.vehicleOptions.innerHTML = "";

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = !vehicleSelectionReady || !state.selectedQuote;
    button.className = `vehicle-card ${option.key === state.selectedVehicleClass ? "selected" : ""}`;
    button.innerHTML = `
      <span class="vehicle-card-main">
        <span class="vehicle-visual" data-vehicle-key="${option.key}">
          ${getVehiclePreviewMarkup(option)}
        </span>
        <span class="vehicle-copy">
          <span class="vehicle-name">${option.label}</span>
        </span>
      </span>
      <strong class="fare">${option.fareUgx ? formatCurrency(option.fareUgx) : "--"}</strong>
    `;
    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }
      state.selectedVehicleClass = option.key;
      renderQuote();
      focusBookingAction();
    });
    elements.vehicleOptions.appendChild(button);
  });
}

function renderProfile({ restoring = false } = {}) {
  const user = state.auth?.user;
  const signedIn = restoring || (state.auth?.authenticated && user?.role === "customer");

  elements.authCard.classList.toggle("hidden", signedIn);
  elements.profileMini.classList.toggle("hidden", !signedIn);
  elements.logoutBtn.hidden = !signedIn;
  if (restoring) {
    setText(elements.authState, "Restoring session");
    setText(elements.accessTitle, "Restoring account");
    setText(elements.name, "Customer");
    setText(elements.email, "Restoring your saved account...");
    elements.avatar.src = "ims/ticon.png";
    elements.authMessage.textContent = "Restoring your saved customer session.";
    elements.googleLoginMount.classList.add("hidden");
    updateRequestButton();
    return;
  }

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

function setRequestFormOpen(isOpen) {
  if (!elements.requestMobileShell || !elements.requestFormToggleBtn) {
    return;
  }

  if (window.innerWidth > 720) {
    elements.requestMobileShell.classList.remove("open");
    elements.requestFormToggleBtn.setAttribute("aria-expanded", "false");
    elements.requestFormToggleBtn.textContent = "Request a ride";
    return;
  }

  elements.requestMobileShell.classList.toggle("open", isOpen);
  elements.requestFormToggleBtn.setAttribute("aria-expanded", String(isOpen));
  elements.requestFormToggleBtn.textContent = isOpen ? "Close request form" : "Request a ride";
}

function attachRequestFormToggle() {
  if (!elements.requestMobileShell || !elements.requestFormToggleBtn) {
    return;
  }

  setRequestFormOpen(false);

  elements.requestFormToggleBtn.addEventListener("click", () => {
    const willOpen = !elements.requestMobileShell.classList.contains("open");
    setRequestFormOpen(willOpen);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 720) {
      setRequestFormOpen(false);
    }
  });
}

function renderQuote() {
  const quote = state.selectedQuote;
  const selectedEstimate = getSelectedEstimate();

  if (!quote) {
    state.selectedVehicleClass = null;
    setText(elements.quoteDistance, "-");
    setText(elements.quoteDuration, "-");
    setText(elements.quoteFare, formatCurrency(0));
    elements.selectedVehicleHint.textContent = state.forceVehicleSheet
      ? "Trip choices are opening. As soon as the route is ready, choose the vehicle you want."
      : "Enter destination to reveal the available trip choices.";
    renderSelectedTripSummary(null);
    renderVehicleOptions();
    updateRequestButton();
    syncRequestSheetState();
    return;
  }

  setText(elements.quoteDistance, `${(quote.distanceMeters / 1000).toFixed(1)} km`);
  setText(elements.quoteDuration, `${Math.round(quote.durationSeconds / 60)} mins`);
  setText(elements.quoteFare, selectedEstimate ? formatCurrency(selectedEstimate.fareUgx) : "Choose vehicle");

  if (!selectedEstimate) {
    elements.selectedVehicleHint.textContent =
      "Choose a vehicle type now. You can set date and time just above the request button.";
    updateEstimateState("Choose vehicle type");
  } else if (!hasPickupSchedule()) {
    elements.selectedVehicleHint.textContent =
      `${selectedEstimate.label} selected. Set pickup date and time above the request button.`;
    updateEstimateState("Add date and time");
  } else {
    elements.selectedVehicleHint.textContent = `${selectedEstimate.label} selected. Review the map and request your ride.`;
    updateEstimateState("Ready to request");
  }

  renderSelectedTripSummary(selectedEstimate);
  renderVehicleOptions();
  updateRequestButton();
  syncRequestSheetState({ focusEstimate: Boolean(selectedEstimate) });
}

function renderRouteSteps(steps = []) {
  if (!elements.routeSteps) {
    return;
  }

  elements.routeSteps.hidden = true;
  elements.routeSteps.innerHTML = "";
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
      state.selectedVehicleClass = null;
      revealVehicleSelection();
      void refreshQuote({ silentErrors: true }).then(() => {
        revealVehicleSelection();
      });
    });
    elements.recentPlaces.appendChild(button);
  });
}

function formatCustomerRideStatus(ride) {
  if (ride?.status === "pending_admin" && !ride?.driverName) {
    return "finding nearby drivers";
  }
  return String(ride?.status || "pending_admin").replaceAll("_", " ");
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
        <span class="pill">${formatCustomerRideStatus(ride)}</span>
      </div>
      <p>${formatCurrency(ride.finalFareUgx || ride.quotedFareUgx)} | ${Math.round((ride.distanceMeters || 0) / 1000)} km</p>
      <p>${ride.requestedVehicleClass || "standard"} | ${ride.driverName ? `Driver: ${ride.driverName} (${ride.driverPlateNumber || ride.driverVehicle || "assigned"})` : "Nearby drivers are being notified"}</p>
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

async function refreshPublicSettings() {
  state.settings = await api.publicSettings().catch(() => state.settings);
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

function getStopMarkerStyle(labelText, fillColor) {
  return {
    label: {
      text: labelText,
      color: "#ffffff",
      fontWeight: "700",
      fontSize: "13px"
    },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 12,
      fillColor,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 3
    }
  };
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

  const mapNode = state.map.getDiv();
  const mapRect = mapNode?.getBoundingClientRect?.();
  const overlayRect = elements.requestOverlay?.getBoundingClientRect?.();
  const overlayObstructionHeight =
    mapRect && overlayRect
      ? Math.max(0, Math.min(mapRect.height, mapRect.bottom - Math.max(mapRect.top, overlayRect.top)))
      : 0;
  const bottomPadding = overlayObstructionHeight
    ? Math.min((mapRect?.height || 0) - 80, overlayObstructionHeight + 92)
    : 120;
  const upwardShift = overlayObstructionHeight
    ? Math.max(56, Math.min(132, Math.round(overlayObstructionHeight * 0.22)))
    : 64;

  state.map.fitBounds(bounds, {
    top: 96,
    right: 80,
    bottom: bottomPadding,
    left: 80
  });

  google.maps.event.addListenerOnce(state.map, "idle", () => {
    state.map?.panBy?.(0, -upwardShift);
  });
}

async function renderQuoteMap(quote) {
  if (!quote) {
    syncMapRideActions(null);
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
    ...getStopMarkerStyle("A", "#0e7969"),
    title: `Point A: ${quote.origin.label}`
  });
  placeMarker("destination", destination, {
    ...getStopMarkerStyle("B", "#ef9b28"),
    title: `Point B: ${quote.destination.label}`
  });
  fitMapToPoints([origin, destination]);

  setText(elements.activeRideStatus, "Route preview");
  setText(
    elements.activeRideSummary,
    `${quote.origin.label} to ${quote.destination.label}. ${(
      quote.distanceMeters / 1000
    ).toFixed(1)} km, about ${Math.round(quote.durationSeconds / 60)} mins.`
  );
  syncMapRideActions(null);
}

async function renderActiveRideMap(ride) {
  ensureMap();
  if (!state.map) {
    syncMapRideActions(ride);
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
    placeMarker("origin", origin, {
      ...getStopMarkerStyle("A", "#0e7969"),
      title: `Point A: ${ride.originLabel}`
    });
  }

  if (Number.isFinite(destination.lat) && Number.isFinite(destination.lng)) {
    points.push(destination);
    placeMarker("destination", destination, {
      ...getStopMarkerStyle("B", "#ef9b28"),
      title: `Point B: ${ride.destinationLabel}`
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
  syncMapRideActions(ride);
}

async function syncMapInternal() {
  if (state.selectedQuote) {
    await renderQuoteMap(state.selectedQuote);
    syncRequestSheetState();
    return;
  }

  const activeRide = getActiveRide();
  if (activeRide) {
    await renderActiveRideMap(activeRide);
    syncRequestSheetState();
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
  syncMapRideActions(null);
  syncRequestSheetState();
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
    const selectedEstimate = estimates.find((estimate) => estimate.key === state.selectedVehicleClass) || null;

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
      vehicleClass: selectedEstimate?.key || null,
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
    renderQuote();
    syncMap();
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
      state.selectedVehicleClass = null;
      state.forceVehicleSheet = false;
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

function attachScheduleInputs() {
  [elements.pickupDate, elements.pickupTime].forEach((input) => {
    if (!input) {
      return;
    }

    input.addEventListener("input", () => {
      renderQuote();
    });

    input.addEventListener("change", () => {
      renderQuote();
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
      if (key === "origin" || key === "destination") {
        state.selectedVehicleClass = null;
      }
      if (key === "destination") {
        revealVehicleSelection();
      }
      void refreshQuote({ silentErrors: true }).then(() => {
        if (key === "destination") {
          revealVehicleSelection();
        }
      });
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

  state.socket.on("settings:updated", async (payload) => {
    if (payload?.key !== "fare") {
      return;
    }
    await refreshPublicSettings();
    await refreshQuote({ silentErrors: true });
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
    syncSessionHint(SESSION_ROLE, true);
    startSessionKeepAlive();
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

    if (!hasPickupSchedule()) {
      throw new Error("Select pickup date and time before requesting a ride");
    }

    const scheduleNote = buildPickupScheduleNote();
    const combinedNotes = [scheduleNote, elements.customerNotes.value.trim()]
      .filter(Boolean)
      .join(" | ");

    const payload = await api.createRide({
      origin,
      destination,
      vehicleClass: state.selectedVehicleClass,
      paymentMethod: elements.paymentMethod.value,
      customerNotes: combinedNotes
    });

    state.selectedRideId = payload.ride.id;
    state.selectedQuote = null;
    state.selectedVehicleClass = null;
    await loadDashboard();
    await loadNotifications();
    if (window.telekaDashboard?.showDashboard) {
      window.telekaDashboard.showDashboard("requestPanel", {
        navKey: "mapPanel",
        mode: "tracking",
        title: "Track Ride",
        copy: "Open the ride tracking dashboard to focus on the live map, route updates, and latest driver status."
      });
    }
    if (elements.requestPanel) {
      elements.requestPanel.dataset.dashboardMode = "tracking";
    }
    syncRequestSheetState();
    updateEstimateState("Sent to nearby drivers");
    showBanner(elements.banner, "Ride request sent to nearby drivers", "success");
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

async function autofillPickupFromCurrentLocation({
  announceSuccess = false,
  silentFailure = true
} = {}) {
  if (state.pickupAutofillAttempted || !elements.pickupInput) {
    return false;
  }

  state.pickupAutofillAttempted = true;

  if (!navigator.geolocation) {
    if (!silentFailure) {
      showBanner(elements.banner, "Geolocation is not available in this browser", "danger");
    }
    return false;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          if (elements.pickupInput.value.trim() && !state.placeInputs.origin) {
            resolve(false);
            return;
          }

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
          if (announceSuccess) {
            showBanner(elements.banner, "Pickup filled from your current location", "success");
          }
          resolve(true);
        } catch (error) {
          if (!silentFailure) {
            showBanner(elements.banner, error.message, "danger");
          }
          resolve(false);
        }
      },
      () => {
        if (!silentFailure) {
          showBanner(elements.banner, "Unable to read your location", "danger");
        }
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function attachPickupAutofillTriggers() {
  const triggerAutofill = () => {
    void autofillPickupFromCurrentLocation();
  };

  [elements.pickupInput, elements.destinationInput].forEach((input) => {
    input?.addEventListener("focus", triggerAutofill, { once: true });
    input?.addEventListener("pointerdown", triggerAutofill, { once: true });
  });
}

window.telekaCustomerAutofillPickup = () => {
  void autofillPickupFromCurrentLocation();
};

function openDriverChatFromMap() {
  if (window.telekaDashboard?.showDashboard) {
    window.telekaDashboard.showDashboard("chatPanel", {
      navKey: "chatPanel",
      title: "Ride Chat",
      copy: "Open the messaging dashboard when you need to coordinate pickup details with your assigned driver."
    });
  }

  if (elements.messageInput?.focus) {
    window.setTimeout(() => elements.messageInput.focus(), 160);
  }
}

async function bootstrap() {
  showBanner(elements.banner, "Loading customer workspace", "neutral");
  const authStatusPromise = api.authStatus();
  const configPromise = api.publicConfig();
  const settingsPromise = api.publicSettings().catch(() => null);

  attachSiteNav();
  attachRequestFormToggle();
  attachLocationInputs();
  attachScheduleInputs();
  attachPickupAutofillTriggers();
  renderVehicleOptions();
  renderQuote();

  if (hasSessionHint(SESSION_ROLE)) {
    renderProfile({ restoring: true });
    showBanner(elements.banner, "Restoring customer session", "neutral");
  }

  state.auth = await authStatusPromise;
  const signedIn = state.auth?.authenticated && state.auth.user?.role === "customer";
  syncSessionHint(SESSION_ROLE, signedIn);
  state.config = await configPromise;
  state.settings = await settingsPromise;

  if (state.config?.googleMapsApiKey) {
    try {
      await loadGoogleMaps(state.config.googleMapsApiKey);
      ensureMap();
      attachGooglePlaces();
      if (elements.requestPanel?.classList.contains("active-dashboard")) {
        await autofillPickupFromCurrentLocation();
      }
    } catch (error) {
      showBanner(elements.banner, error.message, "warning");
    }
  }

  renderProfile();
  initGoogleButton();

  if (signedIn) {
    startSessionKeepAlive();
    initSocket();
    await loadDashboard();
    await loadNotifications();
    await refreshQuote({ silentErrors: true });
  } else {
    stopSessionKeepAlive();
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
  stopSessionKeepAlive();
  syncSessionHint(SESSION_ROLE, false);
  await api.logout();
  window.location.reload();
});
elements.mapDriverChatBtn?.addEventListener("click", openDriverChatFromMap);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.auth?.authenticated) {
    void api.keepAlive().catch(() => {});
  }
});
window.addEventListener("beforeunload", () => {
  stopSessionKeepAlive();
});

bootstrap().catch((error) => {
  showBanner(elements.banner, error.message, "danger");
});
