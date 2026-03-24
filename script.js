const FALLBACK_GOOGLE_CLIENT_ID = '275353277028-m8u8c8pq73jj0a2ds4n6eikj43hpklf8.apps.googleusercontent.com';
const DEFAULT_MAP_CENTER = { lat: 0.3476, lng: 32.5825 };
const DEFAULT_CAR_TYPE_MULTIPLIERS = {
    standard: 1,
    premium: 1.35,
    suv: 1.6
};
const CAR_TYPE_LABELS = {
    standard: 'Standard',
    premium: 'Premium',
    suv: 'SUV'
};

const customerState = {
    authenticated: false,
    user: null,
    pollId: null,
    publicConfig: null,
    activeRideId: null,
    places: { pickup: null, dropoff: null },
    audioContext: null,
    lastNotificationId: null,
    lastActiveRideStatus: null,
    hasLoadedSnapshot: false
};

const mapState = {
    map: null,
    directionsService: null,
    directionsRenderer: null,
    latestLeg: null,
    latestDirections: null,
    scriptRequested: false,
    isLoadingRoute: false,
    routeDebounceId: null,
    routeRequestId: 0
};

const heroSliderState = {
    headings: [],
    activeIndex: 0,
    intervalId: null
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

function updateHeroSlide(nextIndex) {
    if (!heroSliderState.headings.length) return;
    const normalizedIndex = ((nextIndex % heroSliderState.headings.length) + heroSliderState.headings.length) % heroSliderState.headings.length;
    const current = heroSliderState.headings[heroSliderState.activeIndex];
    const next = heroSliderState.headings[normalizedIndex];

    if (current && current !== next) {
        current.classList.remove('active');
        current.classList.add('exit');
    }

    heroSliderState.headings.forEach((heading, index) => {
        if (index !== normalizedIndex && heading !== current) {
            heading.classList.remove('active', 'exit');
        }
    });

    if (next) {
        next.classList.remove('exit');
        next.classList.add('active');
    }

    heroSliderState.activeIndex = normalizedIndex;
}

function startHeroSlider() {
    const container = document.querySelector('.hero-content');
    const headings = Array.from(container?.querySelectorAll('h1') || []);
    if (!container || headings.length === 0) return;

    if (heroSliderState.intervalId) clearInterval(heroSliderState.intervalId);
    heroSliderState.headings = headings;
    heroSliderState.activeIndex = 0;
    headings.forEach((heading) => heading.classList.remove('active', 'exit'));
    updateHeroSlide(0);

    if (headings.length === 1) return;
    heroSliderState.intervalId = setInterval(() => {
        updateHeroSlide(heroSliderState.activeIndex + 1);
    }, 2800);
}

function getCustomerAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!customerState.audioContext) customerState.audioContext = new AudioCtx();
    if (customerState.audioContext.state === 'suspended') customerState.audioContext.resume().catch(() => {});
    return customerState.audioContext;
}

function playCustomerAlert() {
    const context = getCustomerAudioContext();
    if (!context) return;
    const start = context.currentTime + 0.02;
    [880, 1175].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start + (index * 0.18));
        gain.gain.setValueAtTime(0.0001, start + (index * 0.18));
        gain.gain.exponentialRampToValueAtTime(0.08, start + (index * 0.18) + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (index * 0.18) + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start + (index * 0.18));
        oscillator.stop(start + (index * 0.18) + 0.2);
    });
}

function handleCustomerAlerts(snapshot) {
    const latestNotificationId = snapshot.notifications?.[0]?.id || null;
    const currentRideStatus = snapshot.activeRide?.status || null;

    if (!customerState.hasLoadedSnapshot) {
        customerState.lastNotificationId = latestNotificationId;
        customerState.lastActiveRideStatus = currentRideStatus;
        customerState.hasLoadedSnapshot = true;
        return;
    }

    const notificationChanged = latestNotificationId && latestNotificationId !== customerState.lastNotificationId;
    const rideStatusChanged = currentRideStatus && currentRideStatus !== customerState.lastActiveRideStatus;
    customerState.lastNotificationId = latestNotificationId;
    customerState.lastActiveRideStatus = currentRideStatus;
    if (notificationChanged || rideStatusChanged) playCustomerAlert();
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
        ensureRideRequestMapReady();
        setTimeout(() => {
            if (mapState.map && window.google?.maps) {
                google.maps.event.trigger(mapState.map, 'resize');
                if (mapState.latestDirections) {
                    mapState.directionsRenderer.setDirections(mapState.latestDirections);
                    fitMapToLatestRoute();
                } else if (document.getElementById('pickup-location')?.value.trim() && document.getElementById('dropoff-location')?.value.trim()) {
                    scheduleRouteEstimate(0);
                }
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

function updateRoutePreviewLabels() {
    const pickup = document.getElementById('pickup-location')?.value.trim();
    const dropoff = document.getElementById('dropoff-location')?.value.trim();
    document.getElementById('route-from').textContent = pickup || 'Waiting for pickup...';
    document.getElementById('route-to').textContent = dropoff || 'Waiting for destination...';
}

function renderRouteStepsMessage(message, status = 'Waiting for route...') {
    const list = document.getElementById('route-steps-list');
    const statusEl = document.getElementById('route-steps-status');
    if (statusEl) statusEl.textContent = status;
    if (!list) return;
    const item = document.createElement('li');
    item.textContent = message;
    list.replaceChildren(item);
}

function resetRouteDisplay() {
    document.getElementById('route-distance').textContent = '--';
    document.getElementById('route-duration').textContent = '--';
    updateRoutePreviewLabels();
    document.getElementById('fare-breakdown').textContent = 'Enter pickup and destination to get an estimated fare.';
    document.getElementById('fare-amount').textContent = 'UGX 0';
    renderRouteStepsMessage('Enter pickup and destination to see route suggestions here.');
}

function getSelectedCarType() {
    const carType = document.getElementById('car-type')?.value || 'standard';
    return DEFAULT_CAR_TYPE_MULTIPLIERS[carType] ? carType : 'standard';
}

function getSelectedCarTypeMultiplier() {
    const pricing = customerState.publicConfig?.pricing || {};
    const multipliers = pricing.car_type_multipliers || DEFAULT_CAR_TYPE_MULTIPLIERS;
    return Number(multipliers[getSelectedCarType()] || 1);
}

function decodeDirectionStep(html) {
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function renderRouteSteps(steps) {
    const list = document.getElementById('route-steps-list');
    const statusEl = document.getElementById('route-steps-status');
    if (!list) return;
    if (!steps?.length) return renderRouteStepsMessage('Route found, but step-by-step suggestions are unavailable.', 'Directions ready');

    const items = steps.map((step) => {
        const item = document.createElement('li');
        item.className = 'route-step';

        const instruction = document.createElement('div');
        instruction.className = 'route-step-instruction';
        instruction.textContent = decodeDirectionStep(step.instructions) || 'Continue on the suggested route';

        const meta = document.createElement('div');
        meta.className = 'route-step-meta';
        const parts = [step.distance?.text, step.duration?.text].filter(Boolean);
        meta.textContent = parts.join(' | ');

        item.append(instruction);
        if (meta.textContent) item.append(meta);
        return item;
    });

    list.replaceChildren(...items);
    if (statusEl) statusEl.textContent = `${steps.length} step${steps.length === 1 ? '' : 's'} ready`;
}

function calculateEstimatedFareFromLeg(leg) {
    const distanceMeters = leg?.distance?.value || 0;
    const durationSeconds = leg?.duration?.value || 0;
    const pricing = customerState.publicConfig?.pricing || {};
    const hour = new Date(document.getElementById('ride-date').value || Date.now()).getHours();
    const surge = (hour >= 22 || hour < 6) ? Number(pricing.surge_multiplier || 1.15) : 1;
    const baseFare = Number(pricing.base_fare || 3500);
    const perKm = Number(pricing.per_km || 1200);
    const perMin = Number(pricing.per_min || 180);
    const carType = getSelectedCarType();
    const multiplier = getSelectedCarTypeMultiplier();
    const total = (baseFare + ((distanceMeters / 1000) * perKm) + ((durationSeconds / 60) * perMin)) * surge * multiplier;
    return {
        amount: Math.max(0, Math.round(total)),
        breakdown: `${CAR_TYPE_LABELS[carType]} x${multiplier.toFixed(2)} | ${formatDistance(distanceMeters)} | ${formatDuration(durationSeconds)}${surge > 1 ? ' | surge applied' : ''}`
    };
}

function renderRouteAndFare(leg) {
    document.getElementById('route-distance').textContent = formatDistance(leg.distance?.value || 0);
    document.getElementById('route-duration').textContent = formatDuration(leg.duration?.value || 0);
    document.getElementById('route-from').textContent = leg.start_address || document.getElementById('pickup-location').value.trim() || 'Pickup selected';
    document.getElementById('route-to').textContent = leg.end_address || document.getElementById('dropoff-location').value.trim() || 'Destination selected';

    const fare = calculateEstimatedFareFromLeg(leg);
    document.getElementById('fare-amount').textContent = formatMoney(fare.amount);
    document.getElementById('fare-breakdown').textContent = fare.breakdown;
}

function clearRouteFromMap() {
    mapState.latestLeg = null;
    mapState.latestDirections = null;
    mapState.directionsRenderer?.set('directions', null);
}

function fitMapToLatestRoute(directions = mapState.latestDirections) {
    const bounds = directions?.routes?.[0]?.bounds;
    if (!mapState.map || !bounds) return;
    mapState.map.fitBounds(bounds);
}

function getRouteEndpoint(key, inputId) {
    const value = document.getElementById(inputId)?.value.trim();
    if (!value) return null;
    const place = customerState.places[key];
    if (place?.place_id && place.formatted_address === value) {
        return { placeId: place.place_id };
    }
    return value;
}

function setRouteLoadingState() {
    mapState.isLoadingRoute = true;
    updateRoutePreviewLabels();
    document.getElementById('fare-breakdown').textContent = 'Calculating estimated fare...';
    document.getElementById('fare-amount').textContent = 'UGX ...';
    renderRouteStepsMessage('Loading route suggestions...', 'Calculating...');
}

function requestRouteEstimate() {
    if (!mapState.directionsService || !window.google?.maps) return;

    const pickup = getRouteEndpoint('pickup', 'pickup-location');
    const dropoff = getRouteEndpoint('dropoff', 'dropoff-location');

    if (!pickup || !dropoff) {
        mapState.isLoadingRoute = false;
        clearRouteFromMap();
        resetRouteDisplay();
        return;
    }

    const requestId = ++mapState.routeRequestId;
    setRouteLoadingState();

    mapState.directionsService.route({
        origin: pickup,
        destination: dropoff,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC
    }, (result, status) => {
        if (requestId !== mapState.routeRequestId) return;
        mapState.isLoadingRoute = false;

        const leg = result?.routes?.[0]?.legs?.[0];
        if (status !== google.maps.DirectionsStatus.OK || !leg) {
            clearRouteFromMap();
            resetRouteDisplay();
            renderRouteStepsMessage('No route suggestion found. Try a suggested address from the list.', 'Route unavailable');
            setMapHint('No route suggestion found. Use a valid pickup and destination.');
            return;
        }

        mapState.latestDirections = result;
        mapState.latestLeg = leg;
        mapState.directionsRenderer.setDirections(result);
        fitMapToLatestRoute(result);
        renderRouteAndFare(leg);
        renderRouteSteps(leg.steps || []);
        setMapHint('Route suggestion loaded. Estimated fare updated.');
    });
}

function scheduleRouteEstimate(delay = 300) {
    if (mapState.routeDebounceId) clearTimeout(mapState.routeDebounceId);
    updateRoutePreviewLabels();
    if (!mapState.directionsService || !window.google?.maps) {
        ensureRideRequestMapReady();
        return;
    }
    mapState.routeDebounceId = setTimeout(() => {
        mapState.routeDebounceId = null;
        requestRouteEstimate();
    }, delay);
}

function setupAutocomplete(input, key) {
    const autocomplete = new google.maps.places.Autocomplete(input, {
        fields: ['formatted_address', 'geometry', 'place_id'],
        componentRestrictions: { country: 'ug' }
    });
    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place?.formatted_address) input.value = place.formatted_address;
        customerState.places[key] = place || null;
        scheduleRouteEstimate(0);
    });
    input.addEventListener('input', () => {
        customerState.places[key] = null;
        scheduleRouteEstimate();
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
    mapState.directionsRenderer = new google.maps.DirectionsRenderer({
        map: mapState.map,
        suppressMarkers: false
    });

    setupAutocomplete(document.getElementById('pickup-location'), 'pickup');
    setupAutocomplete(document.getElementById('dropoff-location'), 'dropoff');
    document.getElementById('pickup-location').addEventListener('blur', () => scheduleRouteEstimate(0));
    document.getElementById('dropoff-location').addEventListener('blur', () => scheduleRouteEstimate(0));
    document.getElementById('ride-date').addEventListener('change', () => {
        if (mapState.latestLeg) renderRouteAndFare(mapState.latestLeg);
    });
    document.getElementById('car-type').addEventListener('change', () => {
        if (mapState.latestLeg) renderRouteAndFare(mapState.latestLeg);
    });

    resetRouteDisplay();
    setMapHint('Enter pickup and destination to see route suggestions on the map.');

    if (document.getElementById('pickup-location').value.trim() && document.getElementById('dropoff-location').value.trim()) {
        scheduleRouteEstimate(0);
    }
}

window.initRideRequest = initRideRequest;

function ensureRideRequestMapReady() {
    if (!document.getElementById('map')) return;
    if (mapState.map && window.google?.maps) return;
    loadGoogleMapsScript();
}

async function loadGoogleMapsScript() {
    if (!document.getElementById('map')) return;
    if (window.google?.maps?.places) return initRideRequest();
    if (mapState.scriptRequested) return;

    const config = await getPublicConfig();
    if (!config.googleMapsApiKey) {
        setMapHint('Missing Google Maps API key in backend config.');
        return;
    }

    mapState.scriptRequested = true;
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsApiKey)}&libraries=places&callback=initRideRequest`;
    script.onerror = () => {
        mapState.scriptRequested = false;
        setMapHint('Failed to load Google Maps. Check API key restrictions.');
    };
    document.body.appendChild(script);
}

function renderCustomerSnapshot(snapshot) {
    handleCustomerAlerts(snapshot);
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
    startHeroSlider();
    ['click', 'keydown', 'touchstart'].forEach((eventName) => {
        document.addEventListener(eventName, () => { getCustomerAudioContext(); }, { once: true });
    });
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
        if (mapState.isLoadingRoute) {
            showToast('Please wait for the route suggestion and fare estimate to finish loading.', 'error');
            return;
        }
        if (!mapState.latestLeg) {
            scheduleRouteEstimate(0);
            showToast('Enter pickup and destination, then wait for the route suggestion and estimated fare to appear.', 'error');
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

    if (typeof google !== 'undefined') initializeGoogleSignIn();
});
