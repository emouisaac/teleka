const params = new URLSearchParams(window.location.search);
const role = params.get('role') || 'customer';
let rideId = params.get('rideId') || '';

const authStorageKey = role === 'driver' ? 'telekaDriverAuth' : 'telekaCustomerAuth';
const backLink = role === 'driver' ? 'driver.html' : 'index.html';
const auth = loadJson(authStorageKey, { token: '' });
const chatMessages = document.getElementById('chatMessages');
const chatSummary = document.getElementById('chatSummary');
const chatBackLink = document.getElementById('chatBackLink');

if (chatBackLink) {
  chatBackLink.href = backLink;
}

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

document.getElementById('chatForm')?.addEventListener('submit', async (event) => {
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

if (!auth.token) {
  chatSummary.textContent = 'You must be logged in to access ride chat.';
} else {
  refreshChat().catch((error) => {
    chatSummary.textContent = error.message;
  });
  const stream = new EventSource(`/api/events?token=${encodeURIComponent(auth.token)}`);
  stream.addEventListener('state-update', () => refreshChat().catch(() => {}));
}
