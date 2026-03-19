const navbarToggle = document.querySelector('.navbar-toggle');
const navbarMenu = document.querySelector('.navbar-menu');

if (navbarToggle && navbarMenu) {
  navbarToggle.addEventListener('click', () => {
    navbarMenu.classList.toggle('active');
    navbarToggle.classList.toggle('active');
  });
}

const STORAGE_KEYS = {
  customerAuth: 'telekaCustomerAuth',
  customerProfile: 'telekaCustomerProfile',
  darkMode: 'darkMode',
};

const appState = {
  auth: loadJson(STORAGE_KEYS.customerAuth, { customerId: '', accessKey: '', token: '' }),
  profile: loadJson(STORAGE_KEYS.customerProfile, {}),
  eventSource: null,
  lastRideStatus: '',
  activeRideId: '',
  notifications: [],
  audioContext: null,
};

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function showMessage(message) {
  window.alert(message);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function api(url, options = {}, token = appState.auth.token) {
  return fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || `Request failed: ${response.status}`);
    return payload.data;
  });
}

function formatUGX(amount) {
  return new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: 'UGX',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

const AudioAlerts = {
  unlock() {
    if (appState.audioContext) return appState.audioContext;
    const AudioContextRef = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextRef) return null;
    appState.audioContext = new AudioContextRef();
    if (appState.audioContext.state === 'suspended') appState.audioContext.resume().catch(() => {});
    return appState.audioContext;
  },
  pulse(frequency, startAt, duration, gainValue) {
    const context = AudioAlerts.unlock();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.05);
  },
  playNotification() {
    const context = AudioAlerts.unlock();
    if (!context) return;
    const startAt = context.currentTime + 0.02;
    AudioAlerts.pulse(698, startAt, 0.14, 0.045);
    AudioAlerts.pulse(880, startAt + 0.18, 0.18, 0.04);
  },
  playRideAccepted() {
    const context = AudioAlerts.unlock();
    if (!context) return;
    const startAt = context.currentTime + 0.02;
    AudioAlerts.pulse(784, startAt, 0.16, 0.05);
    AudioAlerts.pulse(988, startAt + 0.2, 0.18, 0.05);
    AudioAlerts.pulse(1174, startAt + 0.42, 0.24, 0.055);
  },
};

function setCurrentDate() {
  const dateEl = document.getElementById('current-date');
  if (!dateEl) return;
  dateEl.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function initDarkMode() {
  const toggle = document.querySelector('#dark-mode-toggle');
  const stored = localStorage.getItem(STORAGE_KEYS.darkMode);
  const enabled = stored !== null
    ? stored === 'true'
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.toggle('dark-mode', enabled);
  if (!toggle) return;
  toggle.checked = enabled;
  toggle.addEventListener('change', () => {
    document.body.classList.toggle('dark-mode', toggle.checked);
    localStorage.setItem(STORAGE_KEYS.darkMode, String(toggle.checked));
  });
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
  document.querySelectorAll('.services, .features, .contact').forEach((section) => {
    section.style.display = sectionId === 'dashboard' ? 'block' : 'none';
  });
  if (sectionId === 'request') initRideRequest();
  navbarMenu?.classList.remove('active');
  navbarToggle?.classList.remove('active');
}

window.switchSection = switchSection;

let googleUser = null;
let googleReady = false;

function setAuthState(user) {
  googleUser = user;
  const authLink = document.getElementById('auth-action');
  if (!authLink) return;
  authLink.textContent = user ? 'Logout' : 'Login';
}

function initGoogleSignIn() {
  if (!window.google?.accounts?.id) return;
  if (!window.GOOGLE_CLIENT_ID || window.GOOGLE_CLIENT_ID.includes('{{')) return;
  google.accounts.id.initialize({
    client_id: window.GOOGLE_CLIENT_ID,
    callback: (response) => {
      try {
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        appState.profile = {
          name: payload.name || appState.profile.name || '',
          email: payload.email || appState.profile.email || '',
          phone: appState.profile.phone || '',
        };
        saveJson(STORAGE_KEYS.customerProfile, appState.profile);
        fillProfileForm();
        setAuthState({ name: appState.profile.name });
        syncCustomerSession().catch(console.warn);
      } catch (error) {
        console.warn('Failed to parse Google credential', error);
      }
    },
  });
  googleReady = true;
}

function handleAuthClick(event) {
  event.preventDefault();
  if (googleUser) {
    google.accounts?.id?.disableAutoSelect?.();
    setAuthState(null);
    showMessage('Logged out successfully.');
    return;
  }
  if (!googleReady) initGoogleSignIn();
  if (googleReady) google.accounts.id.prompt();
  else showMessage('Google login is not configured for this environment.');
}

window.handleAuthClick = handleAuthClick;

function profileFromForm() {
  return {
    name: document.getElementById('customer-name')?.value.trim() || '',
    email: document.getElementById('customer-email')?.value.trim() || '',
    phone: document.getElementById('customer-phone')?.value.trim() || '',
  };
}

function fillProfileForm() {
  document.getElementById('customer-name').value = appState.profile.name || '';
  document.getElementById('customer-email').value = appState.profile.email || '';
  document.getElementById('customer-phone').value = appState.profile.phone || '';
}

function renderCustomerChat(activeRide) {
  const summary = document.getElementById('customer-chat-summary');
  const list = document.getElementById('customer-chat-preview');
  const input = document.getElementById('customer-chat-input');
  const sendButton = document.getElementById('customer-chat-send');
  const links = [
    document.getElementById('customer-chat-link'),
    document.getElementById('customer-chat-link-secondary'),
  ].filter(Boolean);
  if (!summary || !list || !input || !sendButton) return;

  appState.activeRideId = activeRide?.id || '';
  links.forEach((link) => {
    link.href = activeRide ? `chat.html?role=customer&rideId=${encodeURIComponent(activeRide.id)}` : 'chat.html?role=customer';
    link.classList.toggle('disabled', !activeRide);
  });

  if (!activeRide) {
    summary.textContent = 'Chat becomes active when a driver accepts your ride.';
    list.innerHTML = '<div class="notification-empty"><p>No active ride chat yet.</p></div>';
    input.disabled = true;
    sendButton.disabled = true;
    return;
  }

  summary.textContent = `Ride ${activeRide.id}: ${activeRide.driverName || 'Driver'} ${activeRide.driverPhone ? `(${activeRide.driverPhone})` : ''}`;
  const messages = activeRide.chatMessages || [];
  if (!messages.length) {
    list.innerHTML = '<div class="notification-empty"><p>No messages yet. You can now chat with your driver.</p></div>';
  } else {
    list.innerHTML = messages.map((message) => `
      <div class="notification-card ${message.senderRole === 'customer' ? 'info' : 'warning'}">
        <div class="notification-content">
          <p><strong>${escapeHtml(message.senderName)}</strong>: ${escapeHtml(message.message)}</p>
          <span class="notification-time">${new Date(message.createdAt).toLocaleString()}</span>
        </div>
      </div>
    `).join('');
    list.scrollTop = list.scrollHeight;
  }
  input.disabled = false;
  sendButton.disabled = false;
}

async function syncCustomerSession(resetAuth = false) {
  if (resetAuth) {
    appState.auth = { customerId: '', accessKey: '', token: '' };
  }
  const body = {
    customerId: appState.auth.customerId || undefined,
    accessKey: appState.auth.accessKey || undefined,
    ...profileFromForm(),
  };
  try {
    const data = await api('/api/auth/customer/session', { method: 'POST', body: JSON.stringify(body) }, '');
    appState.auth = { customerId: data.customer.id, accessKey: data.accessKey, token: data.token };
    appState.profile = data.customer;
    saveJson(STORAGE_KEYS.customerAuth, appState.auth);
    saveJson(STORAGE_KEYS.customerProfile, appState.profile);
    fillProfileForm();
    await refreshCustomerState();
    ensureEvents();
    return data.customer;
  } catch (error) {
    if (!resetAuth && /authentication failed/i.test(error.message)) {
      return syncCustomerSession(true);
    }
    throw error;
  }
}

async function refreshCustomerState() {
  const previousNotificationIds = new Set((appState.notifications || []).map((item) => item.id));
  const data = await api('/api/customer/state');
  const rides = data.rides || [];
  const activeRide = data.activeRide;
  if (activeRide && appState.lastRideStatus && appState.lastRideStatus !== activeRide.status && activeRide.status === 'accepted') {
    AudioAlerts.playRideAccepted();
    showMessage(`Your ride was accepted by ${activeRide.driverName}. Driver contact: ${activeRide.driverPhone || 'Unavailable'}`);
  }
  const latestNotification = (data.notifications || [])[0];
  if (appState.notifications.length && latestNotification && !previousNotificationIds.has(latestNotification.id) && activeRide?.status !== 'accepted') {
    AudioAlerts.playNotification();
  }
  appState.notifications = data.notifications || [];
  appState.lastRideStatus = activeRide ? activeRide.status : '';
  document.getElementById('upcoming-ride-status').textContent = data.activeRide
    ? `${data.activeRide.status.toUpperCase()}: ${data.activeRide.pickup} to ${data.activeRide.dropoff}`
    : 'No rides scheduled';
  document.getElementById('active-driver-contact').textContent = activeRide?.driverPhone
    ? `Driver ${activeRide.driverName}: ${activeRide.driverPhone}`
    : 'Driver contact will appear after acceptance.';
  renderCustomerChat(activeRide);
  document.getElementById('total-rides-count').textContent = String(rides.length);
  document.getElementById('account-balance').textContent = formatUGX(
    rides.filter((ride) => ride.status === 'completed').reduce((sum, ride) => sum + (ride.fare || 0), 0)
  );
  const body = document.getElementById('ride-history-body');
  body.innerHTML = '';
  if (!rides.length) {
    body.innerHTML = '<tr><td colspan="5">No rides yet.</td></tr>';
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
    body.appendChild(row);
  });
}

function ensureEvents() {
  if (!appState.auth.token || appState.eventSource) return;
  const stream = new EventSource(`/api/events?token=${encodeURIComponent(appState.auth.token)}`);
  stream.addEventListener('state-update', () => refreshCustomerState().catch(console.warn));
  stream.onerror = () => {
    stream.close();
    appState.eventSource = null;
    setTimeout(ensureEvents, 3000);
  };
  appState.eventSource = stream;
}

function initProfileForm() {
  fillProfileForm();
  document.getElementById('customer-profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    appState.profile = profileFromForm();
    saveJson(STORAGE_KEYS.customerProfile, appState.profile);
    try {
      await syncCustomerSession();
      showMessage('Profile updated.');
    } catch (error) {
      showMessage(error.message);
    }
  });
}

function initCustomerChatForm() {
  document.getElementById('customer-chat-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('customer-chat-input');
    const message = input?.value.trim() || '';
    if (!appState.activeRideId) {
      showMessage('No active ride available for chat.');
      return;
    }
    if (!message) return;
    try {
      await api(`/api/rides/${encodeURIComponent(appState.activeRideId)}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      input.value = '';
      await refreshCustomerState();
    } catch (error) {
      showMessage(error.message);
    }
  });
}

function initFooterToggles() {
  document.querySelectorAll('.footer-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => toggle.nextElementSibling?.classList.toggle('active'));
  });
}

function addServiceIcons() {
  const icons = {
    'Airport Transfers': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>',
    'City Rides': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM5 11l1.5-4.5h11L19 11H5z"/></svg>',
    'Business Travel': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M20 7h-4V5l-2-2h-4L8 5v2H4c-1.1 0-2 .9-2 2v5c0 .75.4 1.38 1 1.73V19c0 1.11.89 2 2 2h14c1.11 0 2-.89 2-2v-3.27c.59-.36 1-.98 1-1.73V9c0-1.1-.9-2-2-2z"/></svg>',
    'Tours Travel': '<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 1.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5z"/></svg>',
  };
  document.querySelectorAll('.service-card').forEach((card) => {
    const title = card.querySelector('h3')?.textContent.trim();
    const iconDiv = card.querySelector('.service-icon');
    if (iconDiv && title && icons[title]) iconDiv.innerHTML = icons[title];
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
  const km = distanceMeters / 1000;
  let multiplier = 1;
  if (carType === 'premium') multiplier = 1.4;
  if (carType === 'suv') multiplier = 1.75;
  return Math.round((3000 + 1800 * km) * multiplier);
}

function initRideRequest() {
  if (rideRequestInitialized || !window.google?.maps) return;
  const mapEl = document.getElementById('map');
  const pickupInput = document.getElementById('pickup-location');
  const dropoffInput = document.getElementById('dropoff-location');
  const rideForm = document.getElementById('ride-form');
  if (!mapEl || !pickupInput || !dropoffInput || !rideForm) return;

  map = new google.maps.Map(mapEl, { center: DEFAULT_CENTER, zoom: 12, disableDefaultUI: true });
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map, suppressMarkers: true, polylineOptions: { strokeColor: '#3c8dbc', strokeWeight: 6 } });
  const options = { componentRestrictions: { country: 'ug' }, fields: ['geometry', 'formatted_address', 'name'] };
  const pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, options);
  const dropoffAutocomplete = new google.maps.places.Autocomplete(dropoffInput, options);

  let origin = null;
  let destination = null;
  let distanceMeters = 0;

  const redraw = () => {
    if (!origin || !destination) return;
    directionsService.route({ origin, destination, travelMode: google.maps.TravelMode.DRIVING }, (result, status) => {
      if (status !== 'OK' || !result) return;
      directionsRenderer.setDirections(result);
      const leg = result.routes[0].legs[0];
      distanceMeters = leg.distance.value;
      document.getElementById('fare-amount').textContent = formatUGX(estimateFare(distanceMeters, document.getElementById('car-type').value));
      if (pickupMarker) pickupMarker.setMap(null);
      if (dropoffMarker) dropoffMarker.setMap(null);
      pickupMarker = new google.maps.Marker({ position: leg.start_location, map, label: 'A' });
      dropoffMarker = new google.maps.Marker({ position: leg.end_location, map, label: 'B' });
      map.fitBounds(result.routes[0].bounds, { padding: 60 });
    });
  };

  pickupAutocomplete.addListener('place_changed', () => { const place = pickupAutocomplete.getPlace(); if (place.geometry?.location) { origin = place.geometry.location; redraw(); } });
  dropoffAutocomplete.addListener('place_changed', () => { const place = dropoffAutocomplete.getPlace(); if (place.geometry?.location) { destination = place.geometry.location; redraw(); } });
  document.getElementById('car-type')?.addEventListener('change', redraw);

  rideForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      if (!origin || !destination) throw new Error('Select both pickup and dropoff from the suggestions.');
      await syncCustomerSession();
      await api('/api/rides', {
        method: 'POST',
        body: JSON.stringify({
          pickup: pickupInput.value.trim(),
          dropoff: dropoffInput.value.trim(),
          date: document.getElementById('ride-date')?.value || '',
          carType: document.getElementById('car-type')?.value || 'standard',
          payment: document.getElementById('payment-method')?.value || 'cash',
          fare: estimateFare(distanceMeters, document.getElementById('car-type').value),
          distanceKm: Number((distanceMeters / 1000).toFixed(2)),
        }),
      });
      await refreshCustomerState();
      showMessage('Ride request submitted successfully.');
      rideForm.reset();
      directionsRenderer.set('directions', null);
      pickupMarker?.setMap(null);
      dropoffMarker?.setMap(null);
      pickupMarker = null;
      dropoffMarker = null;
      origin = null;
      destination = null;
      distanceMeters = 0;
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
  initCustomerChatForm();
  renderCustomerChat(null);
  initFooterToggles();
  addServiceIcons();
  document.addEventListener('pointerdown', AudioAlerts.unlock, { once: true });
  document.addEventListener('keydown', AudioAlerts.unlock, { once: true });
  document.querySelector('.settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    showMessage('Settings saved on this device.');
  });
  if (appState.auth.customerId || appState.profile.name || appState.profile.email || appState.profile.phone) {
    try { await syncCustomerSession(); } catch (error) { console.warn(error.message); }
  }
});
