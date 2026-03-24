const FALLBACK_GOOGLE_CLIENT_ID = '275353277028-m8u8c8pq73jj0a2ds4n6eikj43hpklf8.apps.googleusercontent.com';
const DEFAULT_MAP_CENTER = { lat: 0.3476, lng: 32.5825 };

const customerState = {
    authenticated: false,
    user: null,
    pollId: null,
    publicConfig: null,
    activeRideId: null,
    places: { pickup: null, dropoff: null }
};

const mapState = {
    map: null,
    directionsService: null,
    directionsRenderer: null,
    latestLeg: null,
    latestDirections: null
};

function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `notification notification--${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 250);
    }, 2500);
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

async function getPublicConfig() {
    if (!customerState.publicConfig) {
        customerState.publicConfig = await api('/api/public/config').catch(() => ({}));
    }
    return customerState.publicConfig;
}

function toggleMobileMenu() {
    const menu = document.querySelector('.navbar-menu');
    const toggle = document.querySelector('.navbar-toggle');
    if (!menu || !toggle) return;
    menu.classList.toggle('active');
    toggle.classList.toggle('active');
}

function setActiveNavbarItem(sectionId) {
    document.querySelectorAll('.navbar-menu li').forEach((item) => {
        const link = item.querySelector('.navbar-link');
        const href = link?.getAttribute('href') || '';
        const active = href === `#${sectionId}`;
        item.classList.toggle('active', active);
        link?.classList.toggle('active', active);
    });
}

function switchSection(sectionId) {
    document.querySelectorAll('main .section[id]').forEach((section) => {
        section.classList.toggle('active', section.id === sectionId);
    });
    setActiveNavbarItem(sectionId);
    if (window.location.hash !== `#${sectionId}`) history.replaceState(null, '', `#${sectionId}`);
    document.querySelector('.navbar-menu')?.classList.remove('active');
    document.querySelector('.navbar-toggle')?.classList.remove('active');
    if (sectionId === 'request') {
        setTimeout(() => {
            if (mapState.map && window.google?.maps) {
                google.maps.event.trigger(mapState.map, 'resize');
                if (mapState.latestDirections) mapState.directionsRenderer.setDirections(mapState.latestDirections);
            }
        }, 120);
    }
}

function handleAuthClick(event) {
    event.preventDefault();
    window.location.href = '/auth/google';
}

async function handleLogout(event) {
    event.preventDefault();
    await api('/auth/logout', { method: 'POST' });
    window.location.reload();
}

function updateAuthUI(authenticated, user) {
    const authLink = document.getElementById('auth-action');
    if (!authLink) return;
    if (authenticated && user) {
        authLink.textContent = `Logout (${user.name})`;
        authLink.onclick = handleLogout;
    } else {
        authLink.textContent = 'Login';
        authLink.onclick = handleAuthClick;
    }
}

function formatMoney(value) {
    return `UGX ${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
}

function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function formatDistance(meters) {
    return `${(Number(meters || 0) / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
    const minutes = Math.round(Number(seconds || 0) / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remain = minutes % 60;
    return remain ? `${hours} hr ${remain} min` : `${hours} hr`;
}

function setMapHint(message) {
    const hint = document.querySelector('.map-hint');
    if (hint) hint.textContent = message;
}

function resetRouteSummary() {
    document.getElementById('route-distance').textContent = '--';
    document.getElementById('route-duration').textContent = '--';
    document.getElementById('route-from').textContent = 'Waiting for pickup...';
    document.getElementById('route-to').textContent = 'Waiting for destination...';
    document.getElementById('fare-breakdown').textContent = 'Type pickup and destination to calculate fare.';
    document.getElementById('fare-amount').textContent = 'UGX 0';
}

function syncPricingEstimate() {
    if (!mapState.latestLeg) return resetRouteSummary();
    const distanceMeters = mapState.latestLeg.distance?.value || 0;
    const durationSeconds = mapState.latestLeg.duration_in_traffic?.value || mapState.latestLeg.duration?.value || 0;
    const pricing = customerState.publicConfig?.pricing || {};
    const hour = new Date(document.getElementById('ride-date').value || Date.now()).getHours();
    const surge = (hour >= 22 || hour < 6) ? Number(pricing.surge_multiplier || 1.15) : 1;
    const base = Number(pricing.base_fare || 3500);
    const perKm = Number(pricing.per_km || 1200);
    const perMin = Number(pricing.per_min || 180);
    const estimate = Math.max(0, Math.round((base + ((distanceMeters / 1000) * perKm) + ((durationSeconds / 60) * perMin)) * surge));

    document.getElementById('fare-amount').textContent = formatMoney(estimate);
    document.getElementById('fare-breakdown').textContent = `${formatDistance(distanceMeters)} | ${formatDuration(durationSeconds)}${surge > 1 ? ' | surge applied' : ''}`;
}

function updateRouteSummary(leg) {
    document.getElementById('route-distance').textContent = formatDistance(leg.distance?.value || 0);
    document.getElementById('route-duration').textContent = formatDuration(leg.duration_in_traffic?.value || leg.duration?.value || 0);
    document.getElementById('route-from').textContent = leg.start_address || 'Pickup selected';
    document.getElementById('route-to').textContent = leg.end_address || 'Destination selected';
    syncPricingEstimate();
}

function calculateRoute() {
    if (!mapState.directionsService || !window.google?.maps) return;
    const pickup = document.getElementById('pickup-location').value.trim();
    const dropoff = document.getElementById('dropoff-location').value.trim();
    if (!pickup || !dropoff) {
        mapState.latestLeg = null;
        mapState.latestDirections = null;
        mapState.directionsRenderer?.set('directions', null);
        resetRouteSummary();
        return;
    }
    mapState.directionsService.route({
        origin: pickup,
        destination: dropoff,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC,
        drivingOptions: { departureTime: new Date(document.getElementById('ride-date').value || Date.now()) }
    }, (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !result?.routes?.[0]?.legs?.[0]) {
            mapState.latestLeg = null;
            mapState.directionsRenderer?.set('directions', null);
            resetRouteSummary();
            setMapHint('No route found. Use suggested addresses.');
            return;
        }
        mapState.latestDirections = result;
        mapState.latestLeg = result.routes[0].legs[0];
        mapState.directionsRenderer.setDirections(result);
        updateRouteSummary(mapState.latestLeg);
        setMapHint('Route loaded. Fare updates live.');
    });
}

function setupAutocomplete(input, key) {
    const autocomplete = new google.maps.places.Autocomplete(input, {
        fields: ['formatted_address', 'geometry', 'name', 'place_id'],
        componentRestrictions: { country: 'ug' }
    });
    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place?.formatted_address) input.value = place.formatted_address;
        customerState.places[key] = place || null;
        calculateRoute();
    });
}

function initRideRequest() {
    if (mapState.map || !window.google?.maps) return;
    const mapElement = document.getElementById('map');
    if (!mapElement) return;
    mapState.map = new google.maps.Map(mapElement, {
        center: DEFAULT_MAP_CENTER,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false
    });
    mapState.directionsService = new google.maps.DirectionsService();
    mapState.directionsRenderer = new google.maps.DirectionsRenderer({ map: mapState.map, suppressMarkers: false });
    setupAutocomplete(document.getElementById('pickup-location'), 'pickup');
    setupAutocomplete(document.getElementById('dropoff-location'), 'dropoff');
    document.getElementById('pickup-location').addEventListener('blur', calculateRoute);
    document.getElementById('dropoff-location').addEventListener('blur', calculateRoute);
    document.getElementById('ride-date').addEventListener('change', syncPricingEstimate);
    setMapHint('Start typing pickup and destination for suggestions and route.');
}

window.initRideRequest = initRideRequest;

async function loadGoogleMapsScript() {
    if (!document.getElementById('map')) return;
    if (window.google?.maps?.places) return initRideRequest();
    const config = await getPublicConfig();
    if (!config.googleMapsApiKey) return setMapHint('Missing Google Maps API key in backend config.');
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsApiKey)}&libraries=places&callback=initRideRequest`;
    script.onerror = () => setMapHint('Failed to load Google Maps. Check API key restrictions.');
    document.body.appendChild(script);
}

function renderCustomerSnapshot(snapshot) {
    const profile = snapshot.profile || {};
    const activeRide = snapshot.activeRide || null;
    customerState.activeRideId = activeRide?.id || null;

    document.getElementById('customer-name').value = profile.name || '';
    document.getElementById('customer-email').value = profile.email || '';
    document.getElementById('customer-phone').value = profile.phone || '';
    document.getElementById('total-rides-count').textContent = snapshot.stats?.total_rides || 0;
    document.getElementById('account-balance').textContent = formatMoney(snapshot.stats?.completed_spend);

    if (activeRide) {
        document.getElementById('upcoming-ride-status').textContent = `${activeRide.status.toUpperCase()} | ${activeRide.pickup_location} -> ${activeRide.dropoff_location}`;
        document.getElementById('active-driver-contact').textContent = activeRide.driver_name
            ? `${activeRide.driver_name} | ${activeRide.driver_phone || 'No phone'}`
            : 'Waiting for driver assignment.';
    } else {
        document.getElementById('upcoming-ride-status').textContent = 'No rides scheduled';
        document.getElementById('active-driver-contact').textContent = 'Driver contact will appear after acceptance.';
    }

    const historyBody = document.getElementById('ride-history-body');
    historyBody.innerHTML = (snapshot.rides || []).map((ride) => `
        <tr><td>${formatDate(ride.scheduled_local || ride.scheduled_at || ride.created_at)}</td><td>${ride.pickup_location}</td><td>${ride.dropoff_location}</td><td>${formatMoney(ride.final_fare ?? ride.estimated_fare)}</td><td>${ride.status}</td></tr>
    `).join('') || '<tr><td colspan="5">No rides yet.</td></tr>';

    const chatPreview = document.getElementById('customer-chat-preview');
    chatPreview.innerHTML = (snapshot.activeRideMessages || []).map((msg) => `
        <div class="chat-line ${msg.sender_role === 'customer' ? 'chat-line--user' : 'chat-line--admin'}">
          <strong>${msg.sender_role === 'customer' ? 'You' : 'Driver'}:</strong> ${msg.message}
        </div>
    `).join('') || '<div class="notification-empty"><p>No messages yet.</p></div>';
}

async function loadCustomerSnapshot() {
    if (!customerState.authenticated || customerState.user?.role !== 'customer') return;
    try {
        const snapshot = await api('/api/customer/snapshot');
        renderCustomerSnapshot(snapshot);
    } catch (error) {
        console.error('Customer snapshot error:', error);
    }
}

function startCustomerPolling() {
    clearInterval(customerState.pollId);
    loadCustomerSnapshot();
    customerState.pollId = setInterval(loadCustomerSnapshot, 5000);
}

async function checkAuthStatus() {
    try {
        const data = await api('/auth/status');
        customerState.authenticated = Boolean(data.authenticated);
        customerState.user = data.user || null;
        updateAuthUI(customerState.authenticated, customerState.user);
        if (customerState.authenticated && customerState.user?.role === 'customer') startCustomerPolling();
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

async function initializeGoogleSignIn() {
    if (!window.google?.accounts?.id) return;
    const config = await getPublicConfig();
    const clientId = config.googleClientId || FALLBACK_GOOGLE_CLIENT_ID;
    google.accounts.id.initialize({ client_id: clientId, callback: () => window.location.reload() });
}

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthStatus();
    const initial = window.location.hash.slice(1);
    switchSection(document.getElementById(initial) ? initial : 'dashboard');
    window.addEventListener('hashchange', () => {
        const hashSection = window.location.hash.slice(1);
        if (document.getElementById(hashSection)) switchSection(hashSection);
    });

    const rideDateInput = document.getElementById('ride-date');
    if (rideDateInput && !rideDateInput.value) {
        const date = new Date(Date.now() + 30 * 60 * 1000);
        rideDateInput.value = date.toISOString().slice(0, 16);
    }

    document.getElementById('ride-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!customerState.authenticated || customerState.user?.role !== 'customer') {
            showToast('Please login as customer to request a ride.', 'error');
            return;
        }
        const distanceKm = (mapState.latestLeg?.distance?.value || 0) / 1000;
        const durationMin = (mapState.latestLeg?.duration_in_traffic?.value || mapState.latestLeg?.duration?.value || 0) / 60;
        const estimatedFare = Number((document.getElementById('fare-amount').textContent || '').replace(/[^\d]/g, '')) || 0;
        try {
            await api('/api/rides/request', {
                method: 'POST',
                body: JSON.stringify({
                    pickupLocation: document.getElementById('pickup-location').value.trim(),
                    dropoffLocation: document.getElementById('dropoff-location').value.trim(),
                    scheduledAt: document.getElementById('ride-date').value,
                    carType: document.getElementById('car-type').value,
                    paymentMethod: document.getElementById('payment-method').value,
                    distanceKm,
                    durationMin,
                    estimatedFare,
                    pickupLat: customerState.places.pickup?.geometry?.location?.lat?.(),
                    pickupLng: customerState.places.pickup?.geometry?.location?.lng?.(),
                    dropoffLat: customerState.places.dropoff?.geometry?.location?.lat?.(),
                    dropoffLng: customerState.places.dropoff?.geometry?.location?.lng?.()
                })
            });
            showToast('Ride request submitted');
            loadCustomerSnapshot();
            switchSection('history');
        } catch (error) {
            showToast(error.message, 'error');
        }
    });

    document.getElementById('customer-profile-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await api('/api/customer/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    name: document.getElementById('customer-name').value.trim(),
                    phone: document.getElementById('customer-phone').value.trim()
                })
            });
            showToast('Profile updated');
            checkAuthStatus();
        } catch (error) {
            showToast(error.message, 'error');
        }
    });

    document.getElementById('customer-chat-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!customerState.activeRideId) return showToast('No active ride to chat with.', 'error');
        const message = document.getElementById('customer-chat-input').value.trim();
        if (!message) return;
        try {
            await api(`/api/customer/rides/${customerState.activeRideId}/messages`, {
                method: 'POST',
                body: JSON.stringify({ message })
            });
            document.getElementById('customer-chat-input').value = '';
            loadCustomerSnapshot();
        } catch (error) {
            showToast(error.message, 'error');
        }
    });

    document.querySelector('.settings-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        showToast('Settings saved locally');
    });

    loadGoogleMapsScript();
    if (typeof google !== 'undefined') initializeGoogleSignIn();
});
