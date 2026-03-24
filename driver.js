let driverToken = localStorage.getItem('driverToken');
let pollId = null;
let currentIncomingRideId = null;
let currentActiveRideId = null;
let earningsChart = null;
const DRIVER_DEFAULT_MAP_CENTER = { lat: 0.3476, lng: 32.5825 };
const driverMapState = {
    publicConfig: null,
    map: null,
    directionsService: null,
    directionsRenderer: null,
    driverMarker: null,
    pickupMarker: null,
    dropoffMarker: null,
    watchId: null,
    currentPosition: null,
    lastSnapshot: null,
    scriptRequested: false
};

const DOM = {
    sidebar: null,
    authPanel: null,
    dashboard: null,
    menuToggle: null,
    driverName: null,
    loginForm: null,
    registerForm: null,
    navLinks: null,
    sidebarLogoutBtn: null,

    init() {
        this.sidebar = document.querySelector('.driver-sidebar');
        this.authPanel = document.getElementById('driverAuthPanel');
        this.dashboard = document.getElementById('dashboard');
        this.menuToggle = document.getElementById('menuToggle');
        this.driverName = document.getElementById('driverName');
        this.loginForm = document.getElementById('driverLoginForm');
        this.registerForm = document.getElementById('driverRegisterForm');
        this.navLinks = document.querySelectorAll('.nav-link, .bottom-nav-item');
        this.sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
    }
};

function showNotification(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `notification notification--${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 250);
    }, 2800);
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

async function driverApi(url, options = {}) {
    if (!driverToken) throw new Error('Missing driver token');
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${driverToken}`,
            ...(options.headers || {})
        },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

async function publicApi(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function toggleDriverMenu() {
    if (!DOM.sidebar) return;
    DOM.sidebar.classList.toggle('open');
}

function closeDriverMenuOnClickOutside(event) {
    if (!DOM.sidebar || !DOM.sidebar.classList.contains('open') || window.innerWidth > 768) return;
    if (event.target.closest('.driver-sidebar') || event.target.closest('#menuToggle')) return;
    DOM.sidebar.classList.remove('open');
}

function getDriverMapElement() {
    return document.getElementById('driverMap');
}

function setDriverMapText(note, mode, route) {
    const noteEl = document.getElementById('driverMapNote');
    const modeEl = document.getElementById('driverMapMode');
    const routeEl = document.getElementById('driverMapRoute');
    if (noteEl && note !== undefined) noteEl.textContent = note;
    if (modeEl && mode !== undefined) modeEl.textContent = mode;
    if (routeEl && route !== undefined) routeEl.textContent = route;
}

function updateDriverMapCanvasState(isLive) {
    const mapEl = getDriverMapElement();
    if (!mapEl) return;
    mapEl.classList.toggle('is-live', Boolean(isLive));
}

function clearDriverMapDirections() {
    driverMapState.directionsRenderer?.set('directions', null);
}

function clearMarker(markerKey) {
    const marker = driverMapState[markerKey];
    if (marker) marker.setMap(null);
    driverMapState[markerKey] = null;
}

function clearRideMarkers() {
    clearMarker('pickupMarker');
    clearMarker('dropoffMarker');
}

function isFiniteCoordinate(value) {
    return Number.isFinite(Number(value));
}

function createMarker(options) {
    return new google.maps.Marker(options);
}

function ensureDriverMapMarker(key, options) {
    const existing = driverMapState[key];
    if (existing) {
        existing.setOptions(options);
        return existing;
    }
    const marker = createMarker(options);
    driverMapState[key] = marker;
    return marker;
}

function rideCoordinatePoint(ride, prefix) {
    const lat = Number(ride?.[`${prefix}_lat`]);
    const lng = Number(ride?.[`${prefix}_lng`]);
    if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lng)) return null;
    return { lat, lng };
}

function getRideMapMode(snapshot) {
    if (snapshot?.activeRide) {
        return snapshot.activeRide.status === 'accepted' ? 'Heading to pickup' : 'Trip in progress';
    }
    if (snapshot?.incomingRequest) return 'Previewing next request';
    if (snapshot?.driver?.is_online) return 'Live location tracking';
    return 'Waiting for live tracking';
}

function getRouteTarget(snapshot) {
    const activeRide = snapshot?.activeRide;
    if (activeRide) {
        const headingToPickup = activeRide.status === 'accepted';
        return {
            ride: activeRide,
            destination: rideCoordinatePoint(activeRide, headingToPickup ? 'pickup' : 'dropoff') || (headingToPickup ? activeRide.pickup_location : activeRide.dropoff_location),
            routeLabel: headingToPickup
                ? `To pickup: ${activeRide.pickup_location}`
                : `To destination: ${activeRide.dropoff_location}`,
            showPickup: true,
            showDropoff: true
        };
    }

    const incoming = snapshot?.incomingRequest;
    if (incoming) {
        return {
            ride: incoming,
            destination: rideCoordinatePoint(incoming, 'pickup') || incoming.pickup_location,
            routeLabel: `Incoming pickup: ${incoming.pickup_location}`,
            showPickup: true,
            showDropoff: Boolean(incoming.dropoff_location)
        };
    }

    return null;
}

function updateRideMarkers(ride, target) {
    if (!driverMapState.map || !window.google?.maps) return;
    const pickup = rideCoordinatePoint(ride, 'pickup');
    const dropoff = rideCoordinatePoint(ride, 'dropoff');

    if (target?.showPickup && pickup) {
        ensureDriverMapMarker('pickupMarker', {
            map: driverMapState.map,
            position: pickup,
            label: 'P',
            title: ride.pickup_location || 'Pickup'
        });
    } else {
        clearMarker('pickupMarker');
    }

    if (target?.showDropoff && dropoff) {
        ensureDriverMapMarker('dropoffMarker', {
            map: driverMapState.map,
            position: dropoff,
            label: 'D',
            title: ride.dropoff_location || 'Destination'
        });
    } else {
        clearMarker('dropoffMarker');
    }
}

function updateDriverPosition(position, centerMap = false) {
    driverMapState.currentPosition = position;
    if (!driverMapState.map || !window.google?.maps) return;
    const marker = ensureDriverMapMarker('driverMarker', {
        map: driverMapState.map,
        position,
        title: 'Your live location',
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#0d9488',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2
        }
    });
    marker.setPosition(position);
    if (centerMap) driverMapState.map.panTo(position);
}

function fitDriverMapBounds(points) {
    if (!driverMapState.map || !window.google?.maps || !points.length) return;
    if (points.length === 1) {
        driverMapState.map.setCenter(points[0]);
        driverMapState.map.setZoom(15);
        return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    driverMapState.map.fitBounds(bounds, 60);
}

function renderDriverFallbackMap(snapshot) {
    clearDriverMapDirections();
    const target = getRouteTarget(snapshot);
    if (target?.ride) updateRideMarkers(target.ride, target);
    else clearRideMarkers();

    const points = [];
    if (driverMapState.currentPosition) points.push(driverMapState.currentPosition);
    const pickup = target?.ride ? rideCoordinatePoint(target.ride, 'pickup') : null;
    const dropoff = target?.ride ? rideCoordinatePoint(target.ride, 'dropoff') : null;
    if (pickup) points.push(pickup);
    if (dropoff) points.push(dropoff);
    if (points.length) fitDriverMapBounds(points);

    setDriverMapText(
        snapshot?.driver?.is_online
            ? (driverMapState.currentPosition ? 'Live GPS is active. Route details update automatically.' : 'Allow location access to show your live position.')
            : 'Go online and allow location access to show your live map.',
        getRideMapMode(snapshot),
        target?.routeLabel || 'No active route'
    );
}

function refreshDriverMap(snapshot = driverMapState.lastSnapshot) {
    if (!snapshot || !driverMapState.map || !window.google?.maps) return;
    updateDriverMapCanvasState(true);

    const target = getRouteTarget(snapshot);
    if (!snapshot.driver?.is_online) {
        clearDriverMapDirections();
        clearRideMarkers();
        setDriverMapText('Go online and allow location access to show your live map.', 'Waiting for live tracking', 'No active route');
        if (driverMapState.currentPosition) {
            updateDriverPosition(driverMapState.currentPosition);
            fitDriverMapBounds([driverMapState.currentPosition]);
        } else {
            driverMapState.map.setCenter(DRIVER_DEFAULT_MAP_CENTER);
            driverMapState.map.setZoom(12);
        }
        return;
    }

    if (!driverMapState.currentPosition) {
        renderDriverFallbackMap(snapshot);
        return;
    }

    updateDriverPosition(driverMapState.currentPosition);

    if (!target) {
        clearDriverMapDirections();
        clearRideMarkers();
        fitDriverMapBounds([driverMapState.currentPosition]);
        setDriverMapText('Live GPS is active and following your current position.', 'Live location tracking', 'No active route');
        return;
    }

    updateRideMarkers(target.ride, target);
    if (!driverMapState.directionsService || !target.destination) {
        renderDriverFallbackMap(snapshot);
        return;
    }

    driverMapState.directionsService.route({
        origin: driverMapState.currentPosition,
        destination: target.destination,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC
    }, (result, status) => {
        if (!driverMapState.lastSnapshot || driverMapState.lastSnapshot !== snapshot) return;
        if (status !== google.maps.DirectionsStatus.OK || !result?.routes?.[0]) {
            renderDriverFallbackMap(snapshot);
            return;
        }
        driverMapState.directionsRenderer.setDirections(result);
        if (result.routes[0].bounds) driverMapState.map.fitBounds(result.routes[0].bounds, 60);
        updateRideMarkers(target.ride, target);
        setDriverMapText('Live GPS is active. The route refreshes as your location changes.', getRideMapMode(snapshot), target.routeLabel);
    });
}

async function getDriverPublicConfig() {
    if (!driverMapState.publicConfig) {
        driverMapState.publicConfig = await publicApi('/api/public/config').catch(() => ({}));
    }
    return driverMapState.publicConfig;
}

function initDriverLiveMap() {
    if (driverMapState.map || !window.google?.maps) return;
    const mapEl = getDriverMapElement();
    if (!mapEl) return;
    mapEl.innerHTML = '';
    driverMapState.map = new google.maps.Map(mapEl, {
        center: DRIVER_DEFAULT_MAP_CENTER,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
    });
    driverMapState.directionsService = new google.maps.DirectionsService();
    driverMapState.directionsRenderer = new google.maps.DirectionsRenderer({
        map: driverMapState.map,
        suppressMarkers: true,
        polylineOptions: {
            strokeColor: '#0241c8',
            strokeOpacity: 0.85,
            strokeWeight: 6
        }
    });
    updateDriverMapCanvasState(true);
    refreshDriverMap();
}

window.initDriverLiveMap = initDriverLiveMap;

async function loadDriverMapScript() {
    if (!getDriverMapElement()) return;
    if (window.google?.maps) return initDriverLiveMap();
    if (driverMapState.scriptRequested) return;

    driverMapState.scriptRequested = true;
    const config = await getDriverPublicConfig();
    if (!config.googleMapsApiKey) {
        driverMapState.scriptRequested = false;
        setDriverMapText('Missing Google Maps API key in backend config.', 'Map unavailable', 'No active route');
        return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsApiKey)}&callback=initDriverLiveMap`;
    script.onerror = () => {
        driverMapState.scriptRequested = false;
        setDriverMapText('Failed to load Google Maps. Check API key restrictions.', 'Map unavailable', 'No active route');
    };
    document.body.appendChild(script);
}

function stopDriverLocationWatch() {
    if (driverMapState.watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(driverMapState.watchId);
    }
    driverMapState.watchId = null;
}

function startDriverLocationWatch() {
    if (driverMapState.watchId !== null || !navigator.geolocation) {
        if (!navigator.geolocation) {
            setDriverMapText('Geolocation is not available in this browser.', 'Map unavailable', 'No active route');
        }
        return;
    }
    driverMapState.watchId = navigator.geolocation.watchPosition((position) => {
        const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        updateDriverPosition(coords, !driverMapState.lastSnapshot?.activeRide);
        refreshDriverMap();
    }, (error) => {
        const message = error.code === error.PERMISSION_DENIED
            ? 'Location access was blocked. Allow it to use the live driver map.'
            : 'Unable to read your live location right now.';
        setDriverMapText(message, getRideMapMode(driverMapState.lastSnapshot), getRouteTarget(driverMapState.lastSnapshot)?.routeLabel || 'No active route');
    }, {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000
    });
}

function syncDriverMapTracking(snapshot) {
    driverMapState.lastSnapshot = snapshot;
    loadDriverMapScript();
    if (snapshot?.driver?.is_online) startDriverLocationWatch();
    else stopDriverLocationWatch();
    refreshDriverMap(snapshot);
}

function switchSection(sectionId) {
    document.querySelectorAll('.driver-section').forEach((section) => {
        section.classList.toggle('active', section.id === sectionId);
    });
    DOM.navLinks?.forEach((link) => {
        const active = link.getAttribute('data-section') === sectionId;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    if (window.innerWidth <= 768) DOM.sidebar?.classList.remove('open');
    if (sectionId === 'dashboard') {
        setTimeout(() => {
            if (!driverMapState.map || !window.google?.maps) return;
            google.maps.event.trigger(driverMapState.map, 'resize');
            refreshDriverMap();
        }, 120);
    }
}

function showDriverAuth() {
    DOM.authPanel?.classList.add('active');
    document.querySelectorAll('.driver-section:not(#driverAuthPanel)').forEach((section) => section.classList.remove('active'));
    const sidebar = document.getElementById('driverSidebar');
    const topbar = document.querySelector('.driver-topbar');
    const footer = document.querySelector('.driver-bottom-nav');
    if (sidebar) sidebar.style.display = 'none';
    if (topbar) topbar.style.display = 'none';
    if (footer) footer.style.display = 'none';
    clearInterval(pollId);
    stopDriverLocationWatch();
}

function showDriverDashboard(name) {
    DOM.authPanel?.classList.remove('active');
    const sidebar = document.getElementById('driverSidebar');
    const topbar = document.querySelector('.driver-topbar');
    const footer = document.querySelector('.driver-bottom-nav');
    if (sidebar) sidebar.style.display = '';
    if (topbar) topbar.style.display = '';
    if (footer) footer.style.display = '';
    DOM.driverName.textContent = name || 'Driver';
    switchSection('dashboard');
    loadDriverMapScript();
    startPolling();
}

function logoutDriver() {
    driverToken = null;
    localStorage.removeItem('driverToken');
    stopDriverLocationWatch();
    showDriverAuth();
}

async function checkDriverAuth() {
    if (!driverToken) return showDriverAuth();
    try {
        const response = await fetch('/auth/driver/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: driverToken })
        });
        const data = await response.json();
        if (!data.valid || !data.driver) return logoutDriver();
        showDriverDashboard(data.driver.name);
    } catch (error) {
        console.error('Driver auth failed:', error);
        logoutDriver();
    }
}

function applyOnlineState(isOnline) {
    const toggle = document.getElementById('onlineToggle');
    const label = document.getElementById('onlineLabel');
    const status = document.getElementById('driverStatus');
    const mapStatus = document.getElementById('mapStatus');
    const actionBtn = document.getElementById('actionGoOnline');
    if (toggle) toggle.checked = isOnline;
    if (label) label.textContent = isOnline ? 'Online' : 'Go Online';
    if (status) status.textContent = isOnline ? 'Online' : 'Offline';
    if (mapStatus) mapStatus.textContent = isOnline ? 'Online' : 'Offline';
    mapStatus?.classList.toggle('live', isOnline);
    if (actionBtn) actionBtn.textContent = isOnline ? 'Go Offline' : 'Go Online';
}

function renderSnapshot(snapshot) {
    const driver = snapshot.driver || {};
    DOM.driverName.textContent = driver.name || 'Driver';
    applyOnlineState(Boolean(driver.is_online));
    syncDriverMapTracking(snapshot);

    document.getElementById('statEarnings').textContent = formatMoney(snapshot.stats?.earnings_today);
    document.getElementById('statTrips').textContent = snapshot.stats?.trips_completed || 0;
    document.getElementById('statRating').textContent = Number(driver.rating || 0).toFixed(1);
    document.getElementById('statNotifications').textContent = snapshot.notifications?.length || 0;
    document.getElementById('statUnreadNotifs').textContent = snapshot.unreadCount || 0;

    const incoming = snapshot.incomingRequest;
    currentIncomingRideId = incoming?.id || null;
    document.getElementById('requestEmpty').classList.toggle('hidden', Boolean(incoming));
    document.getElementById('incomingRequest').classList.toggle('hidden', !incoming);
    if (incoming) {
        document.getElementById('requestPassenger').textContent = incoming.customer_name || 'Passenger';
        document.getElementById('requestRoute').textContent = `${incoming.pickup_location} -> ${incoming.dropoff_location}`;
        document.getElementById('requestFare').textContent = formatMoney(incoming.estimated_fare);
        document.getElementById('requestDistance').textContent = `${Number(incoming.distance_km || 0).toFixed(1)} km`;
    }

    const active = snapshot.activeRide;
    currentActiveRideId = active?.id || null;
    document.getElementById('statActiveRide').textContent = active ? `#${active.id}` : 'None';
    document.getElementById('statDistance').textContent = `${Number(active?.distance_km || snapshot.stats?.active_distance || 0).toFixed(1)} km`;
    document.getElementById('statFare').textContent = formatMoney(active?.final_fare ?? active?.estimated_fare ?? 0);
    document.getElementById('activeRidePanel').classList.toggle('hidden', !active);
    document.getElementById('activeRideEmpty').classList.toggle('hidden', Boolean(active));
    if (active) {
        document.getElementById('activePassenger').textContent = active.customer_name || 'Passenger';
        document.getElementById('activeRoute').textContent = `${active.pickup_location} -> ${active.dropoff_location}`;
        document.getElementById('activeStatus').textContent = active.status;
        document.getElementById('activeDistance').textContent = `${Number(active.distance_km || 0).toFixed(1)} km`;
        document.getElementById('activeFare').textContent = formatMoney(active.final_fare ?? active.estimated_fare);
        document.getElementById('timelinePickup').textContent = active.status === 'accepted' ? 'Heading to pickup' : 'Reached pickup';
        document.getElementById('timelineEnroute').textContent = active.status === 'enroute' ? 'Trip in progress' : 'Not started';
        document.getElementById('timelineComplete').textContent = active.status === 'completed' ? 'Done' : 'Not started';
        document.getElementById('rideAction').textContent = active.status === 'accepted' ? 'Arrived' : active.status === 'arrived' ? 'Start Trip' : 'Complete Ride';
        document.getElementById('navButton').href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(active.dropoff_location)}`;
    }

    document.getElementById('historyList').innerHTML = (snapshot.history || []).map((ride) => `
        <article class="history-item">
          <div><strong>#${ride.id}</strong> ${ride.customer_name || '--'} - ${ride.status}</div>
          <div class="muted">${ride.pickup_location} -> ${ride.dropoff_location}</div>
          <div>${formatMoney(ride.final_fare ?? ride.estimated_fare)} | ${formatDate(ride.updated_at)}</div>
        </article>
    `).join('') || '<p class="muted">No trip history yet.</p>';

    document.getElementById('notificationsList').innerHTML = (snapshot.notifications || []).map((note) => `
        <article class="history-item">
          <div><strong>${note.title || 'Update'}</strong></div>
          <div class="muted">${note.message}</div>
          <div>${formatDate(note.created_at)}</div>
        </article>
    `).join('') || '<p class="muted">No notifications yet.</p>';

    document.getElementById('reviewList').innerHTML = (snapshot.reviews || []).map((item) => `
        <article class="review-card"><div class="review-head"><strong>${Number(item.customer_rating || 0).toFixed(1)} stars</strong></div><p class="review-text">${item.customer_review || 'No text'}</p></article>
    `).join('') || '<p class="muted">No reviews yet.</p>';

    document.getElementById('earningsToday').textContent = formatMoney(snapshot.stats?.earnings_today);
    document.getElementById('earningsWeek').textContent = formatMoney(snapshot.stats?.earnings_week);
    document.getElementById('earningsTrips').textContent = snapshot.stats?.trips_completed || 0;

    document.getElementById('profileName').value = driver.name || '';
    document.getElementById('profilePhone').value = driver.phone || '';
    document.getElementById('profileVehicle').value = driver.vehicle_info || '';
    document.getElementById('profilePlate').value = driver.plate_number || '';

    const chartData = [snapshot.stats?.earnings_today || 0, snapshot.stats?.earnings_week || 0, (snapshot.stats?.earnings_week || 0) - (snapshot.stats?.earnings_today || 0)];
    if (window.Chart) {
        if (earningsChart) earningsChart.destroy();
        earningsChart = new Chart(document.getElementById('earningsChart'), {
            type: 'bar',
            data: { labels: ['Today', 'This Week', 'Earlier Week'], datasets: [{ label: 'UGX', data: chartData }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}

async function loadDriverSnapshot() {
    try {
        const snapshot = await driverApi('/api/driver/snapshot');
        renderSnapshot(snapshot);
    } catch (error) {
        console.error('Snapshot failed:', error);
        if (String(error.message).includes('401')) logoutDriver();
    }
}

function startPolling() {
    clearInterval(pollId);
    loadDriverSnapshot();
    pollId = setInterval(loadDriverSnapshot, 5000);
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('driverLoginEmail').value.trim();
    const password = document.getElementById('driverLoginPassword').value;
    try {
        const response = await fetch('/auth/driver/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Login failed');
        driverToken = data.token;
        localStorage.setItem('driverToken', driverToken);
        showDriverDashboard(data.driver?.name);
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

async function handleRegistrationSubmit(event) {
    event.preventDefault();
    const payload = {
        name: document.getElementById('registerName').value.trim(),
        email: document.getElementById('registerEmail').value.trim(),
        phone: document.getElementById('registerPhone').value.trim(),
        vehicleInfo: document.getElementById('registerVehicle').value.trim(),
        plate: document.getElementById('registerPlate').value.trim(),
        password: document.getElementById('registerPassword').value,
        licenseNumber: document.getElementById('registerLicenseNumber').value.trim(),
        nationalIdNumber: document.getElementById('registerNationalIdNumber').value.trim(),
        insuranceNumber: document.getElementById('registerInsuranceNumber').value.trim(),
        docs: [...(document.getElementById('registerDocs').files || [])].map((file) => file.name)
    };
    try {
        const response = await fetch('/auth/driver/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Registration failed');
        showNotification(data.message || 'Submitted for admin review');
        event.target.reset();
        document.querySelector('.driver-auth-card--login')?.classList.remove('hidden');
        document.getElementById('driverRegisterCard')?.classList.add('hidden');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    DOM.init();
    DOM.menuToggle?.addEventListener('click', toggleDriverMenu);
    document.addEventListener('click', closeDriverMenuOnClickOutside);

    DOM.navLinks?.forEach((link) => link.addEventListener('click', (event) => {
        const target = link.getAttribute('data-section');
        if (!target) return;
        event.preventDefault();
        switchSection(target);
    }));

    DOM.loginForm?.addEventListener('submit', handleLoginSubmit);
    DOM.registerForm?.addEventListener('submit', handleRegistrationSubmit);
    DOM.sidebarLogoutBtn?.addEventListener('click', logoutDriver);
    document.getElementById('logoutBtn')?.addEventListener('click', logoutDriver);
    document.getElementById('showRegisterForm')?.addEventListener('click', () => {
        document.querySelector('.driver-auth-card--login')?.classList.add('hidden');
        document.getElementById('driverRegisterCard')?.classList.remove('hidden');
    });
    document.getElementById('showLoginForm')?.addEventListener('click', () => {
        document.querySelector('.driver-auth-card--login')?.classList.remove('hidden');
        document.getElementById('driverRegisterCard')?.classList.add('hidden');
    });

    const onlineHandler = async () => {
        try {
            const isOnline = document.getElementById('onlineToggle').checked;
            await driverApi('/api/driver/status', { method: 'PUT', body: JSON.stringify({ isOnline }) });
            applyOnlineState(isOnline);
            loadDriverSnapshot();
        } catch (error) { showNotification(error.message, 'error'); }
    };
    document.getElementById('onlineToggle')?.addEventListener('change', onlineHandler);
    document.getElementById('actionGoOnline')?.addEventListener('click', () => {
        const toggle = document.getElementById('onlineToggle');
        toggle.checked = !toggle.checked;
        onlineHandler();
    });
    document.getElementById('actionViewRequests')?.addEventListener('click', () => switchSection('requests'));

    document.getElementById('acceptRequest')?.addEventListener('click', async () => {
        if (!currentIncomingRideId) return;
        try {
            await driverApi(`/api/driver/rides/${currentIncomingRideId}/accept`, { method: 'POST' });
            showNotification('Ride accepted');
            loadDriverSnapshot();
            switchSection('activeRide');
        } catch (error) { showNotification(error.message, 'error'); }
    });

    document.getElementById('rejectRequest')?.addEventListener('click', async () => {
        if (!currentIncomingRideId) return;
        try {
            await driverApi(`/api/driver/rides/${currentIncomingRideId}/reject`, { method: 'POST' });
            loadDriverSnapshot();
        } catch (error) { showNotification(error.message, 'error'); }
    });

    document.getElementById('rideAction')?.addEventListener('click', async () => {
        if (!currentActiveRideId) return;
        const status = document.getElementById('activeStatus').textContent;
        const action = status === 'accepted' ? 'arrived' : status === 'arrived' ? 'start' : 'complete';
        try {
            await driverApi(`/api/driver/rides/${currentActiveRideId}/status`, { method: 'POST', body: JSON.stringify({ action }) });
            loadDriverSnapshot();
        } catch (error) { showNotification(error.message, 'error'); }
    });

    document.getElementById('profileForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await driverApi('/api/driver/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    name: document.getElementById('profileName').value.trim(),
                    phone: document.getElementById('profilePhone').value.trim(),
                    vehicleInfo: document.getElementById('profileVehicle').value.trim(),
                    plate: document.getElementById('profilePlate').value.trim(),
                    docs: [...(document.getElementById('profileDocs').files || [])].map((file) => file.name)
                })
            });
            showNotification('Profile saved');
            loadDriverSnapshot();
        } catch (error) { showNotification(error.message, 'error'); }
    });

    checkDriverAuth();
});
