const navbarToggle = document.querySelector('.navbar-toggle');
const navbarMenu = document.querySelector('.navbar-menu');

if (navbarToggle && navbarMenu) {
  navbarToggle.addEventListener('click', () => {
    navbarMenu.classList.toggle('active');
    navbarToggle.classList.toggle('active');
  });
}

const STORAGE_KEYS = {
  customerId: 'telekaCustomerId',
  customerProfile: 'telekaCustomerProfile',
  darkMode: 'darkMode',
};

const customerState = {
  customerId: localStorage.getItem(STORAGE_KEYS.customerId) || '',
  profile: loadStoredProfile(),
  activeRide: null,
  rides: [],
  eventSource: null,
};

function loadStoredProfile() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.customerProfile) || '{}');
  } catch {
    return {};
  }
}

function saveStoredProfile(profile) {
  localStorage.setItem(STORAGE_KEYS.customerProfile, JSON.stringify(profile));
}

function showMessage(message) {
  window.alert(message);
}

function formatUGX(amount) {
  return new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: 'UGX',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || `Request failed: ${response.status}`);
  }
  return payload.data;
}

function setCurrentDate() {
  const dateEl = document.getElementById('current-date');
  if (!dateEl) return;
  const now = new Date();
  dateEl.textContent = now.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function initDarkMode() {
  const toggle = document.querySelector('#dark-mode-toggle');
  const stored = localStorage.getItem(STORAGE_KEYS.darkMode);
  const shouldUseDark = stored !== null
    ? stored === 'true'
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  document.body.classList.toggle('dark-mode', shouldUseDark);
  if (toggle) {
    toggle.checked = shouldUseDark;
    toggle.addEventListener('change', () => {
      document.body.classList.toggle('dark-mode', toggle.checked);
      localStorage.setItem(STORAGE_KEYS.darkMode, String(toggle.checked));
    });
  }
}

function initHeroSlider() {
  const slides = document.querySelectorAll('.hero-content h1');
  if (!slides.length) return;
  let current = 0;
  slides[current].classList.add('active');
  slides[current].style.color = 'orange';

  setInterval(() => {
    slides[current].classList.remove('active');
    slides[current].classList.add('exit');
    slides[current].style.color = '';
    current = (current + 1) % slides.length;
    slides[current].classList.remove('exit');
    slides[current].classList.add('active');
    slides[current].style.color = 'orange';
  }, 3000);
}

function switchSection(sectionId) {
  document.querySelectorAll('.content .section').forEach((section) => {
    section.classList.toggle('active', section.id === sectionId);
  });

  const otherSections = document.querySelectorAll('.services, .features, .contact');
  otherSections.forEach((section) => {
    section.style.display = sectionId === 'dashboard' ? 'block' : 'none';
  });

  if (sectionId === 'request') {
    initRideRequest();
  }

  if (navbarMenu && navbarToggle) {
    navbarMenu.classList.remove('active');
    navbarToggle.classList.remove('active');
  }
}

window.switchSection = switchSection;

let googleUser = null;
let googleSignInInitialized = false;

function setAuthState(user) {
  googleUser = user;
  const authLink = document.getElementById('auth-action');
  if (!authLink) return;
  authLink.textContent = user ? 'Logout' : 'Login';
  authLink.classList.toggle('logout', Boolean(user));
  authLink.classList.toggle('login', !user);
}

function initGoogleSignIn() {
  if (!window.google || !google.accounts || !google.accounts.id) return;
  if (!window.GOOGLE_CLIENT_ID || window.GOOGLE_CLIENT_ID.includes('{{')) return;

  google.accounts.id.initialize({
    client_id: window.GOOGLE_CLIENT_ID,
    callback: (response) => {
      try {
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        const profile = {
          name: payload.name || customerState.profile.name || '',
          email: payload.email || customerState.profile.email || '',
          phone: customerState.profile.phone || '',
        };
        hydrateProfileForm(profile);
        customerState.profile = profile;
        saveStoredProfile(profile);
        setAuthState({ name: profile.name, email: profile.email });
        syncCustomerProfile().catch(console.warn);
      } catch (error) {
        console.warn('Failed to parse Google credential', error);
      }
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  googleSignInInitialized = true;
}

function handleAuthClick(event) {
  event.preventDefault();
  if (googleUser) {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
    setAuthState(null);
    showMessage('Logged out successfully.');
    return;
  }

  if (!googleSignInInitialized) {
    initGoogleSignIn();
  }

  if (googleSignInInitialized && window.google?.accounts?.id) {
    google.accounts.id.prompt();
  } else {
    showMessage('Google login is not configured for this environment.');
  }
}

window.handleAuthClick = handleAuthClick;

async function syncCustomerProfile() {
  const formProfile = getProfileFromForm();
  const payload = {
    customerId: customerState.customerId || undefined,
    ...formProfile,
  };
  const customer = await apiFetch('/api/customers/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  customerState.customerId = customer.id;
  customerState.profile = {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
  };
  localStorage.setItem(STORAGE_KEYS.customerId, customer.id);
  saveStoredProfile(customerState.profile);
  hydrateProfileForm(customerState.profile);
  await refreshCustomerState();
  ensureEventStream();
  return customer;
}

function getProfileFromForm() {
  return {
    name: document.getElementById('customer-name')?.value.trim() || customerState.profile.name || '',
    email: document.getElementById('customer-email')?.value.trim() || customerState.profile.email || '',
    phone: document.getElementById('customer-phone')?.value.trim() || customerState.profile.phone || '',
  };
}

function hydrateProfileForm(profile) {
  const nameInput = document.getElementById('customer-name');
  const emailInput = document.getElementById('customer-email');
  const phoneInput = document.getElementById('customer-phone');
  if (nameInput) nameInput.value = profile.name || '';
  if (emailInput) emailInput.value = profile.email || '';
  if (phoneInput) phoneInput.value = profile.phone || '';
}

async function refreshCustomerState() {
  if (!customerState.customerId) return;
  const data = await apiFetch(`/api/customer/state?customerId=${encodeURIComponent(customerState.customerId)}`);
  customerState.activeRide = data.activeRide;
  customerState.rides = data.rides || [];
  renderCustomerState(data);
}

function renderCustomerState(data) {
  const rides = data.rides || [];
  const activeRide = data.activeRide;

  const upcomingEl = document.getElementById('upcoming-ride-status');
  if (upcomingEl) {
    upcomingEl.textContent = activeRide
      ? `${activeRide.status.toUpperCase()}: ${activeRide.pickup} to ${activeRide.dropoff}`
      : 'No rides scheduled';
  }

  const totalRidesEl = document.getElementById('total-rides-count');
  if (totalRidesEl) {
    totalRidesEl.textContent = String(rides.length);
  }

  const balanceEl = document.getElementById('account-balance');
  if (balanceEl) {
    const spend = rides
      .filter((ride) => ride.status === 'completed')
      .reduce((sum, ride) => sum + (ride.fare || 0), 0);
    balanceEl.textContent = formatUGX(spend);
  }

  const historyBody = document.getElementById('ride-history-body');
  if (!historyBody) return;
  historyBody.innerHTML = '';

  if (!rides.length) {
    historyBody.innerHTML = '<tr><td colspan="5">No rides yet.</td></tr>';
    return;
  }

  rides.forEach((ride) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(ride.createdAt).toLocaleString()}</td>
      <td>${ride.pickup}</td>
      <td>${ride.dropoff}</td>
      <td>${formatUGX(ride.fare)}</td>
      <td>${ride.status}</td>
    `;
    historyBody.appendChild(row);
  });
}

function ensureEventStream() {
  if (customerState.eventSource) return;
  const eventSource = new EventSource('/api/events');
  eventSource.addEventListener('state-update', () => {
    if (customerState.customerId) {
      refreshCustomerState().catch(console.warn);
    }
  });
  eventSource.onerror = () => {
    eventSource.close();
    customerState.eventSource = null;
    setTimeout(ensureEventStream, 3000);
  };
  customerState.eventSource = eventSource;
}

function initProfileForm() {
  hydrateProfileForm(customerState.profile);
  const profileForm = document.getElementById('customer-profile-form');
  if (!profileForm) return;
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await syncCustomerProfile();
      showMessage('Profile updated.');
    } catch (error) {
      showMessage(error.message);
    }
  });
}

function initSettingsForm() {
  const settingsForm = document.querySelector('.settings-form');
  if (!settingsForm) return;
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    showMessage('Settings saved on this device.');
  });
}

function addServiceIcons() {
  const serviceCards = document.querySelectorAll('.service-card');
  const icons = {
    'Airport Transfers': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>',
    'City Rides': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>',
    'Business Travel': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M20 7h-4V5l-2-2h-4L8 5v2H4c-1.1 0-2 .9-2 2v5c0 .75.4 1.38 1 1.73V19c0 1.11.89 2 2 2h14c1.11 0 2-.89 2-2v-3.27c.59-.36 1-.98 1-1.73V9c0-1.1-.9-2-2-2zM10 5h4v2h-4V5zM4 9h16v5h-5v-3H9v3H4V9zm9 6h-2v1h-2v-1H9v-1h2v1zm4 4H7v-1h1v-1h8v1h1v1z"/></svg>',
    'Tours Travel': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 1.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-1.1L3 19V6.5l6-1.1 6 1.1V19zm3-14.5V17l-5-.9V5.1l5-.9z"/></svg>',
  };

  serviceCards.forEach((card) => {
    const title = card.querySelector('h3')?.textContent.trim();
    const iconDiv = card.querySelector('.service-icon');
    if (iconDiv && title && icons[title]) {
      iconDiv.innerHTML = icons[title];
    }
  });
}

function initFooterToggles() {
  document.querySelectorAll('.footer-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      toggle.nextElementSibling?.classList.toggle('active');
    });
  });
}

const DEFAULT_CENTER = { lat: 0.3476, lng: 32.5825 };
let map;
let directionsService;
let directionsRenderer;
let pickupMarker;
let dropoffMarker;
let rideRequestInitialized = false;

function estimateFare(distanceMeters, carType) {
  const distanceKm = distanceMeters / 1000;
  const baseFare = 3000;
  const perKm = 1800;
  let multiplier = 1;
  if (carType === 'premium') multiplier = 1.4;
  if (carType === 'suv') multiplier = 1.75;
  return Math.round((baseFare + perKm * distanceKm) * multiplier);
}

function updateRouteAndFare(origin, destination) {
  if (!origin || !destination || !directionsService || !directionsRenderer) return;

  directionsService.route(
    {
      origin,
      destination,
      travelMode: google.maps.TravelMode.DRIVING,
    },
    (result, status) => {
      if (status !== 'OK' || !result) return;

      directionsRenderer.setDirections(result);
      const leg = result.routes[0].legs[0];
      const distanceMeters = leg.distance.value;
      const carType = document.getElementById('car-type')?.value || 'standard';
      const fare = estimateFare(distanceMeters, carType);
      const fareEl = document.getElementById('fare-amount');
      if (fareEl) {
        fareEl.textContent = formatUGX(fare);
      }

      const startLoc = leg.start_location;
      const endLoc = leg.end_location;

      if (pickupMarker) pickupMarker.setPosition(startLoc);
      else pickupMarker = new google.maps.Marker({ position: startLoc, map, label: 'A' });

      if (dropoffMarker) dropoffMarker.setPosition(endLoc);
      else dropoffMarker = new google.maps.Marker({ position: endLoc, map, label: 'B' });

      map.fitBounds(result.routes[0].bounds, { padding: 60 });
    }
  );
}

function initRideRequest() {
  if (rideRequestInitialized) return;
  if (!window.google || !google.maps) return;

  const mapEl = document.getElementById('map');
  const pickupInput = document.getElementById('pickup-location');
  const dropoffInput = document.getElementById('dropoff-location');
  const rideForm = document.getElementById('ride-form');
  const carTypeSelect = document.getElementById('car-type');

  if (!mapEl || !pickupInput || !dropoffInput || !rideForm) return;

  map = new google.maps.Map(mapEl, {
    center: DEFAULT_CENTER,
    zoom: 12,
    disableDefaultUI: true,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#3c8dbc', strokeWeight: 6 },
  });

  const options = {
    componentRestrictions: { country: 'ug' },
    fields: ['place_id', 'geometry', 'formatted_address', 'name'],
  };

  const pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, options);
  const dropoffAutocomplete = new google.maps.places.Autocomplete(dropoffInput, options);
  let origin = null;
  let destination = null;
  let lastDistanceMeters = 0;

  function tryUpdateRoute() {
    if (!origin || !destination) return;
    directionsService.route(
      { origin, destination, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (status !== 'OK' || !result) return;
        lastDistanceMeters = result.routes[0].legs[0].distance.value;
        updateRouteAndFare(origin, destination);
      }
    );
  }

  pickupAutocomplete.addListener('place_changed', () => {
    const place = pickupAutocomplete.getPlace();
    if (!place.geometry?.location) return;
    origin = place.geometry.location;
    tryUpdateRoute();
  });

  dropoffAutocomplete.addListener('place_changed', () => {
    const place = dropoffAutocomplete.getPlace();
    if (!place.geometry?.location) return;
    destination = place.geometry.location;
    tryUpdateRoute();
  });

  carTypeSelect?.addEventListener('change', () => {
    if (origin && destination) {
      updateRouteAndFare(origin, destination);
    }
  });

  rideForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      if (!origin || !destination) {
        throw new Error('Select both pickup and dropoff from the suggestions.');
      }

      const customer = await syncCustomerProfile();
      const carType = document.getElementById('car-type')?.value || 'standard';
      const fare = estimateFare(lastDistanceMeters, carType);
      await apiFetch('/api/rides', {
        method: 'POST',
        body: JSON.stringify({
          customerId: customer.id,
          customer: customerState.profile,
          pickup: pickupInput.value.trim(),
          dropoff: dropoffInput.value.trim(),
          date: document.getElementById('ride-date')?.value || '',
          carType,
          payment: document.getElementById('payment-method')?.value || 'cash',
          fare,
          distanceKm: Number((lastDistanceMeters / 1000).toFixed(2)),
        }),
      });

      await refreshCustomerState();
      showMessage('Ride request submitted successfully.');
      rideForm.reset();
      origin = null;
      destination = null;
      lastDistanceMeters = 0;
      directionsRenderer.set('directions', null);
      if (pickupMarker) pickupMarker.setMap(null);
      if (dropoffMarker) dropoffMarker.setMap(null);
      pickupMarker = null;
      dropoffMarker = null;
      document.getElementById('fare-amount').textContent = formatUGX(0);
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(12);
      switchSection('history');
    } catch (error) {
      showMessage(error.message);
    }
  });

  rideRequestInitialized = true;
}

window.initRideRequest = initRideRequest;

document.addEventListener('DOMContentLoaded', async () => {
  initHeroSlider();
  setCurrentDate();
  initDarkMode();
  initGoogleSignIn();
  initProfileForm();
  initSettingsForm();
  addServiceIcons();
  initFooterToggles();

  const activeSection = document.querySelector('.content .section.active');
  if (activeSection?.id === 'dashboard') {
    document.querySelectorAll('.services, .features, .contact').forEach((section) => {
      section.style.display = 'block';
    });
  }

  if (customerState.customerId) {
    try {
      await refreshCustomerState();
      ensureEventStream();
    } catch {
      localStorage.removeItem(STORAGE_KEYS.customerId);
      customerState.customerId = '';
    }
  }
});
