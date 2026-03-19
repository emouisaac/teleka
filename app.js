const TelekaAdmin = (() => {
  const STORAGE_KEY = 'telekaAdminAuth';
  const state = {
    auth: loadJson(STORAGE_KEY, { email: '', token: '' }),
    data: null,
    eventSource: null,
  };

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  const DOM = {
    qs(selector, root = document) { return root.querySelector(selector); },
    qsa(selector, root = document) { return Array.from(root.querySelectorAll(selector)); },
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
    toggleSidebar(forceClose = false) {
      const sidebar = DOM.qs('.sidebar');
      if (!sidebar) return;
      if (window.innerWidth <= 1024) {
        sidebar.classList.toggle('open', forceClose ? false : !sidebar.classList.contains('open'));
        return;
      }
      sidebar.classList.toggle('collapsed', forceClose || !sidebar.classList.contains('collapsed'));
    },
    setActiveSection(sectionId) {
      DOM.qsa('.section').forEach((section) => section.classList.toggle('active', section.id === sectionId));
      DOM.qsa('.sidebar-item').forEach((item) => item.classList.toggle('active', item.dataset.section === sectionId));
      const pageTitle = DOM.qs('.page-title');
      if (pageTitle) pageTitle.textContent = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
      if (window.innerWidth <= 1024) UI.toggleSidebar(true);
    },
    setAuthenticated(authenticated) {
      DOM.qs('#adminAuthPanel').classList.toggle('active', !authenticated);
      DOM.qsa('#mainContent > .section:not(#adminAuthPanel)').forEach((section) => section.classList.toggle('active', authenticated && section.id === 'overview'));
      DOM.qs('.sidebar').style.display = authenticated ? '' : 'none';
      DOM.qs('#notifToggle').style.display = authenticated ? '' : 'none';
      DOM.qs('.page-title').textContent = authenticated ? 'Overview' : 'Admin Login';
      DOM.qs('.page-subtitle').textContent = authenticated
        ? 'Operational control for customers, drivers, rides, revenue, and dispatch settings.'
        : 'Authenticated admin access is required.';
    },
    render() {
      const data = state.data;
      if (!data) return;
      DOM.qs('#summaryCustomers').textContent = String(data.summary.totalCustomers);
      DOM.qs('#summaryDriversOnline').textContent = String(data.summary.onlineDrivers);
      DOM.qs('#summaryPendingRides').textContent = String(data.summary.pendingRides);
      DOM.qs('#summaryActiveRides').textContent = String(data.summary.activeRides);
      DOM.qs('#summaryCompletedRides').textContent = String(data.summary.completedRides);
      DOM.qs('#summaryRevenue').textContent = DOM.money(data.summary.revenue);
      DOM.qs('#notifCount').textContent = String((data.notifications || []).length);

      renderTable('#overviewRidesBody', data.rides.slice(0, 8), (ride) => `
        <td>${ride.id}</td>
        <td>${ride.customerName}</td>
        <td>${ride.driverName}</td>
        <td>${ride.pickup} → ${ride.dropoff}</td>
        <td>${ride.status}</td>
        <td>${DOM.money(ride.fare)}</td>
      `, 6, 'No rides yet.');

      renderTable('#usersTableBody', data.customers, (customer) => `
        <td>${customer.name}</td>
        <td>${customer.email || '-'}</td>
        <td>${customer.phone || '-'}</td>
        <td>${new Date(customer.createdAt).toLocaleString()}</td>
      `, 4, 'No customers registered yet.');

      renderTable('#driversTableBody', data.drivers, (driver) => `
        <td>${driver.name}</td>
        <td>${driver.phone || '-'}</td>
        <td>${driver.vehicle || '-'}</td>
        <td>${driver.online ? 'online' : 'offline'}</td>
        <td>${driver.currentRideId || '-'}</td>
        <td>${DOM.money(driver.earningsTotal || 0)}</td>
      `, 6, 'No drivers registered yet.');

      renderTable('#ridesTableBody', data.rides, (ride) => `
        <td>${ride.id}</td>
        <td>${ride.customerName}</td>
        <td>${ride.driverName}</td>
        <td>${ride.pickup}</td>
        <td>${ride.dropoff}</td>
        <td>${ride.status}</td>
        <td>${DOM.money(ride.fare)}</td>
        <td>${['completed', 'cancelled'].includes(ride.status) ? '-' : `<button class="btn small" data-action="cancel-ride" data-id="${ride.id}">Cancel</button>`}</td>
      `, 8, 'No rides found.');

      DOM.qs('#earningsRevenue').textContent = DOM.money(data.summary.revenue);
      DOM.qs('#earningsCompletedTrips').textContent = String(data.summary.completedRides);
      DOM.qs('#earningsCancelledTrips').textContent = String(data.summary.cancelledRides);

      renderTable('#driverEarningsBody', data.drivers, (driver) => `
        <td>${driver.name}</td>
        <td>${data.rides.filter((ride) => ride.driverId === driver.id && ride.status === 'completed').length}</td>
        <td>${DOM.money(driver.earningsToday || 0)}</td>
        <td>${DOM.money(driver.earningsTotal || 0)}</td>
      `, 4, 'No driver earnings yet.');

      renderTable('#notificationsBody', data.notifications, (item) => `
        <td>${new Date(item.createdAt).toLocaleString()}</td>
        <td>${item.targetType}</td>
        <td>${item.type || 'info'}</td>
        <td>${item.message}</td>
      `, 4, 'No notifications sent yet.');

      DOM.qs('#settingBaseFare').value = data.settings.baseFare;
      DOM.qs('#settingPerKm').value = data.settings.perKm;
      DOM.qs('#settingPerMin').value = data.settings.perMin;
      DOM.qs('#settingSurge').value = data.settings.surge;
      DOM.qs('#settingCancelFee').value = data.settings.cancelFee;
    },
  };

  function renderTable(selector, rows, rowTemplate, colspan, emptyMessage) {
    const body = DOM.qs(selector);
    body.innerHTML = '';
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colspan}">${emptyMessage}</td></tr>`;
      return;
    }
    rows.forEach((rowData) => {
      const row = document.createElement('tr');
      row.innerHTML = rowTemplate(rowData);
      body.appendChild(row);
    });
  }

  const Actions = {
    async login() {
      const email = DOM.qs('#adminEmail').value.trim();
      const password = DOM.qs('#adminPassword').value;
      const data = await DOM.api('/api/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }, '');
      state.auth = { email: data.admin.email, token: data.token };
      saveJson(STORAGE_KEY, state.auth);
      UI.setAuthenticated(true);
      await Actions.refresh();
      Actions.ensureEvents();
    },
    async refresh() {
      state.data = await DOM.api('/api/admin/state');
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
    async cancelRide(rideId) {
      await DOM.api(`/api/rides/${encodeURIComponent(rideId)}/cancel`, { method: 'POST', body: '{}' });
      await Actions.refresh();
      DOM.toast(`Ride ${rideId} cancelled.`);
    },
    async sendNotification() {
      const target = DOM.qs('#notificationTarget').value;
      const message = DOM.qs('#notificationMessage').value.trim();
      if (!message) return;
      await DOM.api('/api/admin/notifications', { method: 'POST', body: JSON.stringify({ target, message, type: 'info' }) });
      DOM.qs('#notificationMessage').value = '';
      await Actions.refresh();
      DOM.toast('Notification sent.');
    },
    async saveSettings() {
      await DOM.api('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({
          baseFare: Number(DOM.qs('#settingBaseFare').value),
          perKm: Number(DOM.qs('#settingPerKm').value),
          perMin: Number(DOM.qs('#settingPerMin').value),
          surge: Number(DOM.qs('#settingSurge').value),
          cancelFee: Number(DOM.qs('#settingCancelFee').value),
        }),
      });
      await Actions.refresh();
      DOM.toast('Pricing settings saved.');
    },
  };

  const Events = {
    attach() {
      DOM.qsa('.sidebar-item').forEach((item) => item.addEventListener('click', () => UI.setActiveSection(item.dataset.section)));
      DOM.qs('#toggleSidebar')?.addEventListener('click', () => UI.toggleSidebar());
      DOM.qs('#mobileSidebarToggle')?.addEventListener('click', () => UI.toggleSidebar());
      DOM.qs('#notifToggle')?.addEventListener('click', () => UI.setActiveSection('notifications'));
      DOM.qs('#adminLoginForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.login().catch((error) => DOM.toast(error.message));
      });
      DOM.qs('#notificationForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.sendNotification().catch((error) => DOM.toast(error.message));
      });
      DOM.qs('#pricingForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.saveSettings().catch((error) => DOM.toast(error.message));
      });
      document.body.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action="cancel-ride"]');
        if (action) Actions.cancelRide(action.dataset.id).catch((error) => DOM.toast(error.message));
      });
      document.addEventListener('click', (event) => {
        if (window.innerWidth <= 1024 && !event.target.closest('.sidebar') && !event.target.closest('#mobileSidebarToggle')) {
          UI.toggleSidebar(true);
        }
      });
    },
  };

  return {
    async init() {
      Events.attach();
      UI.setAuthenticated(false);
      if (state.auth.email) DOM.qs('#adminEmail').value = state.auth.email;
      if (state.auth.token) {
        try {
          UI.setAuthenticated(true);
          await Actions.refresh();
          Actions.ensureEvents();
        } catch {
          localStorage.removeItem(STORAGE_KEY);
          state.auth = { email: '', token: '' };
          UI.setAuthenticated(false);
        }
      }
    },
  };
})();

window.addEventListener('DOMContentLoaded', () => {
  TelekaAdmin.init().catch((error) => window.alert(error.message));
});
