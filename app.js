const TelekaAdmin = (() => {
  const state = {
    activeSection: 'overview',
    data: null,
    eventSource: null,
  };

  const DOM = {
    qs(selector, root = document) {
      return root.querySelector(selector);
    },
    qsa(selector, root = document) {
      return Array.from(root.querySelectorAll(selector));
    },
    formatCurrency(amount) {
      return new Intl.NumberFormat('en-UG', {
        style: 'currency',
        currency: 'UGX',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(Number(amount) || 0);
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
    toast(message) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('visible'));
      setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    },
  };

  const Renderer = {
    setActiveSection(sectionId) {
      state.activeSection = sectionId;
      DOM.qsa('.section').forEach((section) => {
        section.classList.toggle('active', section.id === sectionId);
      });
      DOM.qsa('.sidebar-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.section === sectionId);
      });
      DOM.qs('.page-title').textContent = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
      if (window.innerWidth <= 1024) {
        UI.toggleSidebar(true);
      }
    },

    renderSummary() {
      if (!state.data) return;
      const { summary } = state.data;
      DOM.qs('#summaryCustomers').textContent = String(summary.totalCustomers);
      DOM.qs('#summaryDriversOnline').textContent = String(summary.onlineDrivers);
      DOM.qs('#summaryPendingRides').textContent = String(summary.pendingRides);
      DOM.qs('#summaryActiveRides').textContent = String(summary.activeRides);
      DOM.qs('#summaryCompletedRides').textContent = String(summary.completedRides);
      DOM.qs('#summaryRevenue').textContent = DOM.formatCurrency(summary.revenue);
      DOM.qs('#notifCount').textContent = String((state.data.notifications || []).length);
    },

    renderOverviewRides() {
      const body = DOM.qs('#overviewRidesBody');
      body.innerHTML = '';
      const rides = (state.data?.rides || []).slice(0, 8);
      if (!rides.length) {
        body.innerHTML = '<tr><td colspan="6">No rides yet.</td></tr>';
        return;
      }
      rides.forEach((ride) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${ride.id}</td>
          <td>${ride.customerName}</td>
          <td>${ride.driverName}</td>
          <td>${ride.pickup} → ${ride.dropoff}</td>
          <td>${ride.status}</td>
          <td>${DOM.formatCurrency(ride.fare)}</td>
        `;
        body.appendChild(row);
      });
    },

    renderUsers() {
      const body = DOM.qs('#usersTableBody');
      body.innerHTML = '';
      const customers = state.data?.customers || [];
      if (!customers.length) {
        body.innerHTML = '<tr><td colspan="4">No customers registered yet.</td></tr>';
        return;
      }
      customers.forEach((customer) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${customer.name}</td>
          <td>${customer.email || '-'}</td>
          <td>${customer.phone || '-'}</td>
          <td>${new Date(customer.createdAt).toLocaleString()}</td>
        `;
        body.appendChild(row);
      });
    },

    renderDrivers() {
      const body = DOM.qs('#driversTableBody');
      body.innerHTML = '';
      const drivers = state.data?.drivers || [];
      if (!drivers.length) {
        body.innerHTML = '<tr><td colspan="6">No drivers registered yet.</td></tr>';
        return;
      }
      drivers.forEach((driver) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${driver.name}</td>
          <td>${driver.phone || '-'}</td>
          <td>${driver.vehicle || '-'}</td>
          <td>${driver.online ? 'online' : 'offline'}</td>
          <td>${driver.currentRideId || '-'}</td>
          <td>${DOM.formatCurrency(driver.earningsTotal || 0)}</td>
        `;
        body.appendChild(row);
      });
    },

    renderRides() {
      const body = DOM.qs('#ridesTableBody');
      body.innerHTML = '';
      const rides = state.data?.rides || [];
      if (!rides.length) {
        body.innerHTML = '<tr><td colspan="8">No rides found.</td></tr>';
        return;
      }
      rides.forEach((ride) => {
        const isClosed = ['completed', 'cancelled'].includes(ride.status);
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${ride.id}</td>
          <td>${ride.customerName}</td>
          <td>${ride.driverName}</td>
          <td>${ride.pickup}</td>
          <td>${ride.dropoff}</td>
          <td>${ride.status}</td>
          <td>${DOM.formatCurrency(ride.fare)}</td>
          <td>${isClosed ? '-' : `<button class="btn small" data-action="cancel-ride" data-id="${ride.id}">Cancel</button>`}</td>
        `;
        body.appendChild(row);
      });
    },

    renderEarnings() {
      const rides = state.data?.rides || [];
      const completed = rides.filter((ride) => ride.status === 'completed');
      const cancelled = rides.filter((ride) => ride.status === 'cancelled');
      DOM.qs('#earningsRevenue').textContent = DOM.formatCurrency(
        completed.reduce((sum, ride) => sum + (ride.fare || 0), 0)
      );
      DOM.qs('#earningsCompletedTrips').textContent = String(completed.length);
      DOM.qs('#earningsCancelledTrips').textContent = String(cancelled.length);

      const body = DOM.qs('#driverEarningsBody');
      body.innerHTML = '';
      const drivers = state.data?.drivers || [];
      if (!drivers.length) {
        body.innerHTML = '<tr><td colspan="4">No driver earnings yet.</td></tr>';
        return;
      }
      drivers.forEach((driver) => {
        const completedTrips = rides.filter((ride) => ride.driverId === driver.id && ride.status === 'completed').length;
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${driver.name}</td>
          <td>${completedTrips}</td>
          <td>${DOM.formatCurrency(driver.earningsToday || 0)}</td>
          <td>${DOM.formatCurrency(driver.earningsTotal || 0)}</td>
        `;
        body.appendChild(row);
      });
    },

    renderNotifications() {
      const body = DOM.qs('#notificationsBody');
      body.innerHTML = '';
      const notifications = state.data?.notifications || [];
      if (!notifications.length) {
        body.innerHTML = '<tr><td colspan="4">No notifications sent yet.</td></tr>';
        return;
      }
      notifications.forEach((notification) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${new Date(notification.createdAt).toLocaleString()}</td>
          <td>${notification.targetType}</td>
          <td>${notification.type || 'info'}</td>
          <td>${notification.message}</td>
        `;
        body.appendChild(row);
      });
    },

    renderSettings() {
      const settings = state.data?.settings;
      if (!settings) return;
      DOM.qs('#settingBaseFare').value = settings.baseFare;
      DOM.qs('#settingPerKm').value = settings.perKm;
      DOM.qs('#settingPerMin').value = settings.perMin;
      DOM.qs('#settingSurge').value = settings.surge;
      DOM.qs('#settingCancelFee').value = settings.cancelFee;
    },

    renderAll() {
      Renderer.renderSummary();
      Renderer.renderOverviewRides();
      Renderer.renderUsers();
      Renderer.renderDrivers();
      Renderer.renderRides();
      Renderer.renderEarnings();
      Renderer.renderNotifications();
      Renderer.renderSettings();
    },
  };

  const UI = {
    toggleSidebar(forceClose = false) {
      const sidebar = DOM.qs('.sidebar');
      if (!sidebar) return;
      const isMobile = window.innerWidth <= 1024;
      if (isMobile) {
        const isOpen = sidebar.classList.contains('open');
        sidebar.classList.toggle('open', forceClose ? false : !isOpen);
        return;
      }
      const collapsed = sidebar.classList.contains('collapsed');
      sidebar.classList.toggle('collapsed', forceClose || !collapsed);
    },
  };

  const Actions = {
    async refresh() {
      state.data = await DOM.api('/api/admin/state');
      Renderer.renderAll();
    },

    ensureEventStream() {
      if (state.eventSource) return;
      const stream = new EventSource('/api/events');
      stream.addEventListener('state-update', () => {
        Actions.refresh().catch(console.warn);
      });
      stream.onerror = () => {
        stream.close();
        state.eventSource = null;
        setTimeout(() => Actions.ensureEventStream(), 3000);
      };
      state.eventSource = stream;
    },

    async cancelRide(rideId) {
      await DOM.api(`/api/rides/${encodeURIComponent(rideId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await Actions.refresh();
      DOM.toast(`Ride ${rideId} cancelled.`);
    },

    async sendNotification() {
      const target = DOM.qs('#notificationTarget').value;
      const message = DOM.qs('#notificationMessage').value.trim();
      if (!message) return;
      await DOM.api('/api/admin/notifications', {
        method: 'POST',
        body: JSON.stringify({ target, message, type: 'info' }),
      });
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
      DOM.qsa('.sidebar-item').forEach((item) => {
        item.addEventListener('click', () => Renderer.setActiveSection(item.dataset.section));
      });

      DOM.qs('#toggleSidebar')?.addEventListener('click', () => UI.toggleSidebar());
      DOM.qs('#mobileSidebarToggle')?.addEventListener('click', () => UI.toggleSidebar());
      DOM.qs('#notifToggle')?.addEventListener('click', () => Renderer.setActiveSection('notifications'));

      DOM.qs('#notificationForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.sendNotification().catch((error) => DOM.toast(error.message));
      });

      DOM.qs('#pricingForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        Actions.saveSettings().catch((error) => DOM.toast(error.message));
      });

      document.body.addEventListener('click', (event) => {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl) return;
        if (actionEl.dataset.action === 'cancel-ride') {
          Actions.cancelRide(actionEl.dataset.id).catch((error) => DOM.toast(error.message));
        }
      });

      document.addEventListener('click', (event) => {
        if (window.innerWidth <= 1024 && !event.target.closest('.sidebar') && !event.target.closest('#mobileSidebarToggle')) {
          UI.toggleSidebar(true);
        }
      });
    },
  };

  const init = async () => {
    Events.attach();
    await Actions.refresh();
    Actions.ensureEventStream();
  };

  return { init };
})();

window.addEventListener('DOMContentLoaded', () => {
  TelekaAdmin.init().catch((error) => {
    window.alert(error.message);
  });
});
