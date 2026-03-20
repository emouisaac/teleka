const TelekaAdmin = (() => {
  const STORAGE_KEY = 'telekaAdminAuth';
  const state = {
    auth: loadJson(STORAGE_KEY, { email: '', token: '' }),
    data: null,
    eventSource: null,
    promptedResetIds: [],
    audioContext: null,
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

  function requestSystemNotificationPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    Notification.requestPermission().catch(() => {});
  }

  function showSystemNotification(title, body, options = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return null;
    try {
      return new Notification(title, {
        body,
        icon: 'ims/t2icon.png',
        badge: 'ims/t2icon.png',
        renotify: true,
        ...options,
      });
    } catch {
      return null;
    }
  }

  const AudioAlerts = {
    unlock() {
      if (state.audioContext) return state.audioContext;
      const AudioContextRef = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextRef) return null;
      state.audioContext = new AudioContextRef();
      if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
      return state.audioContext;
    },
    pulse(frequency, startAt, duration, gainValue) {
      const context = AudioAlerts.unlock();
      if (!context) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.05);
    },
    playRideRequest() {
      const context = AudioAlerts.unlock();
      if (!context) return;
      const startAt = context.currentTime + 0.02;
      AudioAlerts.pulse(784, startAt, 0.22, 0.11);
      AudioAlerts.pulse(988, startAt + 0.26, 0.22, 0.11);
      AudioAlerts.pulse(1174, startAt + 0.54, 0.32, 0.12);
    },
    playNotification() {
      const context = AudioAlerts.unlock();
      if (!context) return;
      const startAt = context.currentTime + 0.02;
      AudioAlerts.pulse(622, startAt, 0.18, 0.1);
      AudioAlerts.pulse(831, startAt + 0.2, 0.22, 0.09);
      AudioAlerts.pulse(988, startAt + 0.46, 0.18, 0.085);
    },
  };

  function handleRealtimeAlerts(previousData, nextData) {
    if (!previousData) return;
    const previousPendingRideIds = new Set((previousData.rides || []).filter((ride) => ride.status === 'pending').map((ride) => ride.id));
    const nextPendingRide = (nextData.rides || []).find((ride) => ride.status === 'pending' && !previousPendingRideIds.has(ride.id));
    if (nextPendingRide) {
      AudioAlerts.playRideRequest();
      showSystemNotification(
        'New Ride Request',
        `${nextPendingRide.customerName} needs a ride from ${nextPendingRide.pickup} to ${nextPendingRide.dropoff}.`,
        { tag: `admin-ride-${nextPendingRide.id}`, requireInteraction: true }
      );
      DOM.toast(`New ride request ${nextPendingRide.id} received.`);
      return;
    }
    const previousNotificationIds = new Set((previousData.notifications || []).map((item) => item.id));
    const latestNotification = (nextData.notifications || [])[0];
    if (latestNotification && !previousNotificationIds.has(latestNotification.id)) {
      AudioAlerts.playNotification();
      showSystemNotification('Teleka Admin Alert', latestNotification.message || 'You have a new admin alert.', {
        tag: `admin-notification-${latestNotification.id}`,
      });
    }
  }

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
        <td>${driver.online ? 'online' : driver.approvalStatus || 'offline'}</td>
        <td>${driver.documents?.verified ? 'verified' : (driver.approvalStatus || 'pending')}</td>
        <td>${driver.currentRideId || '-'}</td>
        <td>${DOM.money(driver.earningsTotal || 0)}</td>
        <td>${driver.approvalStatus === 'approved'
          ? `<button class="btn small" data-action="reset-driver-password" data-id="${driver.id}">Reset Password</button>`
          : '-'}</td>
      `, 8, 'No drivers registered yet.');

      renderTable('#driverApplicationsBody', data.driverApplications || [], (driver) => `
        <td>${driver.name}</td>
        <td>${driver.phone || '-'}</td>
        <td>${driver.vehicle || '-'}${driver.plate ? ` / ${driver.plate}` : ''}</td>
        <td>${formatDocuments(driver.documents)}</td>
        <td>${driver.approvalStatus || 'pending'}</td>
        <td>${driver.approvalStatus === 'pending'
          ? `<button class="btn small" data-action="approve-driver" data-id="${driver.id}">Approve</button>
             <button class="btn small secondary" data-action="reject-driver" data-id="${driver.id}">Reject</button>`
          : (driver.approvalNotes || '-')}</td>
      `, 6, 'No pending driver applications.');

      renderTable('#driverResetRequestsBody', data.passwordResetRequests || [], (request) => `
        <td>${request.driverName}</td>
        <td>${request.registeredPhone}</td>
        <td>${request.whatsappNumber}</td>
        <td>${request.status}</td>
        <td>${new Date(request.createdAt).toLocaleString()}</td>
        <td>${request.status === 'pending'
          ? `<button class="btn small" data-action="send-reset-whatsapp" data-id="${request.id}">Send via WhatsApp</button>
             <button class="btn small secondary" data-action="reset-driver-password" data-id="${request.driverId}">Reset Password</button>`
          : (request.adminMessage || '-')}</td>
      `, 6, 'No password reset requests.');

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

      (data.passwordResetRequests || [])
        .filter((request) => request.status === 'pending' && !state.promptedResetIds.includes(request.id))
        .forEach((request) => {
          state.promptedResetIds.push(request.id);
          if (window.confirm(`Password reset requested by ${request.driverName} on ${request.whatsappNumber}. Send a WhatsApp response now?`)) {
            Actions.sendResetViaWhatsApp(request.id).catch((error) => DOM.toast(error.message));
          }
        });
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

  function formatDocuments(documents = {}) {
    const items = [
      documents.licenseNumber && `License: ${documents.licenseNumber}`,
      documents.nationalIdNumber && `National ID: ${documents.nationalIdNumber}`,
      documents.insuranceNumber && `Insurance: ${documents.insuranceNumber}`,
      documents.photoName && `Photo: ${documents.photoName}`,
      Array.isArray(documents.documentNames) && documents.documentNames.length ? `Files: ${documents.documentNames.join(', ')}` : '',
    ].filter(Boolean);
    return items.length ? items.join(' | ') : 'No documents';
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
      const previousData = state.data;
      state.data = await DOM.api('/api/admin/state');
      UI.render();
      handleRealtimeAlerts(previousData, state.data);
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
    async approveDriver(driverId) {
      await DOM.api(`/api/admin/drivers/${encodeURIComponent(driverId)}/approve`, { method: 'POST', body: JSON.stringify({ notes: 'Documents verified by admin' }) });
      await Actions.refresh();
      DOM.toast('Driver approved.');
    },
    async rejectDriver(driverId) {
      const notes = window.prompt('Reason for rejection', 'Incomplete or invalid driver documents');
      if (!notes) return;
      await DOM.api(`/api/admin/drivers/${encodeURIComponent(driverId)}/reject`, { method: 'POST', body: JSON.stringify({ notes }) });
      await Actions.refresh();
      DOM.toast('Driver rejected.');
    },
    async resetDriverPassword(driverId) {
      const password = window.prompt('Enter the new temporary password for this driver');
      if (!password) return;
      await DOM.api(`/api/admin/drivers/${encodeURIComponent(driverId)}/reset-password`, { method: 'POST', body: JSON.stringify({ password, adminMessage: 'Password reset by admin' }) });
      await Actions.refresh();
      DOM.toast('Driver password reset.');
    },
    async sendResetViaWhatsApp(requestId) {
      const request = (state.data?.passwordResetRequests || []).find((item) => item.id === requestId);
      if (!request) return;
      const message = window.prompt(
        'WhatsApp message to send',
        `Hello ${request.driverName}, your password reset request has been received. Reply here once you are ready to receive your temporary password.`
      );
      if (!message) return;
      const whatsappNumber = request.whatsappNumber.replace(/[^\d]/g, '');
      await DOM.api(`/api/admin/password-reset-requests/${encodeURIComponent(requestId)}/whatsapp`, {
        method: 'POST',
        body: JSON.stringify({ status: 'sent', adminMessage: message }),
      });
      window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
      await Actions.refresh();
      DOM.toast('WhatsApp handoff prepared.');
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
        const approve = event.target.closest('[data-action="approve-driver"]');
        if (approve) Actions.approveDriver(approve.dataset.id).catch((error) => DOM.toast(error.message));
        const reject = event.target.closest('[data-action="reject-driver"]');
        if (reject) Actions.rejectDriver(reject.dataset.id).catch((error) => DOM.toast(error.message));
        const resetPassword = event.target.closest('[data-action="reset-driver-password"]');
        if (resetPassword) Actions.resetDriverPassword(resetPassword.dataset.id).catch((error) => DOM.toast(error.message));
        const sendWhatsApp = event.target.closest('[data-action="send-reset-whatsapp"]');
        if (sendWhatsApp) Actions.sendResetViaWhatsApp(sendWhatsApp.dataset.id).catch((error) => DOM.toast(error.message));
      });
      document.addEventListener('pointerdown', () => {
        AudioAlerts.unlock();
        requestSystemNotificationPermission();
      }, { once: true });
      document.addEventListener('keydown', () => {
        AudioAlerts.unlock();
        requestSystemNotificationPermission();
      }, { once: true });
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
