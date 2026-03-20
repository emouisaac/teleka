const DriverApp = (() => {
  const appEl = document.querySelector('.driver-app');
  const state = {
    auth: { driverId: '' },
    profile: {},
    settings: { notifications: true, sound: true, autoAccept: false },
    data: null,
    chart: null,
    eventSource: null,
    audioContext: null,
    activeRequestId: '',
    requestToneInterval: null,
    locationWatchId: null,
    lastLocationSentAt: 0,
    registerFaceDataUrl: '',
  };

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
    async readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(`Failed to read ${file?.name || 'file'}`));
        reader.readAsDataURL(file);
      });
    },
    renderUploadList(container, files) {
      if (!container) return;
      container.innerHTML = files.length
        ? files.map((file) => `<div class="upload-preview-item">${file.name}</div>`).join('')
        : '<div class="upload-preview-empty">No files selected.</div>';
    },
    api(url, options = {}) {
      return fetch(url, {
        headers: {
          'Content-Type': 'application/json',
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
    masterNode() {
      const context = AudioAlerts.unlock();
      if (!context) return null;
      if (!state.audioMaster) {
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-18, context.currentTime);
        compressor.knee.setValueAtTime(12, context.currentTime);
        compressor.ratio.setValueAtTime(10, context.currentTime);
        compressor.attack.setValueAtTime(0.003, context.currentTime);
        compressor.release.setValueAtTime(0.24, context.currentTime);
        const masterGain = context.createGain();
        masterGain.gain.setValueAtTime(1.35, context.currentTime);
        compressor.connect(masterGain);
        masterGain.connect(context.destination);
        state.audioMaster = { compressor, masterGain };
      }
      return state.audioMaster.compressor;
    },
    pulse(frequency, startAt, duration, gainValue) {
      const context = AudioAlerts.unlock();
      const target = AudioAlerts.masterNode();
      if (!context || !target) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(target);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.05);
    },
    sweep(startFrequency, endFrequency, startAt, duration, gainValue) {
      const context = AudioAlerts.unlock();
      const target = AudioAlerts.masterNode();
      if (!context || !target) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(startFrequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(target);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.05);
    },
    playRideRequest() {
      if (!state.settings.notifications || !state.settings.sound) return;
      const context = AudioAlerts.unlock();
      if (!context) return;
      const startAt = context.currentTime + 0.02;
      AudioAlerts.sweep(640, 1180, startAt, 0.42, 0.34);
      AudioAlerts.pulse(960, startAt + 0.08, 0.28, 0.22);
      AudioAlerts.pulse(1280, startAt + 0.14, 0.22, 0.14);
      AudioAlerts.sweep(720, 1320, startAt + 0.56, 0.42, 0.36);
      AudioAlerts.pulse(1080, startAt + 0.64, 0.3, 0.24);
      AudioAlerts.pulse(1440, startAt + 0.7, 0.22, 0.15);
      AudioAlerts.pulse(880, startAt + 1.08, 0.2, 0.16);
      AudioAlerts.pulse(1320, startAt + 1.24, 0.34, 0.2);
    },
    playNotification() {
      if (!state.settings.notifications || !state.settings.sound) return;
      const context = AudioAlerts.unlock();
      if (!context) return;
      const startAt = context.currentTime + 0.02;
      AudioAlerts.pulse(740, startAt, 0.18, 0.1);
      AudioAlerts.pulse(988, startAt + 0.2, 0.22, 0.09);
      AudioAlerts.pulse(1174, startAt + 0.46, 0.18, 0.085);
    },
  };

  function stopRideRequestRingtone() {
    if (!state.requestToneInterval) return;
    clearInterval(state.requestToneInterval);
    state.requestToneInterval = null;
  }

  function stopLocationWatch() {
    if (state.locationWatchId === null || !navigator.geolocation) return;
    navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
  }

  async function publishDriverLocation(coords) {
    if (!state.auth.driverId || !coords) return;
    const nowMs = Date.now();
    if (nowMs - state.lastLocationSentAt < 10000) return;
    state.lastLocationSentAt = nowMs;
    try {
      await utils.api(`/api/drivers/${encodeURIComponent(state.auth.driverId)}/location`, {
        method: 'POST',
        body: JSON.stringify({
          lat: coords.latitude,
          lng: coords.longitude,
        }),
      });
    } catch {}
  }

  function ensureLocationWatch() {
    if (!navigator.geolocation || state.locationWatchId !== null || !state.data?.driver?.online) return;
    state.locationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        publishDriverLocation(position.coords).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    );
  }

  function startRideRequestRingtone(requestId) {
    if (!requestId || state.activeRequestId === requestId) return;
    stopRideRequestRingtone();
    state.activeRequestId = requestId;
    AudioAlerts.playRideRequest();
    if (navigator.vibrate) navigator.vibrate([300, 140, 300, 140, 420]);
    state.requestToneInterval = window.setInterval(() => {
      if (!state.data?.availableRequests?.some((ride) => ride.id === requestId)) {
        stopRideRequestRingtone();
        return;
      }
      AudioAlerts.playRideRequest();
    }, 3200);
  }

  function focusIncomingRequest(request) {
    if (!request) return;
    state.activeRequestId = request.id;
    UI.setActiveSection('activeRide');
  }

  function focusActiveRide(ride) {
    if (!ride) return;
    UI.setActiveSection('activeRide');
  }

  function stopFaceCamera() {
    const video = utils.qs('#registerFaceVideo');
    const stream = video?.srcObject;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
  }

  function handleRealtimeAlerts(previousData, nextData) {
    if (!previousData) return;
    const previousRequestIds = new Set((previousData.availableRequests || []).map((ride) => ride.id));
    const nextRequest = (nextData.availableRequests || [])[0];
    if (nextData.driver?.online && nextRequest && !previousRequestIds.has(nextRequest.id)) {
      startRideRequestRingtone(nextRequest.id);
      UI.setActiveSection('activeRide');
      focusIncomingRequest(nextRequest);
      const message = `${nextRequest.customerName || 'Customer'}: ${nextRequest.pickup} → ${nextRequest.dropoff}`;
      showSystemNotification('New Ride Request', message, { tag: `driver-ride-${nextRequest.id}`, requireInteraction: true });
      utils.toast('New ride request received.');
      alert(`New ride request\n${message}`);
      return;
    }
    const previousActiveRide = previousData.activeRide;
    const nextActiveRide = nextData.activeRide;
    const becameActiveRide = nextActiveRide && (!previousActiveRide || previousActiveRide.id !== nextActiveRide.id || previousActiveRide.status !== nextActiveRide.status);
    if (becameActiveRide) {
      stopRideRequestRingtone();
      focusActiveRide(nextActiveRide);
      AudioAlerts.playNotification();
      showSystemNotification(
        'Active Ride Ready',
        `${nextActiveRide.customerName || 'Customer'}: ${nextActiveRide.pickup} to ${nextActiveRide.dropoff}`,
        { tag: `driver-active-ride-${nextActiveRide.id}`, requireInteraction: true }
      );
      utils.toast('Active ride opened.');
      return;
    }
    const previousNotificationIds = new Set((previousData.notifications || []).map((item) => item.id));
    const latestNotification = (nextData.notifications || [])[0];
    if (latestNotification && !previousNotificationIds.has(latestNotification.id)) {
      AudioAlerts.playNotification();
      showSystemNotification('Teleka Driver Alert', latestNotification.message || 'You have a new update.', {
        tag: `driver-notification-${latestNotification.id}`,
      });
    }
  }

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
      const authShell = utils.qs('.driver-auth-shell');
      const authHero = utils.qs('.driver-auth-hero');
      const loginCard = utils.qs('.driver-auth-card--login');
      const registerCard = utils.qs('#driverRegisterCard');
      const toggleButton = utils.qs('#showRegisterForm');
      if (!registerCard || !toggleButton || !authShell || !authHero || !loginCard) return;
      const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : registerCard.classList.contains('hidden');
      authShell.classList.toggle('driver-auth-shell--register-only', shouldOpen);
      authHero.classList.toggle('hidden', shouldOpen);
      loginCard.classList.toggle('hidden', shouldOpen);
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
    currentActiveSection() {
      return utils.qs('.driver-section.active')?.id || '';
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
      const profilePhotoPreview = utils.qs('#profilePhotoPreview');
      const profileCarPreview = utils.qs('#profileCarPreview');
      if (profilePhotoPreview) {
        profilePhotoPreview.src = driver.avatar || '';
        profilePhotoPreview.classList.toggle('hidden', !driver.avatar);
      }
      if (profileCarPreview) {
        profileCarPreview.src = driver.documents?.carPhotoDataUrl || '';
        profileCarPreview.classList.toggle('hidden', !driver.documents?.carPhotoDataUrl);
      }
      utils.renderUploadList(utils.qs('#profileDocsPreview'), (driver.documents?.files || []).map((file) => ({ name: file.name || 'Document' })));

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
      utils.qs('#settingNotifications').checked = state.settings.notifications;
      utils.qs('#settingSound').checked = state.settings.sound;
      utils.qs('#settingAutoAccept').checked = state.settings.autoAccept;

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
      if (activeRide && UI.currentActiveSection() === 'dashboard') {
        focusActiveRide(activeRide);
      } else if (!activeRide && firstRequest && online && UI.currentActiveSection() === 'dashboard') {
        focusIncomingRequest(firstRequest);
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
      if (online) ensureLocationWatch();
      else stopLocationWatch();
    },
  };

  const Actions = {
    async ensureSession(reset = false) {
      if (reset) state.auth = { driverId: '' };
      await Actions.refresh();
      Actions.ensureEvents();
    },
    async refresh() {
      const previousData = state.data;
      state.data = await utils.api('/api/driver/state');
      state.profile = state.data.driver;
      state.auth.driverId = state.data.driver.id;
      state.settings = {
        notifications: Boolean(state.data.driver?.preferences?.notifications ?? true),
        sound: Boolean(state.data.driver?.preferences?.sound ?? true),
        autoAccept: Boolean(state.data.driver?.preferences?.autoAccept),
      };
      UI.setAuthenticated(true);
      UI.render();
      handleRealtimeAlerts(previousData, state.data);
    },
    ensureEvents() {
      if (state.eventSource) return;
      const stream = new EventSource('/api/events');
      stream.addEventListener('state-update', () => Actions.refresh().catch(console.warn));
      stream.onerror = () => {
        stream.close();
        state.eventSource = null;
        setTimeout(() => Actions.ensureEvents(), 3000);
      };
      state.eventSource = stream;
    },
    async toggleOnline(online) {
      const sendAvailability = async (coords = null) => utils.api(`/api/drivers/${encodeURIComponent(state.auth.driverId)}/availability`, {
        method: 'POST',
        body: JSON.stringify({
          online,
          lat: coords?.latitude,
          lng: coords?.longitude,
        }),
      });
      if (online && navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 15000,
            timeout: 10000,
          }));
          await sendAvailability(position.coords);
        } catch {
          await sendAvailability();
        }
      } else {
        await sendAvailability();
        if (!online) stopLocationWatch();
      }
      await Actions.refresh();
      utils.toast(`You are now ${online ? 'online' : 'offline'}.`);
    },
    async login() {
      const phone = utils.qs('#driverLoginPhone').value.trim();
      const password = utils.qs('#driverLoginPassword').value;
      const data = await utils.api('/api/drivers/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });
      state.auth = { driverId: data.driver.id };
      state.profile = data.driver;
      await Actions.refresh();
      Actions.ensureEvents();
      utils.toast('Driver login successful.');
    },
    async register() {
      const carPhotoInput = utils.qs('#registerCarPhoto');
      const docsInput = utils.qs('#registerDocs');
      const carPhotoDataUrl = carPhotoInput?.files?.[0] ? await utils.readFileAsDataUrl(carPhotoInput.files[0]) : '';
      const documentFiles = docsInput?.files
        ? await Promise.all(Array.from(docsInput.files).map(async (file) => ({ name: file.name, type: file.type, dataUrl: await utils.readFileAsDataUrl(file) })))
        : [];
      if (!state.registerFaceDataUrl) throw new Error('Capture a clear face photo before submitting.');
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
          avatar: state.registerFaceDataUrl,
          photoName: 'face-camera-capture.jpg',
          carPhotoName: carPhotoInput?.files?.[0]?.name || '',
          carPhotoDataUrl,
          documentNames: docsInput?.files ? Array.from(docsInput.files).map((file) => file.name) : [],
          documentFiles,
        }),
      }, '');
      utils.toast('Application submitted. Wait for admin approval before logging in.');
      utils.qs('#driverRegisterForm').reset();
      state.registerFaceDataUrl = '';
      stopFaceCamera();
      utils.qs('#registerFaceVideo').classList.add('hidden');
      utils.qs('#registerFacePreview').classList.add('hidden');
      utils.qs('#captureFacePhoto').classList.add('hidden');
      utils.qs('#retakeFacePhoto').classList.add('hidden');
      utils.qs('#startFaceCamera').classList.remove('hidden');
      utils.qs('#registerCarPreview').classList.add('hidden');
      utils.renderUploadList(utils.qs('#registerDocsPreview'), []);
      UI.toggleRegisterForm(false);
    },
    async saveProfile() {
      const photoInput = utils.qs('#profilePhoto');
      const carPhotoInput = utils.qs('#profileCarPhoto');
      const docsInput = utils.qs('#profileDocs');
      state.profile = {
        ...state.profile,
        name: utils.qs('#profileName').value.trim(),
        phone: utils.qs('#profilePhone').value.trim(),
        vehicle: utils.qs('#profileVehicle').value.trim(),
        plate: utils.qs('#profilePlate').value.trim(),
      };
      await utils.api(`/api/drivers/${encodeURIComponent(state.auth.driverId)}/profile`, {
        method: 'POST',
        body: JSON.stringify({
          ...state.profile,
          avatar: photoInput?.files?.[0] ? await utils.readFileAsDataUrl(photoInput.files[0]) : '',
          carPhotoName: carPhotoInput?.files?.[0]?.name || '',
          carPhotoDataUrl: carPhotoInput?.files?.[0] ? await utils.readFileAsDataUrl(carPhotoInput.files[0]) : '',
          documentFiles: docsInput?.files
            ? await Promise.all(Array.from(docsInput.files).map(async (file) => ({ name: file.name, type: file.type, dataUrl: await utils.readFileAsDataUrl(file) })))
            : [],
        }),
      });
      await Actions.refresh();
      utils.toast('Profile updated.');
    },
    async savePreferences() {
      if (!state.auth.driverId) return;
      await utils.api(`/api/drivers/${encodeURIComponent(state.auth.driverId)}/preferences`, {
        method: 'POST',
        body: JSON.stringify(state.settings),
      });
      await Actions.refresh();
    },
    async acceptRequest() {
      const request = (state.data?.availableRequests || []).find((ride) => ride.id === state.activeRequestId) || state.data?.availableRequests?.[0];
      if (!request) return;
      stopRideRequestRingtone();
      await utils.api(`/api/rides/${encodeURIComponent(request.id)}/accept`, { method: 'POST', body: '{}' });
      await Actions.refresh();
      UI.setActiveSection('activeRide');
      utils.toast('Ride accepted.');
    },
    async rejectRequest() {
      const request = (state.data?.availableRequests || []).find((ride) => ride.id === state.activeRequestId) || state.data?.availableRequests?.[0];
      if (!request) return;
      stopRideRequestRingtone();
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
    async logout() {
      stopRideRequestRingtone();
      stopLocationWatch();
      state.eventSource?.close();
      state.eventSource = null;
      try { await utils.api('/api/auth/driver/logout', { method: 'POST', body: '{}' }); } catch {}
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
      utils.qs('#showLoginForm').addEventListener('click', () => UI.toggleRegisterForm(false));
      utils.qs('#startFaceCamera').addEventListener('click', async () => {
        const video = utils.qs('#registerFaceVideo');
        const preview = utils.qs('#registerFacePreview');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        stopFaceCamera();
        video.srcObject = stream;
        video.classList.remove('hidden');
        preview.classList.add('hidden');
        utils.qs('#captureFacePhoto').classList.remove('hidden');
        utils.qs('#retakeFacePhoto').classList.add('hidden');
      });
      utils.qs('#captureFacePhoto').addEventListener('click', () => {
        const video = utils.qs('#registerFaceVideo');
        const preview = utils.qs('#registerFacePreview');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        state.registerFaceDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        preview.src = state.registerFaceDataUrl;
        preview.classList.remove('hidden');
        video.classList.add('hidden');
        utils.qs('#captureFacePhoto').classList.add('hidden');
        utils.qs('#retakeFacePhoto').classList.remove('hidden');
        stopFaceCamera();
      });
      utils.qs('#retakeFacePhoto').addEventListener('click', () => {
        state.registerFaceDataUrl = '';
        utils.qs('#startFaceCamera').click();
      });
      utils.qs('#registerCarPhoto').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        const preview = utils.qs('#registerCarPreview');
        if (!file) return preview.classList.add('hidden');
        preview.src = await utils.readFileAsDataUrl(file);
        preview.classList.remove('hidden');
      });
      utils.qs('#registerDocs').addEventListener('change', (event) => {
        utils.renderUploadList(utils.qs('#registerDocsPreview'), Array.from(event.target.files || []).map((file) => ({ name: file.name })));
      });
      utils.qs('#profilePhoto').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        const preview = utils.qs('#profilePhotoPreview');
        if (!file) return;
        preview.src = await utils.readFileAsDataUrl(file);
        preview.classList.remove('hidden');
      });
      utils.qs('#profileCarPhoto').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        const preview = utils.qs('#profileCarPreview');
        if (!file) return;
        preview.src = await utils.readFileAsDataUrl(file);
        preview.classList.remove('hidden');
      });
      utils.qs('#profileDocs').addEventListener('change', (event) => {
        utils.renderUploadList(utils.qs('#profileDocsPreview'), Array.from(event.target.files || []).map((file) => ({ name: file.name })));
      });
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
      utils.qs('#sidebarLogoutBtn').addEventListener('click', Actions.logout);
      utils.qs('#notifBtn').addEventListener('click', () => UI.setActiveSection('notifications'));
      utils.qs('#driverAvatar').addEventListener('click', () => UI.setActiveSection('profile'));
      utils.qs('#settingNotifications').addEventListener('change', (event) => {
        state.settings.notifications = event.target.checked;
        Actions.savePreferences().catch((error) => utils.toast(error.message));
      });
      utils.qs('#settingSound').addEventListener('change', (event) => {
        state.settings.sound = event.target.checked;
        Actions.savePreferences().catch((error) => utils.toast(error.message));
      });
      utils.qs('#settingAutoAccept').addEventListener('change', (event) => {
        state.settings.autoAccept = event.target.checked;
        Actions.savePreferences().catch((error) => utils.toast(error.message));
      });
      document.getElementById('menuToggle')?.addEventListener('click', UI.toggleNav);
      document.addEventListener('pointerdown', () => {
        AudioAlerts.unlock();
        requestSystemNotificationPermission();
      }, { once: true });
      document.addEventListener('keydown', () => {
        AudioAlerts.unlock();
        requestSystemNotificationPermission();
      }, { once: true });
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
      try {
        await Actions.ensureSession();
      } catch {
        stopRideRequestRingtone();
        stopLocationWatch();
        stopFaceCamera();
        state.auth = { driverId: '' };
        UI.setAuthenticated(false);
      }
    },
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  DriverApp.init().catch((error) => window.alert(error.message));
});
