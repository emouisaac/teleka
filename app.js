const adminState = {
    pollId: null,
    pendingDrivers: new Map(),
    modalOpen: false,
    audioContext: null,
    seenPendingRideIds: new Set(),
    hasLoadedSnapshot: false
};

function getAdminAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!adminState.audioContext) adminState.audioContext = new AudioCtx();
    if (adminState.audioContext.state === 'suspended') adminState.audioContext.resume().catch(() => {});
    return adminState.audioContext;
}

function playAdminRequestAlert() {
    const context = getAdminAudioContext();
    if (!context) return;
    const start = context.currentTime + 0.02;
    [1047, 1319, 1568].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start + (index * 0.16));
        gain.gain.setValueAtTime(0.0001, start + (index * 0.16));
        gain.gain.exponentialRampToValueAtTime(0.12, start + (index * 0.16) + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (index * 0.16) + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start + (index * 0.16));
        oscillator.stop(start + (index * 0.16) + 0.2);
    });
}

function handleAdminRideAlerts(snapshot) {
    const pendingRideIds = new Set((snapshot.latestRides || [])
        .filter((ride) => ride.status === 'pending')
        .map((ride) => Number(ride.id))
        .filter(Number.isFinite));

    if (!adminState.hasLoadedSnapshot) {
        adminState.seenPendingRideIds = pendingRideIds;
        adminState.hasLoadedSnapshot = true;
        return;
    }

    const hasNewPendingRide = [...pendingRideIds].some((id) => !adminState.seenPendingRideIds.has(id));
    adminState.seenPendingRideIds = pendingRideIds;
    if (hasNewPendingRide) playAdminRequestAlert();
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('open');
}

function closeSidebarOnClickOutside(event) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || !sidebar.classList.contains('open') || window.innerWidth > 768) return;
    if (event.target.closest('.sidebar') || event.target.closest('#adminSidebarToggle')) return;
    sidebar.classList.remove('open');
}

function resetSidebarOnResize() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    if (window.innerWidth > 768) sidebar.classList.remove('open');
}

function setAdminShellVisibility(isAuthenticated) {
    document.querySelector('.sidebar')?.classList.toggle('hidden', !isAuthenticated);
    document.querySelector('.content')?.classList.toggle('hidden', !isAuthenticated);
    document.querySelector('.topbar')?.classList.toggle('hidden', !isAuthenticated);
    document.getElementById('adminAuthPanel')?.classList.toggle('hidden', isAuthenticated);
}

function showAdminSection(sectionId) {
    document.querySelectorAll('.section').forEach((section) => {
        section.classList.toggle('active', section.id === sectionId);
    });
    document.querySelectorAll('.sidebar-item[data-section]').forEach((item) => {
        item.classList.toggle('active', item.getAttribute('data-section') === sectionId);
    });
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

function formatMoney(value) {
    return `UGX ${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
}

function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseDriverDocuments(rawValue) {
    try {
        const parsed = JSON.parse(rawValue || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function renderDriverAsset(title, dataUrl, emptyText, altText) {
    if (!dataUrl) return `<div class="upload-preview-empty">${escapeHtml(emptyText)}</div>`;
    return `
        <div class="upload-preview-item">
          <strong>${escapeHtml(title)}</strong>
          <img src="${dataUrl}" class="doc-preview-image" alt="${escapeHtml(altText)}" />
        </div>
    `;
}

function renderDriverDocumentItem(item, index) {
    if (typeof item === 'string') {
        return `
            <div class="upload-preview-item">
              <strong>${escapeHtml(item || `Document ${index + 1}`)}</strong>
              <span class="muted">Saved document metadata</span>
            </div>
        `;
    }

    const name = item?.name || `Document ${index + 1}`;
    const type = item?.type || 'Uploaded document';
    const dataUrl = item?.dataUrl || '';
    const preview = /^data:image\//i.test(dataUrl)
        ? `<img src="${dataUrl}" class="doc-preview-image doc-preview-image--small" alt="${escapeHtml(name)}" />`
        : dataUrl
            ? `<a class="btn small outline" href="${dataUrl}" target="_blank" rel="noopener noreferrer">Open file</a>`
            : '';

    return `
        <div class="upload-preview-item">
          ${preview}
          <strong>${escapeHtml(name)}</strong>
          <span class="muted">${escapeHtml(type)}</span>
        </div>
    `;
}

function renderSummary(summary) {
    if (!summary) return;
    document.getElementById('summaryCustomers').textContent = summary.customers || 0;
    document.getElementById('summaryDriversOnline').textContent = summary.drivers_online || 0;
    document.getElementById('summaryPendingRides').textContent = summary.pending_rides || 0;
    document.getElementById('summaryActiveRides').textContent = summary.active_rides || 0;
    document.getElementById('summaryCompletedRides').textContent = summary.completed_rides || 0;
    document.getElementById('summaryRevenue').textContent = formatMoney(summary.revenue);
}

function renderTableRows(tbodyId, rowsHtml) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = rowsHtml || '<tr><td colspan="8">No records found.</td></tr>';
}

function renderSnapshot(snapshot) {
    handleAdminRideAlerts(snapshot);
    renderSummary(snapshot.summary);

    renderTableRows('overviewRidesBody', (snapshot.latestRides || []).map((ride) => `
        <tr>
          <td>#${ride.id}</td>
          <td>${ride.customer_name || '--'}</td>
          <td>${ride.driver_name || 'Unassigned'}</td>
          <td>${ride.pickup_location} -> ${ride.dropoff_location}</td>
          <td>${ride.status}</td>
          <td>${formatMoney(ride.final_fare ?? ride.estimated_fare)}</td>
        </tr>
    `).join(''));

    renderTableRows('usersTableBody', (snapshot.users || []).map((user) => `
        <tr><td>${user.name}</td><td>${user.email}</td><td>${user.phone || '--'}</td><td>${formatDate(user.created_at)}</td></tr>
    `).join(''));

    adminState.pendingDrivers = new Map((snapshot.pendingDrivers || []).map((driver) => [driver.id, driver]));
    renderTableRows('driverApplicationsBody', (snapshot.pendingDrivers || []).map((driver) => `
        <tr>
          <td>${driver.name}</td>
          <td>${driver.phone || '--'}</td>
          <td>${driver.vehicle_info || '--'}</td>
          <td><button class="btn small" onclick="viewDocuments(${driver.id})">View</button></td>
          <td><span class="status-badge pending">${driver.status}</span></td>
          <td>
            <button class="btn small primary" onclick="approveDriver(${driver.id})">Approve</button>
            <button class="btn small secondary" onclick="rejectDriver(${driver.id})">Reject</button>
          </td>
        </tr>
    `).join(''));

    renderTableRows('driversTableBody', (snapshot.approvedDrivers || []).map((driver) => `
        <tr>
          <td>${driver.name}</td><td>${driver.phone || '--'}</td><td>${driver.vehicle_info || '--'}</td>
          <td>${driver.is_online ? 'Online' : 'Offline'}</td><td>${Number(driver.rating || 0).toFixed(1)}</td>
          <td>${driver.current_ride_id ? `#${driver.current_ride_id}` : '--'}</td>
          <td>${driver.review_count || 0} reviews</td><td>Active</td>
        </tr>
    `).join(''));

    renderTableRows('ridesTableBody', (snapshot.rides || []).map((ride) => `
        <tr>
          <td>#${ride.id}</td><td>${ride.customer_name || '--'}</td><td>${ride.driver_name || 'Unassigned'}</td>
          <td>${ride.pickup_location}</td><td>${ride.dropoff_location}</td><td>${ride.status}</td>
          <td>${formatMoney(ride.final_fare ?? ride.estimated_fare)}</td>
          <td>${['pending','accepted','arrived','enroute'].includes(ride.status) ? `<button class="btn small secondary" onclick="setRideStatus(${ride.id}, 'cancelled')">Cancel</button>` : '--'}</td>
        </tr>
    `).join(''));

    document.getElementById('earningsRevenue').textContent = formatMoney(snapshot.earnings?.revenue);
    document.getElementById('earningsCompletedTrips').textContent = snapshot.earnings?.completed_trips || 0;
    document.getElementById('earningsCancelledTrips').textContent = snapshot.earnings?.cancelled_trips || 0;
    renderTableRows('driverEarningsBody', (snapshot.earnings?.driverEarnings || []).map((row) => `
        <tr><td>${row.name}</td><td>${row.trips || 0}</td><td>${formatMoney(row.today_earnings)}</td><td>${formatMoney(row.total_earnings)}</td></tr>
    `).join(''));

    renderTableRows('notificationsBody', (snapshot.notifications || []).map((note) => `
        <tr><td>${formatDate(note.created_at)}</td><td>${note.target_role}</td><td>${note.type || 'info'}</td><td>${note.message}</td></tr>
    `).join(''));

    renderTableRows('driverResetRequestsBody', (snapshot.resetRequests || []).map((row) => `
        <tr><td>#${row.driver_id || '--'}</td><td>${row.driver_phone || '--'}</td><td>${row.whatsapp || '--'}</td><td>${row.status}</td><td>${formatDate(row.created_at)}</td><td>--</td></tr>
    `).join(''));

    const pricing = snapshot.pricing || {};
    document.getElementById('settingBaseFare').value = pricing.base_fare ?? 3500;
    document.getElementById('settingPerKm').value = pricing.per_km ?? 1200;
    document.getElementById('settingPerMin').value = pricing.per_min ?? 180;
    document.getElementById('settingSurge').value = pricing.surge_multiplier ?? 1.15;
    document.getElementById('settingCancelFee').value = pricing.cancellation_fee ?? 2500;
}

async function loadAdminSnapshot() {
    try {
        const snapshot = await api('/api/admin/snapshot');
        renderSnapshot(snapshot);
    } catch (error) {
        console.error('Snapshot load failed:', error);
    }
}

function startPolling() {
    clearInterval(adminState.pollId);
    loadAdminSnapshot();
    adminState.pollId = setInterval(loadAdminSnapshot, 5000);
}

async function checkAdminAuth() {
    try {
        const response = await fetch('/auth/status', { credentials: 'include' });
        const data = await response.json();
        const authorized = Boolean(data.authenticated && data.user?.role === 'admin');
        setAdminShellVisibility(authorized);
        if (authorized) startPolling();
    } catch (error) {
        console.error('Auth check failed:', error);
        setAdminShellVisibility(false);
    }
}

async function approveDriver(driverId) {
    await api(`/api/drivers/approve/${driverId}`, { method: 'POST' });
    loadAdminSnapshot();
}

async function rejectDriver(driverId) {
    if (!confirm('Reject this driver application?')) return;
    await api(`/api/drivers/reject/${driverId}`, { method: 'POST' });
    loadAdminSnapshot();
}

function viewDocuments(driverId) {
    const driver = adminState.pendingDrivers.get(driverId);
    const body = document.getElementById('driverDocsModalBody');
    const modal = document.getElementById('driverDocsModal');
    if (!body || !modal) return;
    const docs = parseDriverDocuments(driver?.docs_json);
    body.innerHTML = `
        <div class="doc-preview-list">
          ${renderDriverAsset('Face photo', driver?.profile_photo_url, 'No face photo uploaded yet.', `${driver?.name || 'Driver'} face photo`)}
          ${renderDriverAsset('Car photo', driver?.car_photo_url, 'No car photo uploaded yet.', `${driver?.name || 'Driver'} car photo`)}
          ${docs.length
            ? docs.map((item, index) => renderDriverDocumentItem(item, index)).join('')
            : '<div class="upload-preview-empty">No uploaded document files.</div>'}
        </div>
    `;
    modal.classList.remove('hidden');
}

function closeDocsModal() {
    document.getElementById('driverDocsModal')?.classList.add('hidden');
}

async function setRideStatus(rideId, status) {
    await api(`/api/admin/rides/${rideId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
    });
    loadAdminSnapshot();
}

document.addEventListener('DOMContentLoaded', () => {
    ['click', 'keydown', 'touchstart'].forEach((eventName) => {
        document.addEventListener(eventName, () => { getAdminAudioContext(); }, { once: true });
    });
    document.getElementById('adminLoginForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('adminEmail').value;
        const password = document.getElementById('adminPassword').value;
        try {
            await api('/auth/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) });
            checkAdminAuth();
        } catch (error) {
            alert(error.message || 'Login failed');
        }
    });

    document.getElementById('adminSidebarLogout')?.addEventListener('click', async () => {
        try {
            await api('/auth/admin/logout', { method: 'POST' });
            clearInterval(adminState.pollId);
            setAdminShellVisibility(false);
        } catch (error) {
            alert(error.message || 'Logout failed');
        }
    });

    document.querySelectorAll('.sidebar-item[data-section]').forEach((item) => {
        item.addEventListener('click', () => showAdminSection(item.getAttribute('data-section')));
    });

    document.getElementById('pricingForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await api('/api/admin/pricing', {
            method: 'PUT',
            body: JSON.stringify({
                baseFare: document.getElementById('settingBaseFare').value,
                perKm: document.getElementById('settingPerKm').value,
                perMin: document.getElementById('settingPerMin').value,
                surgeMultiplier: document.getElementById('settingSurge').value,
                cancellationFee: document.getElementById('settingCancelFee').value
            })
        });
        loadAdminSnapshot();
    });

    document.getElementById('notificationForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await api('/api/admin/notifications', {
            method: 'POST',
            body: JSON.stringify({
                target: document.getElementById('notificationTarget').value,
                message: document.getElementById('notificationMessage').value
            })
        });
        document.getElementById('notificationMessage').value = '';
        loadAdminSnapshot();
    });

    document.getElementById('exportBackupBtn')?.addEventListener('click', () => window.open('/api/admin/export', '_blank'));
    document.getElementById('restoreBackupBtn')?.addEventListener('click', () => alert('Restore endpoint is disabled from UI for safety. Use export + controlled restore process.'));
    document.getElementById('closeDriverDocsModal')?.addEventListener('click', closeDocsModal);

    document.addEventListener('click', closeSidebarOnClickOutside);
    window.addEventListener('resize', resetSidebarOnResize);
    checkAdminAuth();
});

window.approveDriver = approveDriver;
window.rejectDriver = rejectDriver;
window.viewDocuments = viewDocuments;
window.setRideStatus = setRideStatus;
