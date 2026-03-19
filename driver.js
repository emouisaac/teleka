const DriverApp = (() => {
  const STORAGE_KEYS = {
    driverId: 'telekaDriverId',
    driverProfile: 'telekaDriverProfile',
  };

  const appEl = document.querySelector('.driver-app');

  const state = {
    driverId: localStorage.getItem(STORAGE_KEYS.driverId) || '',
    driver: loadStoredDriver(),
    activeRide: null,
    availableRequests: [],
    history: [],
    notifications: [],
    settings: null,
    chart: null,
    eventSource: null,
  };

  const selectors = {
    driverName: '#driverName',
    driverStatus: '#driverStatus',
    driverAvatar: '#driverAvatar',
    onlineToggle: '#onlineToggle',
    onlineLabel: '#onlineLabel',
    notifBtn: '#notifBtn',
    notifCount: '#notifCount',
    section: '.driver-section',
    navLink: '.nav-link',
    bottomNav: '.bottom-nav-item',
    statEarnings: '#statEarnings',
    statTrips: '#statTrips',
    statRating: '#statRating',
    statActiveRide: '#statActiveRide',
    statDistance: '#statDistance',
    statFare: '#statFare',
    statNotifications: '#statNotifications',
    statNewNotifs: '#statNewNotifs',
    statUnreadNotifs: '#statUnreadNotifs',
    mapStatus: '#mapStatus',
    actionGoOnline: '#actionGoOnline',
    actionViewRequests: '#actionViewRequests',
    requestEmpty: '#requestEmpty',
    incomingRequest: '#incomingRequest',
    requestPassenger: '#requestPassenger',
    requestRoute: '#requestRoute',
    requestTimer: '#requestTimer',
    requestFare: '#requestFare',
    requestDistance: '#requestDistance',
    acceptRequest: '#acceptRequest',
    rejectRequest: '#rejectRequest',
    activeRidePanel: '#activeRidePanel',
    activeRideEmpty: '#activeRideEmpty',
    activePassenger: '#activePassenger',
    activeRoute: '#activeRoute',
    activeStatus: '#activeStatus',
    activeDistance: '#activeDistance',
    activeFare: '#activeFare',
    activeElapsed: '#activeElapsed',
    navButton: '#navButton',
    rideAction: '#rideAction',
    timelinePickup: '#timelinePickup',
    timelineEnroute: '#timelineEnroute',
    timelineComplete: '#timelineComplete',
    earningsToday: '#earningsToday',
    earningsWeek: '#earningsWeek',
    earningsTrips: '#earningsTrips',
    earningsChart: '#earningsChart',
    breakdownBase: '#breakdownBase',
    breakdownDistance: '#breakdownDistance',
    breakdownCommission: '#breakdownCommission',
    historyFilter: '#historyFilter',
    historySearch: '#historySearch',
    historySearchClear: '#historySearchClear',
    historyList: '#historyList',
    ratingValue: '#ratingValue',
    ratingStars: '#ratingStars',
    ratingCount: '#ratingCount',
    reviewList: '#reviewList',
    profileForm: '#profileForm',
    profileName: '#profileName',
    profilePhone: '#profilePhone',
    profileVehicle: '#profileVehicle',
    profilePlate: '#profilePlate',
    resetProfile: '#resetProfile',
    settingNotifications: '#settingNotifications',
    settingSound: '#settingSound',
    settingAutoAccept: '#settingAutoAccept',
    logoutBtn: '#logoutBtn',
    notificationsList: '#notificationsList',
  };

  function loadStoredDriver() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.driverProfile) || '{}');
    } catch {
      return {};
    }
  }

  function storeDriver(driver) {
    localStorage.setItem(STORAGE_KEYS.driverProfile, JSON.stringify(driver));
  }

  const utils = {
    qs(selector) {
      return document.querySelector(selector);
    },
    qsa(selector) {
      return Array.from(document.querySelectorAll(selector));
    },
    formatCurrency(amount) {
      return new Intl.NumberFormat('en-UG', {
        style: 'currency',
        currency: 'UGX',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(Number(amount) || 0);
    },
    formatTime(dateString) {
      if (!dateString) return '--';
      return new Date(dateString).toLocaleString();
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
      }, 2600);
    },
    async api(url, options = {}) {
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
    },
  };

  const UI = {
    syncMenuToggle() {
      const menuToggle = document.getElementById('menuToggle');
      if (!menuToggle || !appEl) return;
      const isOpen = window.innerWidth <= 900
        ? appEl.classList.contains('nav-open')
        : !appEl.classList.contains('nav-closed');
      menuToggle.setAttribute('aria-expanded', String(isOpen));
    },

    setNavState(isOpen) {
      if (!appEl) return;
      appEl.classList.toggle('nav-open', isOpen);
      UI.syncMenuToggle();
    },

    toggleNav() {
      if (window.innerWidth <= 900) {
        UI.setNavState(!appEl?.classList.contains('nav-open'));
        return;
      }
      appEl?.classList.toggle('nav-closed');
      UI.syncMenuToggle();
    },

    setActiveSection(sectionId) {
      utils.qsa(selectors.section).forEach((section) => {
        section.classList.toggle('active', section.id === sectionId);
      });
      utils.qsa(selectors.navLink).forEach((button) => {
        button.classList.toggle('active', button.dataset.section === sectionId);
      });
      utils.qsa(selectors.bottomNav).forEach((button) => {
        button.classList.toggle('active', button.dataset.section === sectionId);
      });
      if (window.innerWidth <= 900) {
        UI.setNavState(false);
      }
    },

    renderProfile() {
      const driver = state.driver || {};
      utils.qs(selectors.driverName).textContent = driver.name || 'Driver';
      utils.qs(selectors.driverAvatar).src = driver.avatar
        || `https://ui-avatars.com/api/?name=${encodeURIComponent(driver.name || 'Driver')}&background=667eea&color=fff&rounded=true&size=80`;
      utils.qs(selectors.profileName).value = driver.name || '';
      utils.qs(selectors.profilePhone).value = driver.phone || '';
      utils.qs(selectors.profileVehicle).value = driver.vehicle || '';
      utils.qs(selectors.profilePlate).value = driver.plate || '';
    },

    renderStatus() {
      const statusEl = utils.qs(selectors.driverStatus);
      const labelEl = statusEl.querySelector('.status-text');
      const dot = statusEl.querySelector('.status-dot');
      const isOnline = Boolean(state.driver.online);

      labelEl.textContent = isOnline ? 'Online' : 'Offline';
      dot.classList.toggle('online', isOnline);
      dot.classList.toggle('offline', !isOnline);
      utils.qs(selectors.onlineLabel).textContent = isOnline ? 'Go Offline' : 'Go Online';
      utils.qs(selectors.onlineToggle).checked = isOnline;

      const mapStatus = utils.qs(selectors.mapStatus);
      mapStatus.textContent = isOnline ? 'Live' : 'Offline';
      mapStatus.classList.toggle('live', isOnline);
    },

    renderDashboard() {
      const stats = {
        todayEarnings: state.driver.earningsToday || 0,
        totalTrips: state.history.filter((ride) => ride.status === 'completed').length,
        rating: state.driver.rating || 5,
      };
      utils.qs(selectors.statEarnings).textContent = utils.formatCurrency(stats.todayEarnings);
      utils.qs(selectors.statTrips).textContent = String(stats.totalTrips);
      utils.qs(selectors.statRating).textContent = Number(stats.rating).toFixed(1);
      utils.qs(selectors.statNotifications).textContent = String(state.notifications.length);
      utils.qs(selectors.statNewNotifs).textContent = String(state.notifications.length);
      utils.qs(selectors.statUnreadNotifs).textContent = String(state.notifications.length);

      if (state.activeRide) {
        utils.qs(selectors.statActiveRide).textContent = state.activeRide.status;
        utils.qs(selectors.statDistance).textContent = `${Number(state.activeRide.distanceKm || 0).toFixed(1)} km`;
        utils.qs(selectors.statFare).textContent = utils.formatCurrency(state.activeRide.fare);
      } else {
        utils.qs(selectors.statActiveRide).textContent = 'None';
        utils.qs(selectors.statDistance).textContent = '0 km';
        utils.qs(selectors.statFare).textContent = utils.formatCurrency(0);
      }

      const mapEl = utils.qs('#driverMap');
      mapEl.classList.toggle('online', Boolean(state.driver.online));
      mapEl.querySelector('.map-placeholder-text').textContent = state.activeRide
        ? `Assigned route: ${state.activeRide.pickup} to ${state.activeRide.dropoff}`
        : state.driver.online
          ? 'You are visible to dispatch and riders.'
          : 'Go online to receive ride requests.';
    },

    renderRequest() {
      const request = state.availableRequests[0];
      const panel = utils.qs(selectors.incomingRequest);
      const empty = utils.qs(selectors.requestEmpty);

      if (!request || !state.driver.online) {
        panel.classList.add('hidden');
        empty.classList.remove('hidden');
        empty.querySelector('p').textContent = state.driver.online
          ? 'No ride requests right now. Stay online to receive new requests.'
          : 'Go online to receive ride requests.';
        return;
      }

      empty.classList.add('hidden');
      panel.classList.remove('hidden');
      utils.qs(selectors.requestPassenger).textContent = request.customerName || 'Customer';
      utils.qs(selectors.requestRoute).textContent = `${request.pickup} → ${request.dropoff}`;
      utils.qs(selectors.requestFare).textContent = utils.formatCurrency(request.fare);
      utils.qs(selectors.requestDistance).textContent = `${Number(request.distanceKm || 0).toFixed(1)} km`;
      utils.qs(selectors.requestTimer).textContent = 'Live';
    },

    renderActiveRide() {
      const panel = utils.qs(selectors.activeRidePanel);
      const empty = utils.qs(selectors.activeRideEmpty);
      if (!state.activeRide) {
        panel.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
      }

      panel.classList.remove('hidden');
      empty.classList.add('hidden');

      const ride = state.activeRide;
      utils.qs(selectors.activePassenger).textContent = ride.customerName || 'Customer';
      utils.qs(selectors.activeRoute).textContent = `${ride.pickup} → ${ride.dropoff}`;
      utils.qs(selectors.activeStatus).textContent = ride.status;
      utils.qs(selectors.activeDistance).textContent = `${Number(ride.distanceKm || 0).toFixed(1)} km`;
      utils.qs(selectors.activeFare).textContent = utils.formatCurrency(ride.fare);
      utils.qs(selectors.activeElapsed).textContent = utils.formatTime(ride.updatedAt);

      utils.qs(selectors.timelinePickup).textContent = ride.timeline?.arrivedAt ? 'Arrived' : 'Waiting';
      utils.qs(selectors.timelineEnroute).textContent = ride.timeline?.startedAt ? 'Trip started' : 'Not started';
      utils.qs(selectors.timelineComplete).textContent = ride.timeline?.completedAt ? 'Completed' : 'Not started';
      utils.qs(selectors.navButton).href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
        ride.pickup
      )}&destination=${encodeURIComponent(ride.dropoff)}&travelmode=driving`;

      const actionBtn = utils.qs(selectors.rideAction);
      if (ride.status === 'accepted') actionBtn.textContent = 'Arrived';
      else if (ride.status === 'arrived') actionBtn.textContent = 'Start Trip';
      else if (ride.status === 'in-progress') actionBtn.textContent = 'End Trip';
      else actionBtn.textContent = 'Done';
    },

    renderEarnings() {
      const completedRides = state.history.filter((ride) => ride.status === 'completed');
      const weekEarnings = completedRides.reduce((sum, ride) => sum + (ride.fare || 0), 0);
      utils.qs(selectors.earningsToday).textContent = utils.formatCurrency(state.driver.earningsToday || 0);
      utils.qs(selectors.earningsWeek).textContent = utils.formatCurrency(weekEarnings);
      utils.qs(selectors.earningsTrips).textContent = String(completedRides.length);
      utils.qs(selectors.breakdownBase).textContent = utils.formatCurrency((state.driver.earningsToday || 0) * 0.45);
      utils.qs(selectors.breakdownDistance).textContent = utils.formatCurrency((state.driver.earningsToday || 0) * 0.35);
      utils.qs(selectors.breakdownCommission).textContent = utils.formatCurrency((state.driver.earningsToday || 0) * 0.2);
      UI.renderEarningsChart(completedRides);
    },

    renderEarningsChart(completedRides) {
      const canvas = utils.qs(selectors.earningsChart);
      if (!canvas || typeof Chart === 'undefined') return;

      const labels = completedRides.slice(0, 7).reverse().map((ride) =>
        new Date(ride.updatedAt || ride.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      );
      const values = completedRides.slice(0, 7).reverse().map((ride) => ride.fare || 0);

      if (!state.chart) {
        state.chart = new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels: labels.length ? labels : ['No trips'],
            datasets: [
              {
                label: 'Earnings',
                data: values.length ? values : [0],
                borderColor: '#5b6cff',
                backgroundColor: 'rgba(102, 126, 234, 0.2)',
                fill: true,
                tension: 0.35,
                pointRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
          },
        });
        return;
      }

      state.chart.data.labels = labels.length ? labels : ['No trips'];
      state.chart.data.datasets[0].data = values.length ? values : [0];
      state.chart.update();
    },

    renderHistory() {
      const list = utils.qs(selectors.historyList);
      const filter = utils.qs(selectors.historyFilter).value;
      const term = utils.qs(selectors.historySearch).value.trim().toLowerCase();
      const now = new Date();

      const filtered = state.history.filter((ride) => {
        const matchesTerm = !term || `${ride.customerName} ${ride.id}`.toLowerCase().includes(term);
        if (!matchesTerm) return false;
        const rideDate = new Date(ride.updatedAt || ride.createdAt);
        if (filter === 'today') return rideDate.toDateString() === now.toDateString();
        if (filter === 'week') return now - rideDate <= 7 * 24 * 60 * 60 * 1000;
        if (filter === 'month') return now - rideDate <= 30 * 24 * 60 * 60 * 1000;
        return true;
      });

      list.innerHTML = '';
      if (!filtered.length) {
        list.innerHTML = '<div class="history-empty"><p>No rides match this filter.</p></div>';
        return;
      }

      filtered.forEach((ride) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div class="history-header">
            <div>
              <div class="history-title">${ride.customerName || 'Customer'}</div>
              <div class="history-sub">${ride.pickup} → ${ride.dropoff}</div>
            </div>
            <div class="history-meta">
              <span class="history-fare">${utils.formatCurrency(ride.fare)}</span>
              <span class="history-date">${new Date(ride.updatedAt || ride.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="history-footer">
            <span class="tag">${ride.status}</span>
            <span class="muted">${Number(ride.distanceKm || 0).toFixed(1)} km</span>
          </div>
        `;
        list.appendChild(item);
      });
    },

    renderRatings() {
      const rating = Number(state.driver.rating || 5).toFixed(1);
      const rounded = Math.round(Number(rating));
      utils.qs(selectors.ratingValue).textContent = rating;
      utils.qs(selectors.ratingStars).textContent = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
      utils.qs(selectors.ratingCount).textContent = `${state.driver.ratingCount || 0} review${state.driver.ratingCount === 1 ? '' : 's'}`;

      const reviewList = utils.qs(selectors.reviewList);
      reviewList.innerHTML = '';
      if (!state.history.filter((ride) => ride.status === 'completed').length) {
        reviewList.innerHTML = '<div class="review-empty"><p>No reviews yet. Complete rides to build your rating.</p></div>';
        return;
      }

      state.history
        .filter((ride) => ride.status === 'completed')
        .slice(0, 5)
        .forEach((ride) => {
          const card = document.createElement('div');
          card.className = 'review-card';
          card.innerHTML = `
            <div class="review-head">
              <span class="review-name">${ride.customerName || 'Customer'}</span>
              <span class="review-stars">★★★★★</span>
            </div>
            <p class="review-text">Ride ${ride.id} completed successfully.</p>
            <div class="review-meta">${new Date(ride.updatedAt || ride.createdAt).toLocaleDateString()}</div>
          `;
          reviewList.appendChild(card);
        });
    },

    renderNotifications() {
      const list = utils.qs(selectors.notificationsList);
      list.innerHTML = '';
      if (!state.notifications.length) {
        list.innerHTML = '<div class="notification-empty"><p>No notifications yet.</p></div>';
        return;
      }

      state.notifications.forEach((notification) => {
        const row = document.createElement('div');
        row.className = `notification-card ${notification.type || 'info'}`;
        row.innerHTML = `
          <div class="notification-content">
            <p>${notification.message}</p>
            <span class="notification-time">${new Date(notification.createdAt).toLocaleTimeString()}</span>
          </div>
        `;
        list.appendChild(row);
      });

      const badge = utils.qs(selectors.notifCount);
      badge.textContent = String(state.notifications.length);
      badge.style.display = state.notifications.length ? 'inline-flex' : 'none';
    },

    renderAll() {
      UI.renderProfile();
      UI.renderStatus();
      UI.renderDashboard();
      UI.renderRequest();
      UI.renderActiveRide();
      UI.renderEarnings();
      UI.renderHistory();
      UI.renderRatings();
      UI.renderNotifications();
    },
  };

  const Actions = {
    async ensureDriverSession() {
      const driverProfile = {
        driverId: state.driverId || undefined,
        name: state.driver.name || 'Teleka Driver',
        phone: state.driver.phone || '+256 700 000 000',
        vehicle: state.driver.vehicle || 'Toyota Corolla',
        plate: state.driver.plate || 'UBA 001A',
        avatar: state.driver.avatar || '',
      };
      const driver = await utils.api('/api/drivers/session', {
        method: 'POST',
        body: JSON.stringify(driverProfile),
      });
      state.driverId = driver.id;
      state.driver = driver;
      localStorage.setItem(STORAGE_KEYS.driverId, driver.id);
      storeDriver(driver);
      await Actions.refreshState();
      Actions.ensureEventStream();
    },

    async refreshState() {
      if (!state.driverId) return;
      const data = await utils.api(`/api/driver/state?driverId=${encodeURIComponent(state.driverId)}`);
      state.driver = data.driver;
      state.activeRide = data.activeRide;
      state.availableRequests = data.availableRequests || [];
      state.history = data.history || [];
      state.notifications = data.notifications || [];
      state.settings = data.settings;
      storeDriver(state.driver);
      UI.renderAll();
    },

    ensureEventStream() {
      if (state.eventSource) return;
      const stream = new EventSource('/api/events');
      stream.addEventListener('state-update', () => {
        Actions.refreshState().catch(console.warn);
      });
      stream.onerror = () => {
        stream.close();
        state.eventSource = null;
        setTimeout(() => Actions.ensureEventStream(), 3000);
      };
      state.eventSource = stream;
    },

    async toggleOnline(online) {
      if (!state.driverId) return;
      const driver = await utils.api(`/api/drivers/${encodeURIComponent(state.driverId)}/availability`, {
        method: 'POST',
        body: JSON.stringify({ online }),
      });
      state.driver = driver;
      await Actions.refreshState();
      utils.toast(`You are now ${online ? 'online' : 'offline'}.`);
    },

    async saveProfile() {
      if (!state.driverId) return;
      const payload = {
        name: utils.qs(selectors.profileName).value.trim(),
        phone: utils.qs(selectors.profilePhone).value.trim(),
        vehicle: utils.qs(selectors.profileVehicle).value.trim(),
        plate: utils.qs(selectors.profilePlate).value.trim(),
      };
      state.driver = await utils.api(`/api/drivers/${encodeURIComponent(state.driverId)}/profile`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await Actions.refreshState();
      utils.toast('Profile updated.');
    },

    async acceptRequest() {
      const request = state.availableRequests[0];
      if (!request) return;
      await utils.api(`/api/rides/${encodeURIComponent(request.id)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ driverId: state.driverId }),
      });
      await Actions.refreshState();
      UI.setActiveSection('activeRide');
      utils.toast('Ride accepted.');
    },

    async rejectRequest() {
      const request = state.availableRequests[0];
      if (!request) return;
      await utils.api(`/api/rides/${encodeURIComponent(request.id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ driverId: state.driverId }),
      });
      await Actions.refreshState();
      utils.toast('Ride skipped.');
    },

    async advanceRide() {
      if (!state.activeRide) return;
      let nextStatus = '';
      if (state.activeRide.status === 'accepted') nextStatus = 'arrived';
      else if (state.activeRide.status === 'arrived') nextStatus = 'in-progress';
      else if (state.activeRide.status === 'in-progress') nextStatus = 'completed';
      else return;

      await utils.api(`/api/rides/${encodeURIComponent(state.activeRide.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      await Actions.refreshState();
      utils.toast(`Ride updated: ${nextStatus}.`);
    },

    logout() {
      if (state.eventSource) {
        state.eventSource.close();
      }
      localStorage.removeItem(STORAGE_KEYS.driverId);
      localStorage.removeItem(STORAGE_KEYS.driverProfile);
      window.location.reload();
    },
  };

  const Events = {
    attach() {
      utils.qsa(selectors.navLink).forEach((button) => {
        button.addEventListener('click', () => UI.setActiveSection(button.dataset.section));
      });
      utils.qsa(selectors.bottomNav).forEach((button) => {
        button.addEventListener('click', () => UI.setActiveSection(button.dataset.section));
      });

      utils.qs(selectors.onlineToggle).addEventListener('change', (event) => {
        Actions.toggleOnline(event.target.checked).catch((error) => utils.toast(error.message));
      });
      utils.qs(selectors.actionGoOnline).addEventListener('click', () => {
        Actions.toggleOnline(true).catch((error) => utils.toast(error.message));
      });
      utils.qs(selectors.actionViewRequests).addEventListener('click', () => UI.setActiveSection('requests'));
      utils.qs(selectors.acceptRequest).addEventListener('click', () => {
        Actions.acceptRequest().catch((error) => utils.toast(error.message));
      });
      utils.qs(selectors.rejectRequest).addEventListener('click', () => {
        Actions.rejectRequest().catch((error) => utils.toast(error.message));
      });
      utils.qs(selectors.rideAction).addEventListener('click', () => {
        Actions.advanceRide().catch((error) => utils.toast(error.message));
      });
      utils.qs(selectors.historyFilter).addEventListener('change', () => UI.renderHistory());
      utils.qs(selectors.historySearch).addEventListener('input', () => UI.renderHistory());
      utils.qs(selectors.historySearchClear).addEventListener('click', () => {
        utils.qs(selectors.historySearch).value = '';
        UI.renderHistory();
      });
      utils.qs(selectors.profileForm).addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.saveProfile().catch((error) => utils.toast(error.message));
      });
      utils.qs(selectors.resetProfile).addEventListener('click', () => {
        UI.renderProfile();
      });
      utils.qs(selectors.settingNotifications).addEventListener('change', () => {});
      utils.qs(selectors.settingSound).addEventListener('change', () => {});
      utils.qs(selectors.settingAutoAccept).addEventListener('change', () => {});
      utils.qs(selectors.logoutBtn).addEventListener('click', Actions.logout);
      utils.qs(selectors.notifBtn).addEventListener('click', () => UI.setActiveSection('notifications'));

      const menuToggle = document.getElementById('menuToggle');
      if (menuToggle) {
        menuToggle.addEventListener('click', () => UI.toggleNav());
      }

      document.addEventListener('click', (event) => {
        if (
          window.innerWidth <= 900 &&
          !event.target.closest('.driver-sidebar') &&
          !event.target.closest('.driver-topbar') &&
          !event.target.closest('.bottom-nav-item')
        ) {
          UI.setNavState(false);
        }
      });

      utils.qs(selectors.driverAvatar).addEventListener('click', () => {
        UI.setActiveSection('profile');
      });
    },
  };

  const App = {
    async init() {
      UI.setNavState(false);
      UI.syncMenuToggle();
      UI.setActiveSection('dashboard');
      Events.attach();
      await Actions.ensureDriverSession();
    },
  };

  return App;
})();

document.addEventListener('DOMContentLoaded', () => {
  DriverApp.init().catch((error) => {
    window.alert(error.message);
  });
});
