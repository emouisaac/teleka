const params = new URLSearchParams(window.location.search);
const role = params.get('role') || 'customer';
const mode = params.get('mode') || 'chat';
let rideId = params.get('rideId') || '';

const authStorageKey = role === 'driver' ? 'telekaDriverAuth' : 'telekaCustomerAuth';
const backLink = role === 'driver' ? 'driver.html' : 'index.html';
const auth = loadJson(authStorageKey, { token: '' });
const chatMessages = document.getElementById('chatMessages');
const chatSummary = document.getElementById('chatSummary');
const chatBackLink = document.getElementById('chatBackLink');
const resetForm = document.getElementById('resetRequestForm');
const chatForm = document.getElementById('chatForm');

if (chatBackLink) chatBackLink.href = backLink;
const resetBackLink = document.getElementById('resetBackLink');
if (resetBackLink) resetBackLink.href = backLink;

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
}

function api(url, options = {}) {
  return fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || `Request failed: ${response.status}`);
    return payload.data;
  });
}

function setResetMode() {
  document.title = 'Teleka Taxi - Password Reset Request';
  document.querySelector('h1').textContent = 'Password Reset Request';
  chatSummary.textContent = 'Enter your registered WhatsApp number so the admin can receive and follow up on your password reset request.';
  resetForm?.classList.remove('hidden');
  chatForm?.classList.add('hidden');
  document.querySelector('.map-card')?.classList.add('hidden');
}

async function ensureRideId() {
  if (rideId) return rideId;
  if (role === 'driver') {
    const data = await api('/api/driver/state');
    rideId = data.activeRide?.id || '';
  } else {
    const data = await api('/api/customer/state');
    rideId = data.activeRide?.id || '';
  }
  return rideId;
}

function renderChat(data) {
  const ride = data.ride;
  const messages = data.messages || [];
  chatSummary.textContent = ride
    ? `Ride ${ride.id}: ${ride.pickup} to ${ride.dropoff} | ${ride.driverName || 'Driver'} ${ride.driverPhone ? `(${ride.driverPhone})` : ''}`
    : 'No active ride chat found.';

  chatMessages.innerHTML = '';
  if (!messages.length) {
    chatMessages.innerHTML = '<div class="notification-empty"><p>No messages yet.</p></div>';
    return;
  }
  messages.forEach((message) => {
    const row = document.createElement('div');
    row.className = `notification-card ${message.senderRole === role ? 'info' : 'warning'}`;
    row.innerHTML = `
      <div class="notification-content">
        <p><strong>${message.senderName}</strong>: ${message.message}</p>
        <span class="notification-time">${new Date(message.createdAt).toLocaleString()}</span>
      </div>
    `;
    chatMessages.appendChild(row);
  });
}

async function refreshChat() {
  const currentRideId = await ensureRideId();
  if (!currentRideId) {
    chatSummary.textContent = 'No active ride is available for chat.';
    return;
  }
  const data = await api(`/api/rides/${encodeURIComponent(currentRideId)}/chat`);
  renderChat(data);
}

resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await fetch('/api/drivers/password-reset-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        whatsappNumber: document.getElementById('resetWhatsappNumber').value.trim(),
      }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Request failed: ${response.status}`);
      return payload.data;
    });
    chatSummary.textContent = 'Reset request submitted. The admin has been notified and can follow up with you on WhatsApp.';
    resetForm.reset();
  } catch (error) {
    window.alert(error.message);
  }
});

chatForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const currentRideId = await ensureRideId();
  if (!currentRideId) {
    window.alert('No active ride available for chat.');
    return;
  }
  await api(`/api/rides/${encodeURIComponent(currentRideId)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message: input.value.trim() }),
  });
  input.value = '';
  await refreshChat();
});

if (mode === 'reset') {
  setResetMode();
} else if (!auth.token) {
  chatSummary.textContent = 'You must be logged in to access ride chat.';
} else {
  refreshChat().catch((error) => {
    chatSummary.textContent = error.message;
  });
  const stream = new EventSource(`/api/events?token=${encodeURIComponent(auth.token)}`);
  stream.addEventListener('state-update', () => refreshChat().catch(() => {}));
}
