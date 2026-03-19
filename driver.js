/* Driver Dashboard Logic (Teleka Taxi)
   - Mobile-first, lightweight, responsive, and ready for Socket.io integration.
   - Uses localStorage for persistence of preferences, profile, and ride history.
*/

const DriverApp = (() => {
  const STORAGE_KEY = 'telekaDriverState';
  const REQUEST_TIMEOUT = 15; // seconds to accept

  const appEl = document.querySelector('.driver-app');

  const state = {
    driver: {
      name: 'Alex Rider',
      phone: '+256 700 000 000',
      vehicle: 'Toyota Prius',
      plate: 'TKA 123A',
      avatar: 'https://ui-avatars.com/api/?name=Alex+Rider&background=667eea&color=fff&rounded=true&size=80',
    },
    online: false,
    settings: {
      notifications: true,
      sound: true,
      autoAccept: false,
    },
    stats: {
      todayEarnings: 0,
      weekEarnings: 0,
      trips: 0,
      rating: 4.9,
      ratingCount: 0,
    },
    activeRide: null,
    pendingRequest: null,
    rideHistory: [],
    reviews: [],
    notifications: [],
    requestTimer: null,
    requestCountdown: REQUEST_TIMEOUT,
    simulationInterval: null,
    chart: null,
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

    // Dashboard
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

    // Actions
    actionGoOnline: '#actionGoOnline',
    actionViewRequests: '#actionViewRequests',

    // Request
    requestPanel: '#requestPanel',
    requestEmpty: '#requestEmpty',
    incomingRequest: '#incomingRequest',
    requestPassenger: '#requestPassenger',
    requestRoute: '#requestRoute',
    requestTimer: '#requestTimer',
    requestFare: '#requestFare',
    requestDistance: '#requestDistance',
    acceptRequest: '#acceptRequest',
    rejectRequest: '#rejectRequest',

    // Active Ride
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

    // Earnings
    earningsToday: '#earningsToday',
    earningsWeek: '#earningsWeek',
    earningsTrips: '#earningsTrips',
    earningsChart: '#earningsChart',
    breakdownBase: '#breakdownBase',
    breakdownDistance: '#breakdownDistance',
    breakdownCommission: '#breakdownCommission',
    chartRangeBtns: '.chart-controls .btn',

    // History
    historyFilter: '#historyFilter',
    historySearch: '#historySearch',
    historySearchClear: '#historySearchClear',
    historyList: '#historyList',

    // Ratings
    ratingValue: '#ratingValue',
    ratingStars: '#ratingStars',
    ratingCount: '#ratingCount',
    reviewList: '#reviewList',

    // Profile
    profileForm: '#profileForm',
    profileName: '#profileName',
    profilePhone: '#profilePhone',
    profileVehicle: '#profileVehicle',
    profilePlate: '#profilePlate',
    profilePhoto: '#profilePhoto',
    profileDocs: '#profileDocs',
    resetProfile: '#resetProfile',

    // Settings
    settingNotifications: '#settingNotifications',
    settingSound: '#settingSound',
    settingAutoAccept: '#settingAutoAccept',
    logoutBtn: '#logoutBtn',

    // Notifications
    notificationsList: '#notificationsList',
  };

  const utils = {
    qs(selector) {
      return document.querySelector(selector);
    },
    qsa(selector) {
      return Array.from(document.querySelectorAll(selector));
    },
    formatCurrency(amount) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    },
    formatTime(seconds) {
      const m = Math.floor(seconds / 60).toString().padStart(2, '0');
      const s = Math.floor(seconds % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    },
    clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    },
    randomFrom(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },
    uuid() {
      return `d-${Math.random().toString(16).slice(2)}-${Date.now()}`;
    },
    beep() {
      if (!state.settings.sound || !window.AudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.08;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => {
          osc.stop();
          ctx.close();
        }, 150);
      } catch (err) {
        // silently fail on unsupported devices
      }
    },
  };

  const Storage = {
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    save() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        driver: state.driver,
        online: state.online,
        settings: state.settings,
        stats: state.stats,
        rideHistory: state.rideHistory,
        reviews: state.reviews,
        notifications: state.notifications,
      }));
    },
    reset() {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
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

    setActiveSection(sectionId) {
      utils.qsa(selectors.section).forEach((section) => {
        section.classList.toggle('active', section.id === sectionId);
      });
      utils.qsa(selectors.navLink).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.section === sectionId);
      });
      utils.qsa(selectors.bottomNav).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.section === sectionId);
      });

      // Keep sidebar small on mobile when changing sections.
      if (window.innerWidth <= 900 && appEl) {
        UI.setNavState(false);
      }
    },

    updateOnlineStatus() {
      const statusEl = utils.qs(selectors.driverStatus);
      const labelEl = statusEl.querySelector('.status-text');
      const dot = statusEl.querySelector('.status-dot');
      const mapStatus = utils.qs(selectors.mapStatus);
      if (state.online) {
        labelEl.textContent = 'Online';
        dot.classList.remove('offline');
        dot.classList.add('online');
        mapStatus.textContent = 'Live';
        mapStatus.classList.add('live');
      } else {
        labelEl.textContent = 'Offline';
        dot.classList.remove('online');
        dot.classList.add('offline');
        mapStatus.textContent = 'Offline';
        mapStatus.classList.remove('live');
      }
      utils.qs(selectors.onlineLabel).textContent = state.online ? 'Go Offline' : 'Go Online';
      utils.qs(selectors.onlineToggle).checked = state.online;
      UI.renderDashboard();
    },

    setNavState(isOpen) {
      if (!appEl) return;
      appEl.classList.toggle('nav-open', isOpen);
      UI.syncMenuToggle();
    },

    toggleNav() {
      if (!appEl) return;
      UI.setNavState(!appEl.classList.contains('nav-open'));
    },

    showNotification(message, type = 'info') {
      const id = utils.uuid();
      state.notifications.unshift({ id, message, type, time: new Date().toISOString(), read: false });
      UI.renderNotifications();
      UI.updateNotificationBadge();
      if (state.settings.notifications) {
        UI.toast(message);
      }
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

    renderDashboard() {
      const eps = state.stats;
      utils.qs(selectors.statEarnings).textContent = utils.formatCurrency(eps.todayEarnings);
      utils.qs(selectors.statTrips).textContent = eps.trips;
      utils.qs(selectors.statRating).textContent = eps.rating.toFixed(1);

      if (state.activeRide) {
        utils.qs(selectors.statActiveRide).textContent = 'In progress';
        utils.qs(selectors.statDistance).textContent = `${state.activeRide.distance.toFixed(1)} km`;
        utils.qs(selectors.statFare).textContent = utils.formatCurrency(state.activeRide.fare);
      } else {
        utils.qs(selectors.statActiveRide).textContent = 'None';
        utils.qs(selectors.statDistance).textContent = '0 km';
        utils.qs(selectors.statFare).textContent = utils.formatCurrency(0);
      }

      utils.qs(selectors.statNotifications).textContent = state.notifications.length;
      utils.qs(selectors.statNewNotifs).textContent = state.notifications.filter((n) => !n.read).length;
      utils.qs(selectors.statUnreadNotifs).textContent = state.notifications.filter((n) => !n.read).length;

      // Map placeholder
      const mapEl = utils.qs('#driverMap');
      mapEl.classList.toggle('online', state.online);
      mapEl.querySelector('.map-placeholder-text').textContent = state.online
        ? 'Your location is being shared.'
        : 'Go online to share your location.';
    },

    renderRequest() {
      const panel = utils.qs(selectors.incomingRequest);
      const empty = utils.qs(selectors.requestEmpty);
      if (!state.pendingRequest) {
        panel.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');
      panel.classList.remove('hidden');

      utils.qs(selectors.requestPassenger).textContent = state.pendingRequest.passenger;
      utils.qs(selectors.requestRoute).textContent = `${state.pendingRequest.pickup} → ${state.pendingRequest.dropoff}`;
      utils.qs(selectors.requestFare).textContent = utils.formatCurrency(state.pendingRequest.fare);
      utils.qs(selectors.requestDistance).textContent = `${state.pendingRequest.distance.toFixed(1)} km`;
      utils.qs(selectors.requestTimer).textContent = state.requestCountdown;
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
      utils.qs(selectors.activePassenger).textContent = ride.passenger;
      utils.qs(selectors.activeRoute).textContent = `${ride.pickup} → ${ride.dropoff}`;
      utils.qs(selectors.activeStatus).textContent = ride.statusLabel;
      utils.qs(selectors.activeDistance).textContent = `${ride.distance.toFixed(1)} km`;
      utils.qs(selectors.activeFare).textContent = utils.formatCurrency(ride.fare);
      utils.qs(selectors.activeElapsed).textContent = utils.formatTime(ride.elapsed);

      utils.qs(selectors.timelinePickup).textContent = ride.timeline.pickup;
      utils.qs(selectors.timelineEnroute).textContent = ride.timeline.enroute;
      utils.qs(selectors.timelineComplete).textContent = ride.timeline.complete;

      const navUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
        ride.pickup
      )}&destination=${encodeURIComponent(ride.dropoff)}&travelmode=driving`;
      utils.qs(selectors.navButton).href = navUrl;

      const actionBtn = utils.qs(selectors.rideAction);
      if (ride.status === 'waiting') {
        actionBtn.textContent = 'Arrived';
      } else if (ride.status === 'arrived') {
        actionBtn.textContent = 'Start Trip';
      } else if (ride.status === 'enroute') {
        actionBtn.textContent = 'End Trip';
      } else {
        actionBtn.textContent = 'Done';
      }
    },

    renderEarnings() {
      utils.qs(selectors.earningsToday).textContent = utils.formatCurrency(state.stats.todayEarnings);
      utils.qs(selectors.earningsWeek).textContent = utils.formatCurrency(state.stats.weekEarnings);
      utils.qs(selectors.earningsTrips).textContent = state.stats.trips;

      utils.qs(selectors.breakdownBase).textContent = utils.formatCurrency(state.stats.breakdown?.base ?? 0);
      utils.qs(selectors.breakdownDistance).textContent = utils.formatCurrency(state.stats.breakdown?.distance ?? 0);
      utils.qs(selectors.breakdownCommission).textContent = utils.formatCurrency(state.stats.breakdown?.commission ?? 0);
    },

    renderHistory() {
      const list = utils.qs(selectors.historyList);
      list.innerHTML = '';
      const filter = utils.qs(selectors.historyFilter).value;
      const term = utils.qs(selectors.historySearch).value.trim().toLowerCase();

      const now = new Date();
      const filtered = state.rideHistory.filter((ride) => {
        if (term && !(`${ride.passenger} ${ride.id}`.toLowerCase().includes(term))) return false;
        if (filter === 'today') {
          return new Date(ride.completedAt).toDateString() === now.toDateString();
        }
        if (filter === 'week') {
          const diff = now - new Date(ride.completedAt);
          return diff <= 7 * 24 * 60 * 60 * 1000;
        }
        if (filter === 'month') {
          const diff = now - new Date(ride.completedAt);
          return diff <= 30 * 24 * 60 * 60 * 1000;
        }
        return true;
      });

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
              <div class="history-title">${ride.passenger}</div>
              <div class="history-sub">${ride.pickup} → ${ride.dropoff}</div>
            </div>
            <div class="history-meta">
              <span class="history-fare">${utils.formatCurrency(ride.fare)}</span>
              <span class="history-date">${new Date(ride.completedAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="history-footer">
            <span class="tag">${ride.status}</span>
            <span class="muted">${ride.distance.toFixed(1)} km</span>
          </div>
        `;
        list.appendChild(item);
      });
    },

    renderRatings() {
      const avg = state.reviews.length
        ? state.reviews.reduce((sum, r) => sum + r.rating, 0) / state.reviews.length
        : 0;
      const rounded = Math.max(0, Math.min(5, avg));
      utils.qs(selectors.ratingValue).textContent = rounded.toFixed(1);
      utils.qs(selectors.ratingStars).textContent = '★'.repeat(Math.round(rounded)) + '☆'.repeat(5 - Math.round(rounded));
      utils.qs(selectors.ratingCount).textContent = `${state.reviews.length} review${state.reviews.length === 1 ? '' : 's'}`;

      const list = utils.qs(selectors.reviewList);
      list.innerHTML = '';
      if (!state.reviews.length) {
        list.innerHTML = '<div class="review-empty"><p>No reviews yet.</p></div>';
        return;
      }

      state.reviews.slice(0, 10).forEach((review) => {
        const card = document.createElement('div');
        card.className = 'review-card';
        card.innerHTML = `
          <div class="review-head">
            <span class="review-name">${review.name}</span>
            <span class="review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span>
          </div>
          <p class="review-text">${review.comment}</p>
          <div class="review-meta">${new Date(review.date).toLocaleDateString()}</div>
        `;
        list.appendChild(card);
      });
    },

    renderProfile() {
      utils.qs(selectors.driverName).textContent = state.driver.name;
      utils.qs(selectors.driverAvatar).src = state.driver.avatar;
      utils.qs(selectors.profileName).value = state.driver.name;
      utils.qs(selectors.profilePhone).value = state.driver.phone;
      utils.qs(selectors.profileVehicle).value = state.driver.vehicle;
      utils.qs(selectors.profilePlate).value = state.driver.plate;
    },

    renderSettings() {
      utils.qs(selectors.settingNotifications).checked = state.settings.notifications;
      utils.qs(selectors.settingSound).checked = state.settings.sound;
      utils.qs(selectors.settingAutoAccept).checked = state.settings.autoAccept;
    },

    renderNotifications() {
      const list = utils.qs(selectors.notificationsList);
      list.innerHTML = '';
      if (!state.notifications.length) {
        list.innerHTML = '<div class="notification-empty"><p>No notifications yet.</p></div>';
        return;
      }

      state.notifications.forEach((notif) => {
        const row = document.createElement('div');
        row.className = `notification-card ${notif.type}`;
        row.innerHTML = `
          <div class="notification-content">
            <p>${notif.message}</p>
            <span class="notification-time">${new Date(notif.time).toLocaleTimeString()}</span>
          </div>
        `;
        row.addEventListener('click', () => {
          notif.read = true;
          UI.updateNotificationBadge();
          row.classList.add('read');
        });
        list.appendChild(row);
      });
    },

    updateNotificationBadge() {
      const unread = state.notifications.filter((n) => !n.read).length;
      const badge = utils.qs(selectors.notifCount);
      badge.textContent = unread;
      badge.style.display = unread ? 'inline-flex' : 'none';
    },

    updateEarningsChart(range = 'week') {
      const labels = [];
      const values = [];
      const now = new Date();
      const points = range === 'month' ? 30 : 7;

      for (let i = points - 1; i >= 0; i -= 1) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const amount = Math.round(Math.random() * 120 + 40);
        values.push(amount);
      }

      state.stats.todayEarnings = values[values.length - 1];
      state.stats.weekEarnings = values.reduce((sum, v) => sum + v, 0);
      state.stats.trips = values.reduce((sum) => sum + Math.floor(Math.random() * 4 + 1), 0);

      UI.renderEarnings();

      if (!state.chart) {
        const ctx = utils.qs(selectors.earningsChart).getContext('2d');
        state.chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Earnings',
                data: values,
                borderColor: '#5b6cff',
                backgroundColor: 'rgba(102, 126, 234, 0.25)',
                tension: 0.35,
                fill: true,
                pointRadius: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: { grid: { display: false } },
              y: {
                ticks: { callback: (value) => `$${value}` },
                grid: { color: 'rgba(0,0,0,0.05)' },
              },
            },
          },
        });
      } else {
        state.chart.data.labels = labels;
        state.chart.data.datasets[0].data = values;
        state.chart.update();
      }

      state.stats.breakdown = {
        base: Math.round(state.stats.todayEarnings * 0.45),
        distance: Math.round(state.stats.todayEarnings * 0.35),
        commission: Math.round(state.stats.todayEarnings * 0.2),
      };
      UI.renderEarnings();
    },
  };

  const Simulation = {
    start() {
      if (state.simulationInterval) return;
      state.simulationInterval = setInterval(() => {
        if (!state.online) return;
        if (state.pendingRequest || state.activeRide) return;
        Simulation.createRideRequest();
      }, 22000);
    },
    stop() {
      clearInterval(state.simulationInterval);
      state.simulationInterval = null;
    },
    createRideRequest() {
      const passengers = ['Moses', 'Amina', 'Joy', 'Brian', 'Nadia', 'David'];
      const places = ['Downtown', 'Airport', 'Central Station', 'University', 'Mall', 'Harbor'];
      const pickup = utils.randomFrom(places);
      const dropoff = utils.randomFrom(places.filter((p) => p !== pickup));
      const distance = Math.random() * 18 + 2;
      const fare = Math.max(8, distance * 1.25);

      state.pendingRequest = {
        id: utils.uuid(),
        passenger: utils.randomFrom(passengers),
        pickup,
        dropoff,
        distance,
        fare,
        createdAt: Date.now(),
      };
      state.requestCountdown = REQUEST_TIMEOUT;
      UI.renderRequest();
      UI.showNotification(`New ride request from ${state.pendingRequest.passenger}`);
      utils.beep();

      if (state.settings.autoAccept) {
        setTimeout(() => {
          if (state.pendingRequest) {
            Actions.acceptRequest();
          }
        }, 1100);
      }

      Simulation.startRequestCountdown();
    },
    startRequestCountdown() {
      clearInterval(state.requestTimer);
      state.requestTimer = setInterval(() => {
        state.requestCountdown -= 1;
        if (state.requestCountdown <= 0) {
          clearInterval(state.requestTimer);
          Actions.rejectRequest('timed out');
          return;
        }
        const timerEl = utils.qs(selectors.requestTimer);
        if (timerEl) timerEl.textContent = state.requestCountdown;
      }, 1000);
    },
    stopRequestCountdown() {
      clearInterval(state.requestTimer);
      state.requestTimer = null;
    },
  };

  const Actions = {
    toggleOnline(value) {
      state.online = typeof value === 'boolean' ? value : !state.online;
      UI.updateOnlineStatus();
      Storage.save();
      if (state.online) {
        Simulation.start();
        UI.showNotification('You are now online. Waiting for requests...');
      } else {
        Simulation.stop();
        if (state.pendingRequest) {
          Actions.rejectRequest('offline');
        }
        UI.showNotification('You are offline. Ride requests are paused.');
      }
    },

    acceptRequest() {
      if (!state.pendingRequest) return;
      Simulation.stopRequestCountdown();
      state.activeRide = {
        ...state.pendingRequest,
        status: 'waiting',
        statusLabel: 'Waiting for pickup',
        elapsed: 0,
        timeline: { pickup: 'Waiting', enroute: 'Not started', complete: 'Not started' },
      };
      state.pendingRequest = null;
      UI.renderRequest();
      UI.renderActiveRide();
      UI.setActiveSection('activeRide');
      UI.showNotification('Ride accepted. Proceed to pickup.');
      Storage.save();
    },

    rejectRequest(reason = 'rejected') {
      if (!state.pendingRequest) return;
      Simulation.stopRequestCountdown();
      UI.showNotification(`Ride request ${reason}.`);
      state.pendingRequest = null;
      UI.renderRequest();
      Storage.save();
    },

    advanceRide() {
      if (!state.activeRide) return;
      const ride = state.activeRide;

      if (ride.status === 'waiting') {
        ride.status = 'arrived';
        ride.statusLabel = 'Arrived at pickup';
        ride.timeline.pickup = 'Arrived';
        UI.showNotification('You have arrived at the pickup location.');
      } else if (ride.status === 'arrived') {
        ride.status = 'enroute';
        ride.statusLabel = 'On the way';
        ride.timeline.enroute = 'In progress';
        UI.showNotification('Trip started. Drive safely.');
        RideTimer.start();
      } else if (ride.status === 'enroute') {
        ride.status = 'completed';
        ride.statusLabel = 'Trip complete';
        ride.timeline.complete = 'Completed';
        RideTimer.stop();
        Actions.completeRide();
      }
      UI.renderActiveRide();
    },

    completeRide() {
      const ride = state.activeRide;
      if (!ride) return;
      state.stats.todayEarnings += ride.fare;
      state.stats.weekEarnings += ride.fare;
      state.stats.trips += 1;

      state.rideHistory.unshift({
        ...ride,
        completedAt: new Date().toISOString(),
        status: 'Completed',
      });

      const reviewRating = Math.max(3, 5 - Math.floor(Math.random() * 2));
      state.reviews.unshift({
        id: utils.uuid(),
        name: ride.passenger,
        rating: reviewRating,
        comment: 'Smooth ride, thank you!',
        date: new Date().toISOString(),
      });

      UI.showNotification('Ride completed. Great job!');
      state.activeRide = null;

      UI.renderDashboard();
      UI.renderHistory();
      UI.renderRatings();
      UI.updateEarningsChart();
      UI.renderActiveRide();
      Storage.save();
    },

    updateProfile() {
      state.driver.name = utils.qs(selectors.profileName).value.trim() || state.driver.name;
      state.driver.phone = utils.qs(selectors.profilePhone).value.trim() || state.driver.phone;
      state.driver.vehicle = utils.qs(selectors.profileVehicle).value.trim() || state.driver.vehicle;
      state.driver.plate = utils.qs(selectors.profilePlate).value.trim() || state.driver.plate;

      UI.renderProfile();
      Storage.save();
      UI.showNotification('Profile updated.');
    },

    applySettings() {
      state.settings.notifications = utils.qs(selectors.settingNotifications).checked;
      state.settings.sound = utils.qs(selectors.settingSound).checked;
      state.settings.autoAccept = utils.qs(selectors.settingAutoAccept).checked;
      Storage.save();
      UI.showNotification('Settings saved.');
    },
  };

  const RideTimer = {
    interval: null,
    start() {
      if (this.interval) return;
      this.interval = setInterval(() => {
        if (!state.activeRide) return;
        state.activeRide.elapsed += 1;
        state.activeRide.distance += 0.03; // ~30m per second
        state.activeRide.fare = Math.max(3, state.activeRide.distance * 1.3);
        UI.renderActiveRide();
      }, 1000);
    },
    stop() {
      clearInterval(this.interval);
      this.interval = null;
    },
  };

  const Events = {
    attach() {
      // navigation
      utils.qsa(selectors.navLink).forEach((btn) => {
        btn.addEventListener('click', () => {
          UI.setActiveSection(btn.dataset.section);
        });
      });
      utils.qsa(selectors.bottomNav).forEach((btn) => {
        btn.addEventListener('click', () => {
          UI.setActiveSection(btn.dataset.section);
        });
      });

      // Top controls
      utils.qs(selectors.onlineToggle).addEventListener('change', (evt) => {
        Actions.toggleOnline(evt.target.checked);
      });

      utils.qs(selectors.actionGoOnline).addEventListener('click', () => {
        Actions.toggleOnline(true);
      });
      utils.qs(selectors.actionViewRequests).addEventListener('click', () => {
        UI.setActiveSection('requests');
      });

      utils.qs(selectors.acceptRequest).addEventListener('click', () => {
        Actions.acceptRequest();
      });
      utils.qs(selectors.rejectRequest).addEventListener('click', () => {
        Actions.rejectRequest('rejected');
      });

      utils.qs(selectors.rideAction).addEventListener('click', () => {
        Actions.advanceRide();
      });

      utils.qs(selectors.historyFilter).addEventListener('change', () => UI.renderHistory());
      utils.qs(selectors.historySearch).addEventListener('input', () => UI.renderHistory());
      utils.qs(selectors.historySearchClear).addEventListener('click', () => {
        utils.qs(selectors.historySearch).value = '';
        UI.renderHistory();
      });

      utils.qs(selectors.profileForm).addEventListener('submit', (evt) => {
        evt.preventDefault();
        Actions.updateProfile();
      });
      utils.qs(selectors.resetProfile).addEventListener('click', () => {
        Storage.reset();
      });

      utils.qs(selectors.settingNotifications).addEventListener('change', () => Actions.applySettings());
      utils.qs(selectors.settingSound).addEventListener('change', () => Actions.applySettings());
      utils.qs(selectors.settingAutoAccept).addEventListener('change', () => Actions.applySettings());

      utils.qs(selectors.logoutBtn).addEventListener('click', () => {
        Storage.reset();
      });

      utils.qs(selectors.notifBtn).addEventListener('click', () => {
        UI.setActiveSection('notifications');
      });

      const menuToggle = document.getElementById('menuToggle');
      if (menuToggle) {
        menuToggle.addEventListener('click', () => {
          if (window.innerWidth <= 900) {
            UI.toggleNav();
            return;
          }
          appEl?.classList.toggle('nav-closed');
          UI.syncMenuToggle();
        });
      }

      // Chart range controls
      utils.qsa(selectors.chartRangeBtns).forEach((btn) => {
        btn.addEventListener('click', () => {
          utils.qsa(selectors.chartRangeBtns).forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          UI.updateEarningsChart(btn.dataset.range);
        });
      });

      // Ensure small screens can close nav by tapping outside
      document.addEventListener('click', (evt) => {
        if (
          window.innerWidth <= 900 &&
          !evt.target.closest('.driver-sidebar') &&
          !evt.target.closest('.driver-topbar') &&
          !evt.target.closest('.bottom-nav-item')
        ) {
          UI.setNavState(false);
        }
      });

      // Allow tapping the avatar to scroll to profile
      utils.qs(selectors.driverAvatar).addEventListener('click', () => {
        UI.setActiveSection('profile');
      });
    },
  };

  const App = {
    init() {
      const saved = Storage.load();
      if (saved) {
        Object.assign(state, saved);
      }
      UI.setNavState(false);
      UI.syncMenuToggle();
      UI.setActiveSection('dashboard');
      UI.renderProfile();
      UI.renderSettings();
      UI.renderDashboard();
      UI.renderRequest();
      UI.renderActiveRide();
      UI.renderHistory();
      UI.renderRatings();
      UI.renderNotifications();
      UI.updateNotificationBadge();
      UI.updateEarningsChart();
      Simulation.start();
      Events.attach();
    },
  };

  return App;
})();

document.addEventListener('DOMContentLoaded', () => DriverApp.init());
