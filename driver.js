const DriverApp = (() => {
  const STORAGE_KEYS = {
    driverAuth: 'telekaDriverAuth',
    driverProfile: 'telekaDriverProfile',
  };

  const appEl = document.querySelector('.driver-app');
  const state = {
    auth: loadJson(STORAGE_KEYS.driverAuth, { driverId: '', token: '' }),
    profile: loadJson(STORAGE_KEYS.driverProfile, {}),
    data: null,
    chart: null,
    eventSource: null,
  };

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  const selectors = {
    section: '.driver-section',
    navLink: '.nav-link',
    bottomNav: '.bottom-nav-item',
  };

  const utils = {
    qs(selector) { return document.querySelector(selector); },
    qsa(selector) { return Array.from(document.querySelectorAll(selector)); },
    money(amount) {
      return new Intl.NumberFormat('en-UG', {
        style: 'currency',
        currency: 'UGX',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(Number(amount) || 0);
    },
    toast(message) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('visible'));
      setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
      }, 2400);
    },
    api(url, options = {}, token = state.auth.token) {
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
    },
  };

  const UI = {
    syncMenuToggle() {
      const button = document.getElementById('menuToggle');
      if (!button || !appEl) return;
      const expanded = window.innerWidth <= 900 ? appEl.classList.contains('nav-open') : !appEl.classList.contains('nav-closed');
      button.setAttribute('aria-expanded', String(expanded));
    },
    setNavState(open) {
      appEl?.classList.toggle('nav-open', open);
      UI.syncMenuToggle();
    },
    toggleNav() {
      if (window.innerWidth <= 900) UI.setNavState(!appEl?.classList.contains('nav-open'));
      else appEl?.classList.toggle('nav-closed');
      UI.syncMenuToggle();
    },
    setAuthenticated(authenticated) {
      utils.qsa('.driver-section').forEach((section) => {
        if (section.id === 'driverAuthPanel') {
          section.classList.toggle('active', !authenticated);
        } else {
          section.classList.toggle('active', false);
        }
      });
      utils.qsa('.nav-link, .bottom-nav-item').forEach((button) => {
        if (button.dataset.section === 'driverAuthPanel') {
          button.classList.toggle('active', !authenticated);
        }
      });
      utils.qs('.driver-sidebar').style.display = authenticated ? '' : 'none';
      utils.qs('.driver-topbar').style.display = authenticated ? '' : 'none';
      utils.qs('.driver-bottom-nav').style.display = authenticated ? '' : 'none';
      if (authenticated) {
        UI.setActiveSection('dashboard');
      }
    },
    toggleRegisterForm(forceOpen) {
      const registerCard = utils.qs('#driverRegisterCard');
      const toggleButton = utils.qs('#showRegisterForm');
      if (!registerCard || !toggleButton) return;
      const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : registerCard.classList.contains('hidden');
      registerCard.classList.toggle('hidden', !shouldOpen);
      toggleButton.setAttribute('aria-expanded', String(shouldOpen));
      toggleButton.textContent = shouldOpen ? 'Hide registration form' : 'No account? Register';
    },
    setActiveSection(sectionId) {
      utils.qsa(selectors.section).forEach((section) => section.classList.toggle('active', section.id === sectionId));
      utils.qsa(selectors.navLink).forEach((button) => button.classList.toggle('active', button.dataset.section === sectionId));
      utils.qsa(selectors.bottomNav).forEach((button) => button.classList.toggle('active', button.dataset.section === sectionId));
      if (window.innerWidth <= 900) UI.setNavState(false);
    },
    render() {
      const data = state.data;
      if (!data) return;
      const driver = data.driver;
      const activeRide = data.activeRide;
      const requests = data.availableRequests || [];
      const history = data.history || [];
      const notifications = data.notifications || [];

      utils.qs('#driverName').textContent = driver.name || 'Driver';
      utils.qs('#driverAvatar').src = driver.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(driver.name || 'Driver')}&background=667eea&color=fff&rounded=true&size=80`;
      utils.qs('#profileName').value = driver.name || '';
      utils.qs('#profilePhone').value = driver.phone || '';
      utils.qs('#profileVehicle').value = driver.vehicle || '';
      utils.qs('#profilePlate').value = driver.plate || '';

      const online = Boolean(driver.online);
      utils.qs('#driverStatus .status-text').textContent = online ? 'Online' : 'Offline';
      utils.qs('#driverStatus .status-dot').classList.toggle('online', online);
      utils.qs('#driverStatus .status-dot').classList.toggle('offline', !online);
      utils.qs('#onlineToggle').checked = online;
      utils.qs('#onlineLabel').textContent = online ? 'Go Offline' : 'Go Online';
      utils.qs('#mapStatus').textContent = online ? 'Live' : 'Offline';
      utils.qs('#mapStatus').classList.toggle('live', online);

      utils.qs('#statEarnings').textContent = utils.money(driver.earningsToday || 0);
      utils.qs('#statTrips').textContent = String(history.filter((ride) => ride.status === 'completed').length);
      utils.qs('#statRating').textContent = Number(driver.rating || 5).toFixed(1);
      utils.qs('#statNotifications').textContent = String(notifications.length);
      utils.qs('#statNewNotifs').textContent = String(notifications.length);
      utils.qs('#statUnreadNotifs').textContent = String(notifications.length);
      utils.qs('#notifCount').textContent = String(notifications.length);
      utils.qs('#notifCount').style.display = notifications.length ? 'inline-flex' : 'none';

      if (activeRide) {
        utils.qs('#statActiveRide').textContent = activeRide.status;
        utils.qs('#statDistance').textContent = `${Number(activeRide.distanceKm || 0).toFixed(1)} km`;
        utils.qs('#statFare').textContent = utils.money(activeRide.fare);
        utils.qs('#activeRidePanel').classList.remove('hidden');
        utils.qs('#activeRideEmpty').classList.add('hidden');
      utils.qs('#activePassenger').textContent = activeRide.customerName || 'Customer';
      utils.qs('#activeRoute').textContent = `${activeRide.pickup} → ${activeRide.dropoff}`;
        utils.qs('#activeStatus').textContent = activeRide.status;
        utils.qs('#activeDistance').textContent = `${Number(activeRide.distanceKm || 0).toFixed(1)} km`;
        utils.qs('#activeFare').textContent = utils.money(activeRide.fare);
        utils.qs('#activeElapsed').textContent = new Date(activeRide.updatedAt || activeRide.createdAt).toLocaleString();
        utils.qs('#timelinePickup').textContent = activeRide.timeline?.arrivedAt ? 'Arrived' : 'Waiting';
        utils.qs('#timelineEnroute').textContent = activeRide.timeline?.startedAt ? 'Trip started' : 'Not started';
        utils.qs('#timelineComplete').textContent = activeRide.timeline?.completedAt ? 'Completed' : 'Not started';
        utils.qs('#navButton').href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(activeRide.pickup)}&destination=${encodeURIComponent(activeRide.dropoff)}&travelmode=driving`;
        utils.qs('#chatButton').href = `chat.html?role=driver&rideId=${encodeURIComponent(activeRide.id)}`;
        utils.qs('#rideAction').textContent = activeRide.status === 'accepted' ? 'Arrived' : activeRide.status === 'arrived' ? 'Start Trip' : activeRide.status === 'in-progress' ? 'End Trip' : 'Done';
      } else {
        utils.qs('#statActiveRide').textContent = 'None';
        utils.qs('#statDistance').textContent = '0 km';
        utils.qs('#statFare').textContent = utils.money(0);
        utils.qs('#activeRidePanel').classList.add('hidden');
        utils.qs('#activeRideEmpty').classList.remove('hidden');
      }

      const firstRequest = requests[0];
      if (firstRequest && online) {
        utils.qs('#requestEmpty').classList.add('hidden');
        utils.qs('#incomingRequest').classList.remove('hidden');
        utils.qs('#requestPassenger').textContent = firstRequest.customerName || 'Customer';
        utils.qs('#requestRoute').textContent = `${firstRequest.pickup} → ${firstRequest.dropoff}`;
        utils.qs('#requestFare').textContent = utils.money(firstRequest.fare);
        utils.qs('#requestDistance').textContent = `${Number(firstRequest.distanceKm || 0).toFixed(1)} km`;
        utils.qs('#requestTimer').textContent = 'Live';
      } else {
        utils.qs('#requestEmpty').classList.remove('hidden');
        utils.qs('#incomingRequest').classList.add('hidden');
        utils.qs('#requestEmpty p').textContent = online ? 'No ride requests right now. Stay online to receive new requests.' : 'Go online to receive ride requests.';
      }

      utils.qs('#driverMap').classList.toggle('online', online);
      utils.qs('#driverMap .map-placeholder-text').textContent = activeRide ? `Assigned route: ${activeRide.pickup} to ${activeRide.dropoff}` : online ? 'You are visible to dispatch and riders.' : 'Go online to receive ride requests.';

      utils.qs('#earningsToday').textContent = utils.money(driver.earningsToday || 0);
      utils.qs('#earningsWeek').textContent = utils.money(history.filter((ride) => ride.status === 'completed').reduce((sum, ride) => sum + (ride.fare || 0), 0));
      utils.qs('#earningsTrips').textContent = String(history.filter((ride) => ride.status === 'completed').length);
      utils.qs('#breakdownBase').textContent = utils.money((driver.earningsToday || 0) * 0.45);
      utils.qs('#breakdownDistance').textContent = utils.money((driver.earningsToday || 0) * 0.35);
      utils.qs('#breakdownCommission').textContent = utils.money((driver.earningsToday || 0) * 0.2);

      const chartCanvas = utils.qs('#earningsChart');
      const chartData = history.filter((ride) => ride.status === 'completed').slice(0, 7).reverse();
      if (chartCanvas && typeof Chart !== 'undefined') {
        const labels = chartData.map((ride) => new Date(ride.updatedAt || ride.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const values = chartData.map((ride) => ride.fare || 0);
        if (!state.chart) {
          state.chart = new Chart(chartCanvas.getContext('2d'), {
            type: 'line',
            data: { labels: labels.length ? labels : ['No trips'], datasets: [{ data: values.length ? values : [0], borderColor: '#5b6cff', backgroundColor: 'rgba(102,126,234,0.2)', fill: true, tension: 0.35 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
          });
        } else {
          state.chart.data.labels = labels.length ? labels : ['No trips'];
          state.chart.data.datasets[0].data = values.length ? values : [0];
          state.chart.update();
        }
      }

      const term = utils.qs('#historySearch').value.trim().toLowerCase();
      const filter = utils.qs('#historyFilter').value;
      const nowDate = new Date();
      const filtered = history.filter((ride) => {
        const rideDate = new Date(ride.updatedAt || ride.createdAt);
        if (term && !`${ride.customerName} ${ride.id}`.toLowerCase().includes(term)) return false;
        if (filter === 'today') return rideDate.toDateString() === nowDate.toDateString();
        if (filter === 'week') return nowDate - rideDate <= 7 * 24 * 60 * 60 * 1000;
        if (filter === 'month') return nowDate - rideDate <= 30 * 24 * 60 * 60 * 1000;
        return true;
      });
      const historyList = utils.qs('#historyList');
      historyList.innerHTML = '';
      if (!filtered.length) historyList.innerHTML = '<div class="history-empty"><p>No rides match this filter.</p></div>';
      filtered.forEach((ride) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `<div class="history-header"><div><div class="history-title">${ride.customerName || 'Customer'}</div><div class="history-sub">${ride.pickup} → ${ride.dropoff}</div></div><div class="history-meta"><span class="history-fare">${utils.money(ride.fare)}</span><span class="history-date">${new Date(ride.updatedAt || ride.createdAt).toLocaleDateString()}</span></div></div><div class="history-footer"><span class="tag">${ride.status}</span><span class="muted">${Number(ride.distanceKm || 0).toFixed(1)} km</span></div>`;
        historyList.appendChild(item);
      });

      const rating = Number(driver.rating || 5).toFixed(1);
      const rounded = Math.round(Number(rating));
      utils.qs('#ratingValue').textContent = rating;
      utils.qs('#ratingStars').textContent = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
      utils.qs('#ratingCount').textContent = `${driver.ratingCount || 0} review${driver.ratingCount === 1 ? '' : 's'}`;
      const reviewList = utils.qs('#reviewList');
      reviewList.innerHTML = '';
      const completed = history.filter((ride) => ride.status === 'completed').slice(0, 5);
      if (!completed.length) reviewList.innerHTML = '<div class="review-empty"><p>No reviews yet. Complete rides to build your rating.</p></div>';
      completed.forEach((ride) => {
        const card = document.createElement('div');
        card.className = 'review-card';
        card.innerHTML = `<div class="review-head"><span class="review-name">${ride.customerName || 'Customer'}</span><span class="review-stars">★★★★★</span></div><p class="review-text">Ride ${ride.id} completed successfully.</p><div class="review-meta">${new Date(ride.updatedAt || ride.createdAt).toLocaleDateString()}</div>`;
        reviewList.appendChild(card);
      });

      const notificationsList = utils.qs('#notificationsList');
      notificationsList.innerHTML = '';
      if (!notifications.length) notificationsList.innerHTML = '<div class="notification-empty"><p>No notifications yet.</p></div>';
      notifications.forEach((item) => {
        const row = document.createElement('div');
        row.className = `notification-card ${item.type || 'info'}`;
        row.innerHTML = `<div class="notification-content"><p>${item.message}</p><span class="notification-time">${new Date(item.createdAt).toLocaleTimeString()}</span></div>`;
        notificationsList.appendChild(row);
      });
    },
  };

  const Actions = {
    async ensureSession(reset = false) {
      if (reset) state.auth = { driverId: '', token: '' };
      if (!state.auth.token) throw new Error('No stored driver session');
      await Actions.refresh();
      Actions.ensureEvents();
    },
    async refresh() {
      state.data = await utils.api('/api/driver/state');
      state.profile = state.data.driver;
      state.auth.driverId = state.data.driver.id;
      saveJson(STORAGE_KEYS.driverAuth, state.auth);
      saveJson(STORAGE_KEYS.driverProfile, state.profile);
      UI.setAuthenticated(true);
      UI.render();
    },
    ensureEvents() {
      if (!state.auth.token || state.eventSource) return;
      const stream = new EventSource(`/api/events?token=${encodeURIComponent(state.auth.token)}`);
      stream.addEventListener('state-update', () => Actions.refresh().catch(console.warn));
      stream.onerror = () => {
        stream.close();
        state.eventSource = null;
        setTimeout(() => Actions.ensureEvents(), 3000);
      };
      state.eventSource = stream;
    },
    async toggleOnline(online) {
      await utils.api(`/api/drivers/${encodeURIComponent(state.auth.driverId)}/availability`, { method: 'POST', body: JSON.stringify({ online }) });
      await Actions.refresh();
      utils.toast(`You are now ${online ? 'online' : 'offline'}.`);
    },
    async login() {
      const phone = utils.qs('#driverLoginPhone').value.trim();
      const password = utils.qs('#driverLoginPassword').value;
      const data = await utils.api('/api/drivers/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      }, '');
      state.auth = { driverId: data.driver.id, token: data.token };
      state.profile = data.driver;
      saveJson(STORAGE_KEYS.driverAuth, state.auth);
      saveJson(STORAGE_KEYS.driverProfile, state.profile);
      await Actions.refresh();
      Actions.ensureEvents();
      utils.toast('Driver login successful.');
    },
    async register() {
      const photoInput = utils.qs('#registerPhoto');
      const docsInput = utils.qs('#registerDocs');
      await utils.api('/api/drivers/register', {
        method: 'POST',
        body: JSON.stringify({
          name: utils.qs('#registerName').value.trim(),
          phone: utils.qs('#registerPhone').value.trim(),
          vehicle: utils.qs('#registerVehicle').value.trim(),
          plate: utils.qs('#registerPlate').value.trim(),
          password: utils.qs('#registerPassword').value,
          licenseNumber: utils.qs('#registerLicenseNumber').value.trim(),
          nationalIdNumber: utils.qs('#registerNationalIdNumber').value.trim(),
          insuranceNumber: utils.qs('#registerInsuranceNumber').value.trim(),
          photoName: photoInput?.files?.[0]?.name || '',
          documentNames: docsInput?.files ? Array.from(docsInput.files).map((file) => file.name) : [],
        }),
      }, '');
      utils.toast('Application submitted. Wait for admin approval before logging in.');
      utils.qs('#driverRegisterForm').reset();
      UI.toggleRegisterForm(false);
    },
    async saveProfile() {
      state.profile = {
        ...state.profile,
        name: utils.qs('#profileName').value.trim(),
        phone: utils.qs('#profilePhone').value.trim(),
        vehicle: utils.qs('#profileVehicle').value.trim(),
        plate: utils.qs('#profilePlate').value.trim(),
      };
      saveJson(STORAGE_KEYS.driverProfile, state.profile);
      await utils.api(`/api/drivers/${encodeURIComponent(state.auth.driverId)}/profile`, { method: 'POST', body: JSON.stringify(state.profile) });
      await Actions.refresh();
      utils.toast('Profile updated.');
    },
    async acceptRequest() {
      const request = state.data?.availableRequests?.[0];
      if (!request) return;
      await utils.api(`/api/rides/${encodeURIComponent(request.id)}/accept`, { method: 'POST', body: '{}' });
      await Actions.refresh();
      UI.setActiveSection('activeRide');
      utils.toast('Ride accepted.');
    },
    async rejectRequest() {
      const request = state.data?.availableRequests?.[0];
      if (!request) return;
      await utils.api(`/api/rides/${encodeURIComponent(request.id)}/reject`, { method: 'POST', body: '{}' });
      await Actions.refresh();
      utils.toast('Ride skipped.');
    },
    async advanceRide() {
      const ride = state.data?.activeRide;
      if (!ride) return;
      const next = ride.status === 'accepted' ? 'arrived' : ride.status === 'arrived' ? 'in-progress' : ride.status === 'in-progress' ? 'completed' : '';
      if (!next) return;
      await utils.api(`/api/rides/${encodeURIComponent(ride.id)}/status`, { method: 'POST', body: JSON.stringify({ status: next }) });
      await Actions.refresh();
      utils.toast(`Ride updated: ${next}.`);
    },
    logout() {
      state.eventSource?.close();
      state.eventSource = null;
      localStorage.removeItem(STORAGE_KEYS.driverAuth);
      localStorage.removeItem(STORAGE_KEYS.driverProfile);
      window.location.reload();
    },
  };

  const Events = {
    attach() {
      utils.qsa(selectors.navLink).forEach((button) => button.addEventListener('click', () => UI.setActiveSection(button.dataset.section)));
      utils.qsa(selectors.bottomNav).forEach((button) => button.addEventListener('click', () => UI.setActiveSection(button.dataset.section)));
      utils.qs('#onlineToggle').addEventListener('change', (event) => Actions.toggleOnline(event.target.checked).catch((error) => utils.toast(error.message)));
      utils.qs('#driverLoginForm').addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.login().catch((error) => utils.toast(error.message));
      });
      utils.qs('#showRegisterForm').addEventListener('click', () => UI.toggleRegisterForm());
      utils.qs('#driverRegisterForm').addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.register().catch((error) => utils.toast(error.message));
      });
      utils.qs('#actionGoOnline').addEventListener('click', () => Actions.toggleOnline(true).catch((error) => utils.toast(error.message)));
      utils.qs('#actionViewRequests').addEventListener('click', () => UI.setActiveSection('requests'));
      utils.qs('#acceptRequest').addEventListener('click', () => Actions.acceptRequest().catch((error) => utils.toast(error.message)));
      utils.qs('#rejectRequest').addEventListener('click', () => Actions.rejectRequest().catch((error) => utils.toast(error.message)));
      utils.qs('#rideAction').addEventListener('click', () => Actions.advanceRide().catch((error) => utils.toast(error.message)));
      utils.qs('#historyFilter').addEventListener('change', UI.render);
      utils.qs('#historySearch').addEventListener('input', UI.render);
      utils.qs('#historySearchClear').addEventListener('click', () => { utils.qs('#historySearch').value = ''; UI.render(); });
      utils.qs('#profileForm').addEventListener('submit', (event) => { event.preventDefault(); Actions.saveProfile().catch((error) => utils.toast(error.message)); });
      utils.qs('#resetProfile').addEventListener('click', () => UI.render());
      utils.qs('#logoutBtn').addEventListener('click', Actions.logout);
      utils.qs('#notifBtn').addEventListener('click', () => UI.setActiveSection('notifications'));
      utils.qs('#driverAvatar').addEventListener('click', () => UI.setActiveSection('profile'));
      document.getElementById('menuToggle')?.addEventListener('click', UI.toggleNav);
      document.addEventListener('click', (event) => {
        if (window.innerWidth <= 900 && !event.target.closest('.driver-sidebar') && !event.target.closest('.driver-topbar') && !event.target.closest('.bottom-nav-item')) {
          UI.setNavState(false);
        }
      });
    },
  };

  return {
    async init() {
      UI.setNavState(false);
      UI.syncMenuToggle();
      UI.setAuthenticated(false);
      UI.toggleRegisterForm(false);
      Events.attach();
      if (state.auth.token) {
        try {
          await Actions.ensureSession();
        } catch {
          localStorage.removeItem(STORAGE_KEYS.driverAuth);
          state.auth = { driverId: '', token: '' };
          UI.setAuthenticated(false);
        }
      }
    },
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  DriverApp.init().catch((error) => window.alert(error.message));
});
