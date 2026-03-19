/*
  Teleka Taxi Admin Dashboard (Mock)
  -----------------------------------
  - Pure vanilla JS (ES6+)
  - Modular structure to support future Socket.io integration
  - Uses localStorage for settings persistence
  - Simulates live updates (driver movement, ride status changes)
*/

const TelekaAdmin = (() => {
  const state = {
    users: [],
    drivers: [],
    rides: [],
    notifications: [],
    reviews: [],
    tickets: [],
    zones: [],
    promoCodes: [],
    referrals: [],
    campaigns: [],
    activityLog: [],
    settings: {
      baseFare: 2.5,
      perKm: 1.2,
      perMin: 0.25,
      surge: 1.0,
      cancelFee: 5,
    },
    session: {
      ip: '192.168.1.89',
      device: 'Chrome on Windows 11',
      started: new Date().toISOString(),
    },
    monitoring: {
      uptimeStart: Date.now(),
      apiStatus: 'online',
      dbStatus: 'online',
      errors: [],
    },
    map: {
      drivers: [],
      hotspots: [],
    },
    charts: {
      revenue: null,
      rides: null,
      users: null,
      overview: null,
    },
    analyticsRange: 'daily',
    refreshInterval: null,
    directions: {
      activeSection: 'overview',
    },
  };

  const CACHE = {
    selectors: {
      sidebarItems: '.sidebar-item',
      sectionClass: '.section',
      pageTitle: '.page-title',
      searchGlobal: '#globalSearch',
      notifCount: '#notifCount',
      modal: '#modal',
    },
  };

  const utils = {
    formatCurrency(value, currency = 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value);
    },

    clamp(num, min, max) {
      return Math.min(Math.max(num, min), max);
    },

    randomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    pick(array) {
      return array[Math.floor(Math.random() * array.length)];
    },

    uuid() {
      return 'xxxxxx'.replace(/[x]/g, () => {
        return ((Math.random() * 16) | 0).toString(16);
      });
    },

    now() {
      return new Date().toISOString();
    },

    when(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  };

  /* ---------- UI Helpers ---------- */
  const DOM = {
    qs(selector, root = document) {
      return root.querySelector(selector);
    },
    qsa(selector, root = document) {
      return Array.from(root.querySelectorAll(selector));
    },
    create(tag, props = {}) {
      const el = document.createElement(tag);
      Object.entries(props).forEach(([key, value]) => {
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'html') el.innerHTML = value;
        else if (key === 'attrs') {
          Object.entries(value).forEach(([attr, val]) => el.setAttribute(attr, val));
        } else el.setAttribute(key, value);
      });
      return el;
    },

    empty(el) {
      if (!el) return;
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };

  /* ---------- Modal ---------- */
  const Modal = {
    init() {
      this.modal = DOM.qs('#modal');
      this.title = DOM.qs('#modalTitle', this.modal);
      this.body = DOM.qs('#modalBody', this.modal);
      this.closeBtn = DOM.qs('#modalClose', this.modal);
      this.backdrop = this.modal.querySelector('.modal-backdrop');

      this.closeBtn.addEventListener('click', () => this.close());
      this.backdrop.addEventListener('click', () => this.close());
      document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape' && !this.modal.classList.contains('hidden')) {
          this.close();
        }
      });
    },

    open({ title = 'Details', content = '' } = {}) {
      this.title.textContent = title;
      if (typeof content === 'string') {
        this.body.innerHTML = content;
      } else {
        this.body.innerHTML = '';
        this.body.appendChild(content);
      }
      this.modal.classList.remove('hidden');
      this.modal.setAttribute('aria-hidden', 'false');
    },

    close() {
      this.modal.classList.add('hidden');
      this.modal.setAttribute('aria-hidden', 'true');
    },
  };

  /* ---------- Data Generators ---------- */
  const DataGenerator = {
    firstNames: ['Amina', 'David', 'Fatima', 'Isaac', 'Jane', 'Kofi', 'Lina', 'Mark', 'Nora', 'Paul'],
    lastNames: ['Akello', 'Brown', 'Chen', 'Doe', 'Eze', 'Garcia', 'Hassan', 'Ibrahim', 'Jones', 'Khan'],
    cars: ['Toyota Corolla', 'Honda Civic', 'Mercedes C200', 'Nissan Altima', 'Ford Ranger', 'BMW 3 Series'],
    statuses: ['pending', 'accepted', 'in-progress', 'completed', 'cancelled'],

    makeName() {
      return `${utils.pick(this.firstNames)} ${utils.pick(this.lastNames)}`;
    },

    makeEmail(name) {
      const slug = name.toLowerCase().replace(/\s+/g, '.');
      return `${slug}@example.com`;
    },

    makePhone() {
      return `+256 ${utils.randomInt(700, 799)} ${utils.randomInt(100, 999)} ${utils.randomInt(100, 999)}`;
    },

    makeUser() {
      const name = this.makeName();
      return {
        id: `u-${utils.uuid()}`,
        name,
        email: this.makeEmail(name),
        phone: this.makePhone(),
        status: utils.pick(['active', 'blocked']),
        rides: utils.randomInt(0, 25),
        joined: new Date(Date.now() - utils.randomInt(2, 365) * 24 * 60 * 60 * 1000).toISOString(),
      };
    },

    makeDriver() {
      const name = this.makeName();
      const status = utils.pick(['pending', 'active', 'inactive']);
      return {
        id: `d-${utils.uuid()}`,
        name,
        vehicle: `${utils.pick(this.cars)} (${utils.randomInt(2013, 2023)})`,
        status,
        rating: (Math.random() * 1.5 + 3.5).toFixed(1),
        earnings: utils.randomInt(500, 6500),
        completedRides: utils.randomInt(10, 230),
        cancellationRate: (Math.random() * 10).toFixed(1),
        online: Math.random() > 0.4,
        docs: { idCard: 'Approved', license: 'Approved', insurance: 'Uploaded' },
        location: {
          lat: 0.32 + Math.random() * 0.8,
          lng: 32.4 + Math.random() * 0.8,
        },
      };
    },

    makeRide(user, driver) {
      const status = utils.pick(this.statuses);
      const distance = utils.randomInt(2, 18);
      const duration = utils.randomInt(6, 55);
      const fare = (state.settings.baseFare + distance * state.settings.perKm + duration * state.settings.perMin) * state.settings.surge;
      return {
        id: `r-${utils.uuid()}`,
        userId: user.id,
        driverId: driver.id,
        userName: user.name,
        driverName: driver.name,
        status,
        distance,
        duration,
        fare: parseFloat(fare.toFixed(2)),
        startedAt: new Date(Date.now() - utils.randomInt(0, 4) * 60 * 60 * 1000).toISOString(),
        pickup: `Zone ${utils.randomInt(1, 12)}`,
        dropoff: `Zone ${utils.randomInt(1, 12)}`,
      };
    },

    init() {
      state.users = Array.from({ length: 38 }, () => this.makeUser());
      state.drivers = Array.from({ length: 28 }, () => this.makeDriver());
      state.rides = Array.from({ length: 48 }, () => this.makeRide(utils.pick(state.users), utils.pick(state.drivers)));
      state.reviews = state.rides
        .slice(0, 18)
        .map((ride) => ({
          id: `rev-${utils.uuid()}`,
          user: ride.userName,
          driver: ride.driverName,
          rating: utils.randomInt(3, 5),
          comment: utils.pick([
            'Great service!',
            'Driver arrived early.',
            'Car was clean and comfortable.',
            'Driver was polite but took a longer route.',
            'Fast pickup, smooth ride.',
            'Could be better with navigation.',
            'Excellent service, will use again.',
          ]),
          createdAt: new Date(Date.now() - utils.randomInt(1, 30) * 24 * 60 * 60 * 1000).toISOString(),
          flagged: false,
          responded: false,
        }));

      state.notifications = [
        { id: `n-${utils.uuid()}`, date: utils.now(), target: 'all', message: 'Scheduled maintenance at midnight.', status: 'sent' },
        { id: `n-${utils.uuid()}`, date: utils.now(), target: 'drivers', message: 'New surge pricing in downtown areas.', status: 'sent' },
      ];

      state.tickets = Array.from({ length: 8 }, (_, i) => ({
        id: `T-${1000 + i}`,
        user: utils.pick(state.users).name,
        type: utils.pick(['Payment issue', 'Ride missing', 'Driver behavior', 'Refund request']),
        status: utils.pick(['open', 'pending', 'resolved']),
        updatedAt: new Date(Date.now() - utils.randomInt(1, 72) * 60 * 60 * 1000).toISOString(),
        conversation: [
          { from: 'user', text: 'I was charged twice for my last ride.', time: utils.now() },
          { from: 'admin', text: 'I am checking the payment logs now.', time: utils.now() },
        ],
        notes: '',
      }));

      state.zones = [
        { id: `z-${utils.uuid()}`, name: 'Downtown', multiplier: 1.0, active: true },
        { id: `z-${utils.uuid()}`, name: 'Airport', multiplier: 1.35, active: true },
        { id: `z-${utils.uuid()}`, name: 'Suburbs', multiplier: 0.9, active: true },
      ];

      state.promoCodes = [
        { code: 'TELEKA10', discount: 10, expiresInDays: 14, createdAt: utils.now(), active: true },
        { code: 'RIDE20', discount: 20, expiresInDays: 7, createdAt: utils.now(), active: true },
      ];

      state.referrals = [
        { referrer: 'Jane Doe', referrals: 12, reward: '$45' },
        { referrer: 'Mark Brown', referrals: 9, reward: '$30' },
        { referrer: 'Amina Hassan', referrals: 7, reward: '$25' },
      ];

      state.campaigns = [
        { id: `c-${utils.uuid()}`, name: 'Summer Promo', impressions: 3200, conversions: 210, revenue: 4300, status: 'Active' },
        { id: `c-${utils.uuid()}`, name: 'Airport Rush', impressions: 4200, conversions: 330, revenue: 5900, status: 'Paused' },
      ];

      state.activityLog = [
        { time: utils.now(), user: 'Admin', action: 'Logged in', details: 'Dashboard access' },
        { time: utils.now(), user: 'Finance', action: 'Generated payout report', details: 'March earnings' },
      ];

      // Initialize map hotspots
      state.map.hotspots = Array.from({ length: 4 }, () => ({
        lat: 0.35 + Math.random() * 0.6,
        lng: 32.2 + Math.random() * 0.6,
        intensity: utils.randomInt(60, 95),
      }));
    },
  };

  /* ---------- Rendering ---------- */
  const Renderer = {
    setActiveSection(sectionId) {
      state.directions.activeSection = sectionId;
      DOM.qsa(CACHE.selectors.sectionClass).forEach((section) => {
        section.classList.toggle('active', section.id === sectionId);
      });
      DOM.qs(CACHE.selectors.pageTitle).textContent = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);

      DOM.qsa(CACHE.selectors.sidebarItems).forEach((item) => {
        item.classList.toggle('active', item.dataset.section === sectionId);
      });

      if (sectionId === 'overview') {
        Renderer.renderOverview();
      } else if (sectionId === 'users') {
        Renderer.renderUsers();
      } else if (sectionId === 'drivers') {
        Renderer.renderDrivers();
      } else if (sectionId === 'rides') {
        Renderer.renderRides();
      } else if (sectionId === 'earnings') {
        Renderer.renderEarnings();
      } else if (sectionId === 'analytics') {
        Renderer.renderAnalytics();
      } else if (sectionId === 'notifications') {
        Renderer.renderNotifications();
      } else if (sectionId === 'reviews') {
        Renderer.renderReviews();
      } else if (sectionId === 'settings') {
        Renderer.renderSettings();
      } else if (sectionId === 'zones') {
        Renderer.renderZones();
      } else if (sectionId === 'support') {
        Renderer.renderSupport();
      } else if (sectionId === 'security') {
        Renderer.renderSecurity();
      } else if (sectionId === 'monitoring') {
        Renderer.renderMonitoring();
      } else if (sectionId === 'marketing') {
        Renderer.renderMarketing();
      }
    },

    renderOverview() {
      const activeRides = state.rides.filter((ride) => ride.status === 'in-progress').length;
      const totalRides = state.rides.length;
      const totalRevenue = state.rides.reduce((sum, ride) => sum + ride.fare, 0);
      const cancelled = state.rides.filter((r) => r.status === 'cancelled').length;
      const averageRating = state.reviews.length
        ? (state.reviews.reduce((sum, r) => sum + r.rating, 0) / state.reviews.length).toFixed(1)
        : '0.0';
      const activeUsers = state.users.filter((u) => u.status === 'active').length;
      const activeDrivers = state.drivers.filter((d) => d.online).length;

      DOM.qs('#cardTotalRides').textContent = totalRides;
      DOM.qs('#cardTotalRidesDaily').textContent = Math.round(totalRides * 0.14);
      DOM.qs('#cardTotalRidesWeekly').textContent = Math.round(totalRides * 0.45);
      DOM.qs('#cardTotalRidesMonthly').textContent = totalRides;
      DOM.qs('#cardActiveRides').textContent = activeRides;
      DOM.qs('#cardActiveUsers').textContent = activeUsers + activeDrivers;
      DOM.qs('#cardActiveDrivers').textContent = activeDrivers;
      DOM.qs('#cardActiveCustomers').textContent = activeUsers;
      DOM.qs('#cardRevenue').textContent = utils.formatCurrency(totalRevenue);
      DOM.qs('#cardRevenueToday').textContent = utils.formatCurrency(totalRevenue * 0.07);
      DOM.qs('#cardRevenueMonth').textContent = utils.formatCurrency(totalRevenue);
      DOM.qs('#cardCancelled').textContent = cancelled;
      DOM.qs('#cardCancelRate').textContent = `${totalRides ? ((cancelled / totalRides) * 100).toFixed(1) : 0}%`;
      DOM.qs('#cardCancelLastHour').textContent = utils.randomInt(0, 3);
      DOM.qs('#cardRating').textContent = averageRating;
      DOM.qs('#cardRatingDrivers').textContent = state.drivers.length;
      DOM.qs('#cardRatingCustomers').textContent = state.users.length;

      DOM.qs('#heatmapDemand').textContent = utils.pick(['Low', 'Moderate', 'High', 'Very High']);
      DOM.qs('#peakHour').textContent = `${utils.randomInt(6, 10)}:00 - ${utils.randomInt(11, 14)}:00`;
      DOM.qs('#avgWait').textContent = `${utils.randomInt(2, 7)} min`;
      DOM.qs('#apiStatus').textContent = state.monitoring.apiStatus === 'online' ? 'Online' : 'Degraded';
      DOM.qs('#apiStatus').className = `status ${state.monitoring.apiStatus === 'online' ? 'status-ok' : 'status-warn'}`;

      DOM.qs('#liveStatus').textContent = 'now';

      Renderer.drawMap();
      Renderer.renderOverviewChart();
    },

    drawMap() {
      const canvas = DOM.qs('#liveMap');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Background grid
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Demand hotspots
      state.map.hotspots.forEach((hotspot) => {
        const x = (hotspot.lng - 32.2) / 0.6 * width;
        const y = (hotspot.lat - 0.35) / 0.6 * height;
        const radius = hotspot.intensity / 12;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(255, 106, 0, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 106, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Drivers
      state.drivers.forEach((driver) => {
        const x = (driver.location.lng - 32.2) / 0.6 * width;
        const y = (driver.location.lat - 0.35) / 0.6 * height;
        const size = 10;
        ctx.fillStyle = driver.online ? '#00e676' : 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.stroke();
      });

      // Ongoing trips
      state.rides
        .filter((ride) => ride.status === 'in-progress')
        .slice(0, 10)
        .forEach((ride) => {
          const driver = state.drivers.find((d) => d.id === ride.driverId);
          if (!driver) return;
          const x = (driver.location.lng - 32.2) / 0.6 * width;
          const y = (driver.location.lat - 0.35) / 0.6 * height;
          ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 20, y - 20);
          ctx.stroke();
        });
    },

    renderOverviewChart() {
      const ctx = DOM.qs('#overviewChart');
      if (!ctx) return;
      const labels = Array.from({ length: 7 }, (_, idx) => {
        const d = new Date(Date.now() - (6 - idx) * 24 * 60 * 60 * 1000);
        return d.toLocaleDateString(undefined, { weekday: 'short' });
      });
      const data = labels.map(() => utils.randomInt(120, 560));

      if (state.charts.overview) {
        state.charts.overview.data.labels = labels;
        state.charts.overview.data.datasets[0].data = data;
        state.charts.overview.update();
        return;
      }

      state.charts.overview = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Revenue',
              data,
              borderColor: 'rgba(102, 126, 234, 0.9)',
              backgroundColor: 'rgba(102, 126, 234, 0.3)',
              fill: true,
              tension: 0.3,
              pointRadius: 3,
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
            y: { beginAtZero: true },
          },
        },
      });
    },

    renderUsers(page = 1) {
      const search = DOM.qs('#userSearch').value.trim().toLowerCase();
      const statusFilter = DOM.qs('#userStatusFilter').value;
      const perPage = 10;
      let filtered = state.users.slice();

      if (search) {
        filtered = filtered.filter((user) => {
          return (
            user.name.toLowerCase().includes(search) ||
            user.email.toLowerCase().includes(search) ||
            user.phone.toLowerCase().includes(search)
          );
        });
      }
      if (statusFilter !== 'all') {
        filtered = filtered.filter((user) => user.status === statusFilter);
      }

      const pages = Math.ceil(filtered.length / perPage) || 1;
      const currentPage = Math.min(page, pages);
      const start = (currentPage - 1) * perPage;
      const pageItems = filtered.slice(start, start + perPage);

      const tbody = DOM.qs('#usersTableBody');
      DOM.empty(tbody);
      pageItems.forEach((user) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${user.name}</td>
          <td>${user.email}</td>
          <td>${user.phone}</td>
          <td><span class="badge ${user.status === 'active' ? 'badge-ok' : 'badge-warn'}">${user.status}</span></td>
          <td>${user.rides}</td>
          <td class="table-actions">
            <button class="btn small" data-action="view-user" data-id="${user.id}">View</button>
            <button class="btn small secondary" data-action="toggle-user" data-id="${user.id}">${user.status === 'active' ? 'Block' : 'Unblock'}</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      Renderer.renderPagination('usersPagination', pages, currentPage, (next) => Renderer.renderUsers(next));
      DOM.qs('#usersMeta').textContent = `Showing ${start + 1}-${Math.min(start + perPage, filtered.length)} of ${filtered.length} users`;
    },

    renderDrivers(page = 1) {
      const search = DOM.qs('#driverSearch').value.trim().toLowerCase();
      const statusFilter = DOM.qs('#driverStatusFilter').value;
      const perPage = 10;

      let filtered = state.drivers.slice();
      if (search) {
        filtered = filtered.filter((driver) => {
          return (
            driver.name.toLowerCase().includes(search) ||
            driver.vehicle.toLowerCase().includes(search)
          );
        });
      }
      if (statusFilter !== 'all') {
        filtered = filtered.filter((driver) => driver.status === statusFilter);
      }

      const pages = Math.ceil(filtered.length / perPage) || 1;
      const currentPage = Math.min(page, pages);
      const start = (currentPage - 1) * perPage;
      const pageItems = filtered.slice(start, start + perPage);

      const tbody = DOM.qs('#driversTableBody');
      DOM.empty(tbody);

      pageItems.forEach((driver) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${driver.name}</td>
          <td>${driver.vehicle}</td>
          <td><span class="badge ${driver.status === 'active' ? 'badge-ok' : driver.status === 'pending' ? 'badge-info' : 'badge-warn'}">${driver.status}</span></td>
          <td>${driver.rating} <i class="fas fa-star star-small"></i></td>
          <td>${utils.formatCurrency(driver.earnings)}</td>
          <td class="table-actions">
            <button class="btn small" data-action="view-driver" data-id="${driver.id}">Docs</button>
            <button class="btn small secondary" data-action="toggle-driver" data-id="${driver.id}">${driver.status === 'active' ? 'Deactivate' : 'Activate'}</button>
            <button class="btn small" data-action="approve-driver" data-id="${driver.id}">${driver.status === 'pending' ? 'Approve' : 'Review'}</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      DOM.qs('#driverCompletedRides').textContent = state.drivers.reduce((sum, d) => sum + d.completedRides, 0);
      DOM.qs('#driverTotalEarnings').textContent = utils.formatCurrency(state.drivers.reduce((sum, d) => sum + d.earnings, 0));
      DOM.qs('#driverCancelRate').textContent = `${(state.drivers.reduce((sum, d) => sum + parseFloat(d.cancellationRate), 0) / state.drivers.length).toFixed(1)}%`;

      Renderer.renderPagination('driversPagination', pages, currentPage, (next) => Renderer.renderDrivers(next));
    },

    renderRides(page = 1) {
      const search = DOM.qs('#rideSearch').value.trim().toLowerCase();
      const statusFilter = DOM.qs('#rideStatusFilter').value;
      const perPage = 12;

      let filtered = state.rides.slice();
      if (search) {
        filtered = filtered.filter((ride) => {
          return (
            ride.id.toLowerCase().includes(search) ||
            ride.userName.toLowerCase().includes(search) ||
            ride.driverName.toLowerCase().includes(search)
          );
        });
      }
      if (statusFilter !== 'all') {
        filtered = filtered.filter((ride) => ride.status === statusFilter);
      }

      const pages = Math.ceil(filtered.length / perPage) || 1;
      const currentPage = Math.min(page, pages);
      const start = (currentPage - 1) * perPage;
      const pageItems = filtered.slice(start, start + perPage);

      const tbody = DOM.qs('#ridesTableBody');
      DOM.empty(tbody);

      pageItems.forEach((ride) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td data-label="Ride ID">${ride.id}</td>
          <td data-label="Customer">${ride.userName}</td>
          <td data-label="Driver">${ride.driverName}</td>
          <td data-label="Status"><span class="badge badge-${ride.status.replace('in-progress', 'inprogress')}">${ride.status}</span></td>
          <td data-label="Fare">${utils.formatCurrency(ride.fare)}</td>
          <td class="table-actions" data-label="Actions">
            <button class="btn small" data-action="view-ride" data-id="${ride.id}">Details</button>
            <button class="btn small secondary" data-action="cancel-ride" data-id="${ride.id}">Cancel</button>
            <button class="btn small" data-action="reassign-driver" data-id="${ride.id}">Reassign</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      Renderer.renderPagination('ridesPagination', pages, currentPage, (next) => Renderer.renderRides(next));
      DOM.qs('#ridesMeta').textContent = `Showing ${start + 1}-${Math.min(start + perPage, filtered.length)} of ${filtered.length} rides`;
    },

    renderEarnings() {
      const totalRevenue = state.rides.reduce((sum, ride) => sum + ride.fare, 0);
      const pendingPayouts = Math.round(state.drivers.reduce((sum, d) => sum + d.earnings * 0.18, 0));
      DOM.qs('#earningsRevenue').textContent = utils.formatCurrency(totalRevenue);
      DOM.qs('#earningsNet').textContent = utils.formatCurrency(totalRevenue * 0.87);
      DOM.qs('#earningsGross').textContent = utils.formatCurrency(totalRevenue);
      DOM.qs('#earningsPending').textContent = utils.formatCurrency(pendingPayouts);
      DOM.qs('#earningsDriversPending').textContent = state.drivers.length;
      DOM.qs('#earningsLastPayout').textContent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toLocaleDateString();

      const driverEarningsBody = DOM.qs('#driverEarningsBody');
      DOM.empty(driverEarningsBody);
      state.drivers.slice(0, 10).forEach((driver) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${driver.name}</td>
          <td>${driver.completedRides}</td>
          <td>${utils.formatCurrency(driver.earnings)}</td>
          <td><span class="badge ${driver.earnings > 1000 ? 'badge-ok' : 'badge-info'}">${driver.earnings > 1000 ? 'Paid' : 'Pending'}</span></td>
        `;
        driverEarningsBody.appendChild(tr);
      });
    },

    renderAnalytics() {
      if (!state.charts.revenue) {
        Renderer.initAnalyticsCharts();
      } else {
        Renderer.updateAnalyticsCharts();
      }
    },

    getAnalyticsLabels(range) {
      if (range === 'daily') {
        return Array.from({ length: 7 }, (_, i) => {
          const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          return d.toLocaleDateString(undefined, { weekday: 'short' });
        });
      }
      if (range === 'monthly') {
        return Array.from({ length: 6 }, (_, i) => {
          const d = new Date();
          d.setMonth(d.getMonth() - (5 - i));
          return d.toLocaleDateString(undefined, { month: 'short' });
        });
      }
      // weekly
      return Array.from({ length: 12 }, (_, i) => `Week ${i + 1}`);
    },

    initAnalyticsCharts() {
      const revenueCtx = DOM.qs('#revenueChart');
      const rideCtx = DOM.qs('#rideChart');
      const userCtx = DOM.qs('#userGrowthChart');

      const baseLabels = Renderer.getAnalyticsLabels(state.analyticsRange);
      const randomSeries = () => baseLabels.map(() => utils.randomInt(120, 860));

      state.charts.revenue = new Chart(revenueCtx, {
        type: 'bar',
        data: {
          labels: baseLabels,
          datasets: [
            {
              label: 'Revenue',
              data: randomSeries(),
              backgroundColor: 'rgba(102, 126, 234, 0.7)',
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
        },
      });

      state.charts.rides = new Chart(rideCtx, {
        type: 'line',
        data: {
          labels: baseLabels,
          datasets: [
            {
              label: 'Rides',
              data: randomSeries(),
              tension: 0.3,
              borderColor: 'rgba(29, 185, 84, 0.85)',
              backgroundColor: 'rgba(29, 185, 84, 0.25)',
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });

      state.charts.users = new Chart(userCtx, {
        type: 'line',
        data: {
          labels: baseLabels,
          datasets: [
            {
              label: 'Users',
              data: randomSeries(),
              tension: 0.4,
              borderColor: 'rgba(255, 159, 64, 0.9)',
              backgroundColor: 'rgba(255, 159, 64, 0.18)',
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });
    },

    updateAnalyticsCharts() {
      const labels = Renderer.getAnalyticsLabels(state.analyticsRange);
      [state.charts.revenue, state.charts.rides, state.charts.users].forEach((chart) => {
        chart.data.labels = labels;
        chart.data.datasets[0].data = labels.map(() => utils.randomInt(120, 860));
        chart.update();
      });
    },

    renderNotifications() {
      const body = DOM.qs('#notificationsBody');
      DOM.empty(body);
      state.notifications
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach((note) => {
          const tr = DOM.create('tr');
          tr.innerHTML = `
            <td>${new Date(note.date).toLocaleString()}</td>
            <td>${note.target}</td>
            <td>${note.message}</td>
            <td><span class="badge ${note.status === 'sent' ? 'badge-ok' : 'badge-info'}">${note.status}</span></td>
          `;
          body.appendChild(tr);
        });

      DOM.qs('#notifCount').textContent = state.notifications.filter((n) => n.status === 'sent').length;
    },

    renderReviews() {
      const body = DOM.qs('#reviewsBody');
      DOM.empty(body);
      state.reviews.forEach((review) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${review.user}</td>
          <td>${review.driver}</td>
          <td>${review.rating} <i class="fas fa-star star-small"></i></td>
          <td>${review.comment}</td>
          <td class="table-actions">
            <button class="btn small" data-action="flag-review" data-id="${review.id}">${review.flagged ? 'Flagged' : 'Flag'}</button>
            <button class="btn small secondary" data-action="respond-review" data-id="${review.id}">Respond</button>
          </td>
        `;
        body.appendChild(tr);
      });
    },

    renderSettings() {
      const saved = JSON.parse(localStorage.getItem('telekaAdminSettings') || 'null');
      if (saved) {
        state.settings = { ...state.settings, ...saved };
      }
      DOM.qs('#settingBaseFare').value = state.settings.baseFare;
      DOM.qs('#settingPerKm').value = state.settings.perKm;
      DOM.qs('#settingPerMin').value = state.settings.perMin;
      DOM.qs('#settingSurge').value = state.settings.surge;
      DOM.qs('#settingCancelFee').value = state.settings.cancelFee;
    },

    renderZones() {
      const body = DOM.qs('#zonesBody');
      DOM.empty(body);
      state.zones.forEach((zone) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${zone.name}</td>
          <td>${zone.multiplier.toFixed(1)}x</td>
          <td><span class="badge ${zone.active ? 'badge-ok' : 'badge-warn'}">${zone.active ? 'Active' : 'Disabled'}</span></td>
          <td class="table-actions">
            <button class="btn small" data-action="toggle-zone" data-id="${zone.id}">${zone.active ? 'Disable' : 'Enable'}</button>
            <button class="btn small secondary" data-action="remove-zone" data-id="${zone.id}">Remove</button>
          </td>
        `;
        body.appendChild(tr);
      });
    },

    renderSupport() {
      const body = DOM.qs('#ticketsBody');
      DOM.empty(body);
      state.tickets.forEach((ticket) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${ticket.id}</td>
          <td>${ticket.user}</td>
          <td>${ticket.type}</td>
          <td><span class="badge ${ticket.status === 'resolved' ? 'badge-ok' : ticket.status === 'pending' ? 'badge-info' : 'badge-warn'}">${ticket.status}</span></td>
          <td>${new Date(ticket.updatedAt).toLocaleString()}</td>
          <td class="table-actions">
            <button class="btn small" data-action="view-ticket" data-id="${ticket.id}">View</button>
            <button class="btn small secondary" data-action="resolve-ticket" data-id="${ticket.id}">Resolve</button>
          </td>
        `;
        body.appendChild(tr);
      });
    },

    renderSecurity() {
      const body = DOM.qs('#activityLogBody');
      DOM.empty(body);
      state.activityLog.forEach((log) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${new Date(log.time).toLocaleString()}</td>
          <td>${log.user}</td>
          <td>${log.action}</td>
          <td>${log.details}</td>
        `;
        body.appendChild(tr);
      });

      DOM.qs('#sessionIp').textContent = state.session.ip;
      DOM.qs('#sessionDevice').textContent = state.session.device;
      DOM.qs('#sessionStarted').textContent = new Date(state.session.started).toLocaleString();
    },

    renderMonitoring() {
      const elapsed = Date.now() - state.monitoring.uptimeStart;
      const minutes = Math.floor(elapsed / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const uptimeString = `${days}d ${hours % 24}h ${minutes % 60}m`;
      DOM.qs('#uptime').textContent = uptimeString;
      DOM.qs('#apiStatusIndicator').textContent = state.monitoring.apiStatus === 'online' ? 'Online' : 'Degraded';
      DOM.qs('#apiStatusIndicator').className = `status ${state.monitoring.apiStatus === 'online' ? 'status-ok' : 'status-warn'}`;
      DOM.qs('#dbStatusIndicator').textContent = state.monitoring.dbStatus === 'online' ? 'Online' : 'Down';
      DOM.qs('#dbStatusIndicator').className = `status ${state.monitoring.dbStatus === 'online' ? 'status-ok' : 'status-warn'}`;
      DOM.qs('#errorCount').textContent = state.monitoring.errors.length;

      const body = DOM.qs('#errorLogsBody');
      DOM.empty(body);
      state.monitoring.errors.slice(-8).reverse().forEach((error) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${new Date(error.time).toLocaleTimeString()}</td>
          <td>${error.service}</td>
          <td>${error.message}</td>
          <td><span class="badge ${error.severity === 'critical' ? 'badge-danger' : 'badge-warn'}">${error.severity}</span></td>
        `;
        body.appendChild(tr);
      });
    },

    renderMarketing() {
      const promoBody = DOM.qs('#promoBody');
      DOM.empty(promoBody);
      state.promoCodes.forEach((promo) => {
        const tr = DOM.create('tr');
        const expiresDate = new Date(Date.now() + promo.expiresInDays * 24 * 60 * 60 * 1000);
        tr.innerHTML = `
          <td>${promo.code}</td>
          <td>${promo.discount}%</td>
          <td>${expiresDate.toLocaleDateString()}</td>
          <td><span class="badge ${promo.active ? 'badge-ok' : 'badge-warn'}">${promo.active ? 'Active' : 'Expired'}</span></td>
        `;
        promoBody.appendChild(tr);
      });

      const referralBody = DOM.qs('#referralBody');
      DOM.empty(referralBody);
      state.referrals.forEach((row) => {
        const tr = DOM.create('tr');
        tr.innerHTML = `
          <td>${row.referrer}</td>
          <td>${row.referrals}</td>
          <td>${row.reward}</td>
        `;
        referralBody.appendChild(tr);
      });

      const grid = DOM.qs('#campaignGrid');
      DOM.empty(grid);
      state.campaigns.forEach((camp) => {
        const card = DOM.create('div', { class: 'campaign-card' });
        card.innerHTML = `
          <div class="campaign-header">
            <h4>${camp.name}</h4>
            <span class="badge ${camp.status === 'Active' ? 'badge-ok' : 'badge-info'}">${camp.status}</span>
          </div>
          <div class="campaign-metrics">
            <div><strong>${camp.impressions}</strong><span>Impressions</span></div>
            <div><strong>${camp.conversions}</strong><span>Conversions</span></div>
            <div><strong>${utils.formatCurrency(camp.revenue)}</strong><span>Revenue</span></div>
          </div>
        `;
        grid.appendChild(card);
      });
    },

    renderPagination(containerId, pages, currentPage, onChange) {
      const container = DOM.qs(`#${containerId}`);
      if (!container) return;
      DOM.empty(container);

      const createBtn = (label, target, disabled = false) => {
        const btn = DOM.create('button', { class: `btn tiny${disabled ? ' disabled' : ''}`, text: label });
        btn.disabled = disabled;
        btn.addEventListener('click', () => onChange(target));
        return btn;
      };

      container.appendChild(createBtn('«', 1, currentPage === 1));
      for (let i = 1; i <= pages; i++) {
        const btn = DOM.create('button', { class: `btn tiny${i === currentPage ? ' active' : ''}`, text: i });
        btn.addEventListener('click', () => onChange(i));
        container.appendChild(btn);
      }
      container.appendChild(createBtn('»', pages, currentPage === pages));
    },
  };

  /* ---------- Interaction / Events ---------- */
  const Events = {
    attach() {
      // Sidebar navigation
      DOM.qsa(CACHE.selectors.sidebarItems).forEach((item) => {
        item.addEventListener('click', () => {
          const section = item.dataset.section;
          if (section) {
            Renderer.setActiveSection(section);
            if (window.innerWidth < 900) {
              UI.toggleSidebar(true);
            }
          } else if (item.dataset.action === 'logout') {
            window.location.href = 'index.html';
          }
        });
      });

      // Global search
      DOM.qs(CACHE.selectors.searchGlobal).addEventListener('input', (evt) => {
        const term = evt.target.value.trim().toLowerCase();
        // Naively search, open relevant section
        if (term.length > 2) {
          if (term.match(/ride|trip/i)) {
            Renderer.setActiveSection('rides');
            DOM.qs('#rideSearch').value = term;
            Renderer.renderRides();
          } else if (term.match(/driver|car|vehicle/i)) {
            Renderer.setActiveSection('drivers');
            DOM.qs('#driverSearch').value = term;
            Renderer.renderDrivers();
          } else if (term.match(/user|customer|email/i)) {
            Renderer.setActiveSection('users');
            DOM.qs('#userSearch').value = term;
            Renderer.renderUsers();
          }
        }
      });

      // Notification panel toggle
      DOM.qs('#notifToggle').addEventListener('click', () => {
        Renderer.setActiveSection('notifications');
      });

      // Profile menu
      const profileBtn = DOM.qs('#profileMenu .profile-btn');
      const profileDropdown = DOM.qs('#profileMenu .profile-dropdown');
      profileBtn.addEventListener('click', () => {
        const expanded = profileBtn.getAttribute('aria-expanded') === 'true';
        profileBtn.setAttribute('aria-expanded', String(!expanded));
        profileDropdown.classList.toggle('open');
      });
      document.addEventListener('click', (evt) => {
        if (!DOM.qs('#profileMenu').contains(evt.target)) {
          profileDropdown.classList.remove('open');
          profileBtn.setAttribute('aria-expanded', 'false');
        }
      });
      DOM.qsa('#profileMenu .dropdown-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          if (action === 'signout') {
            window.location.href = 'index.html';
          } else if (action === 'settings') {
            Renderer.setActiveSection('settings');
          }
        });
      });

      // Mobile sidebar toggle
      DOM.qs('#mobileSidebarToggle').addEventListener('click', () => UI.toggleSidebar());
      DOM.qs('#toggleSidebar').addEventListener('click', () => UI.toggleSidebar());

      // User management handlers
      DOM.qs('#userSearch').addEventListener('input', () => Renderer.renderUsers());
      DOM.qs('#userStatusFilter').addEventListener('change', () => Renderer.renderUsers());
      DOM.qs('#userSearchClear').addEventListener('click', () => {
        DOM.qs('#userSearch').value = '';
        Renderer.renderUsers();
      });

      // Driver management handlers
      DOM.qs('#driverSearch').addEventListener('input', () => Renderer.renderDrivers());
      DOM.qs('#driverStatusFilter').addEventListener('change', () => Renderer.renderDrivers());
      DOM.qs('#driverSearchClear').addEventListener('click', () => {
        DOM.qs('#driverSearch').value = '';
        Renderer.renderDrivers();
      });

      // Ride management handlers
      DOM.qs('#rideSearch').addEventListener('input', () => Renderer.renderRides());
      DOM.qs('#rideStatusFilter').addEventListener('change', () => Renderer.renderRides());
      DOM.qs('#rideSearchClear').addEventListener('click', () => {
        DOM.qs('#rideSearch').value = '';
        Renderer.renderRides();
      });

      // Settings form
      DOM.qs('#pricingForm').addEventListener('submit', (evt) => {
        evt.preventDefault();
        state.settings.baseFare = parseFloat(DOM.qs('#settingBaseFare').value) || state.settings.baseFare;
        state.settings.perKm = parseFloat(DOM.qs('#settingPerKm').value) || state.settings.perKm;
        state.settings.perMin = parseFloat(DOM.qs('#settingPerMin').value) || state.settings.perMin;
        state.settings.surge = parseFloat(DOM.qs('#settingSurge').value) || state.settings.surge;
        state.settings.cancelFee = parseFloat(DOM.qs('#settingCancelFee').value) || state.settings.cancelFee;
        localStorage.setItem('telekaAdminSettings', JSON.stringify(state.settings));
        UI.toast('Settings saved locally.');
      });
      DOM.qs('#resetSettings').addEventListener('click', () => {
        localStorage.removeItem('telekaAdminSettings');
        Renderer.renderSettings();
        UI.toast('Pricing settings reset to defaults.');
      });

      // Zone form
      DOM.qs('#zoneForm').addEventListener('submit', (evt) => {
        evt.preventDefault();
        const name = DOM.qs('#zoneName').value.trim();
        const multiplier = parseFloat(DOM.qs('#zoneMultiplier').value) || 1;
        const active = DOM.qs('#zoneActive').checked;
        if (!name) return;
        state.zones.push({ id: `z-${utils.uuid()}`, name, multiplier, active });
        DOM.qs('#zoneName').value = '';
        Renderer.renderZones();
        UI.toast('Zone added.');
      });

      // Notifications
      DOM.qs('#notificationForm').addEventListener('submit', (evt) => {
        evt.preventDefault();
        const target = DOM.qs('#notificationTarget').value;
        const message = DOM.qs('#notificationMessage').value.trim();
        if (!message) return;
        state.notifications.unshift({ id: `n-${utils.uuid()}`, date: utils.now(), target, message, status: 'sent' });
        DOM.qs('#notificationMessage').value = '';
        Renderer.renderNotifications();
        UI.toast('Notification queued (mock).');
      });

      // Promotions
      DOM.qs('#promoForm').addEventListener('submit', (evt) => {
        evt.preventDefault();
        const code = DOM.qs('#promoCode').value.trim().toUpperCase();
        const discount = parseInt(DOM.qs('#promoDiscount').value, 10);
        const expiresInDays = parseInt(DOM.qs('#promoExpire').value, 10);
        if (!code || !discount || !expiresInDays) return;
        state.promoCodes.unshift({ code, discount, expiresInDays, createdAt: utils.now(), active: true });
        DOM.qs('#promoCode').value = '';
        DOM.qs('#promoDiscount').value = '';
        DOM.qs('#promoExpire').value = '';
        Renderer.renderMarketing();
        UI.toast('Promo code generated.');
      });
      DOM.qs('#clearPromos').addEventListener('click', () => {
        state.promoCodes = [];
        Renderer.renderMarketing();
      });

      // Analytics tabs
      DOM.qsa('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          DOM.qsa('.tab').forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          state.analyticsRange = tab.dataset.range || 'weekly';
          Renderer.updateAnalyticsCharts();
        });
      });

      // Delegate table actions
      document.body.addEventListener('click', (evt) => {
        const action = evt.target.closest('[data-action]');
        if (!action) return;
        const act = action.dataset.action;
        const id = action.dataset.id;

        switch (act) {
          case 'view-user':
            Actions.showUserDetails(id);
            break;
          case 'toggle-user':
            Actions.toggleUser(id);
            break;
          case 'view-driver':
            Actions.showDriverDocs(id);
            break;
          case 'toggle-driver':
            Actions.toggleDriver(id);
            break;
          case 'approve-driver':
            Actions.approveDriver(id);
            break;
          case 'view-ride':
            Actions.showRideDetails(id);
            break;
          case 'cancel-ride':
            Actions.cancelRide(id);
            break;
          case 'reassign-driver':
            Actions.reassignRide(id);
            break;
          case 'flag-review':
            Actions.flagReview(id);
            break;
          case 'respond-review':
            Actions.respondReview(id);
            break;
          case 'toggle-zone':
            Actions.toggleZone(id);
            break;
          case 'remove-zone':
            Actions.removeZone(id);
            break;
          case 'view-ticket':
            Actions.viewTicket(id);
            break;
          case 'resolve-ticket':
            Actions.resolveTicket(id);
            break;
          default:
            break;
        }
      });
    },
  };

  /* ---------- UI Utilities ---------- */
  const UI = {
    toggleSidebar(forceClose = false) {
      const sidebar = DOM.qs('.sidebar');
      const isMobile = window.innerWidth < 1024;

      if (isMobile) {
        const isOpen = sidebar.classList.contains('open');
        sidebar.classList.toggle('open', forceClose ? false : !isOpen);
        return;
      }

      const collapsed = sidebar.classList.contains('collapsed');
      sidebar.classList.toggle('collapsed', forceClose || !collapsed);
      const toggleLabel = DOM.qs('.toggle-label');
      if (sidebar.classList.contains('collapsed')) {
        toggleLabel?.setAttribute('aria-hidden', 'true');
      } else {
        toggleLabel?.removeAttribute('aria-hidden');
      }
    },

    toast(message) {
      const toast = DOM.create('div', { class: 'toast', text: message });
      document.body.appendChild(toast);
      setTimeout(() => toast.classList.add('visible'), 10);
      setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
      }, 3200);
    },
  };

  const Actions = {
    toggleUser(id) {
      const user = state.users.find((u) => u.id === id);
      if (!user) return;
      user.status = user.status === 'active' ? 'blocked' : 'active';
      Renderer.renderUsers();
      Renderer.renderOverview();
      UI.toast(`User ${user.name} has been ${user.status === 'active' ? 'unblocked' : 'blocked'}.`);
    },

    showUserDetails(id) {
      const user = state.users.find((u) => u.id === id);
      if (!user) return;
      const recentRides = state.rides.filter((ride) => ride.userId === id).slice(0, 5);
      const content = DOM.create('div');
      content.innerHTML = `
        <div class="modal-grid">
          <div class="modal-block">
            <h4>Profile</h4>
            <p><strong>Name:</strong> ${user.name}</p>
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Phone:</strong> ${user.phone}</p>
            <p><strong>Status:</strong> <span class="badge ${user.status === 'active' ? 'badge-ok' : 'badge-warn'}">${user.status}</span></p>
            <p><strong>Joined:</strong> ${new Date(user.joined).toLocaleDateString()}</p>
            <p><strong>Total rides:</strong> ${user.rides}</p>
          </div>
          <div class="modal-block">
            <h4>Recent rides</h4>
            <ul class="modal-list">
              ${recentRides
                .map(
                  (ride) =>
                    `<li><strong>${ride.id}</strong> — ${ride.status} • ${utils.formatCurrency(ride.fare)}</li>`
                )
                .join('')}
            </ul>
          </div>
        </div>
      `;
      Modal.open({ title: `User: ${user.name}`, content });
    },

    showDriverDocs(id) {
      const driver = state.drivers.find((d) => d.id === id);
      if (!driver) return;
      const content = DOM.create('div');
      content.innerHTML = `
        <div class="modal-grid">
          <div class="modal-block">
            <h4>Driver info</h4>
            <p><strong>Name:</strong> ${driver.name}</p>
            <p><strong>Vehicle:</strong> ${driver.vehicle}</p>
            <p><strong>Status:</strong> <span class="badge ${driver.status === 'active' ? 'badge-ok' : 'badge-info'}">${driver.status}</span></p>
            <p><strong>Rating:</strong> ${driver.rating} <i class="fas fa-star star-small"></i></p>
          </div>
          <div class="modal-block">
            <h4>Upload status</h4>
            <ul class="modal-list">
              <li><strong>ID card:</strong> ${driver.docs.idCard}</li>
              <li><strong>License:</strong> ${driver.docs.license}</li>
              <li><strong>Insurance:</strong> ${driver.docs.insurance}</li>
            </ul>
          </div>
        </div>
      `;
      Modal.open({ title: `Documents - ${driver.name}`, content });
    },

    toggleDriver(id) {
      const driver = state.drivers.find((d) => d.id === id);
      if (!driver) return;
      driver.status = driver.status === 'active' ? 'inactive' : 'active';
      driver.online = driver.status === 'active' ? true : driver.online;
      Renderer.renderDrivers();
      Renderer.renderOverview();
      UI.toast(`Driver ${driver.name} is now ${driver.status}.`);
    },

    approveDriver(id) {
      const driver = state.drivers.find((d) => d.id === id);
      if (!driver) return;
      driver.status = 'active';
      Renderer.renderDrivers();
      UI.toast(`${driver.name} approved.`);
    },

    showRideDetails(id) {
      const ride = state.rides.find((r) => r.id === id);
      if (!ride) return;
      const content = DOM.create('div');
      content.innerHTML = `
        <div class="modal-grid">
          <div class="modal-block">
            <h4>Ride summary</h4>
            <p><strong>Ride ID:</strong> ${ride.id}</p>
            <p><strong>Customer:</strong> ${ride.userName}</p>
            <p><strong>Driver:</strong> ${ride.driverName}</p>
            <p><strong>Status:</strong> <span class="badge badge-${ride.status.replace('in-progress', 'inprogress')}">${ride.status}</span></p>
            <p><strong>Fare:</strong> ${utils.formatCurrency(ride.fare)}</p>
            <p><strong>Distance:</strong> ${ride.distance} km</p>
            <p><strong>Duration:</strong> ${ride.duration} mins</p>
            <p><strong>Pickup:</strong> ${ride.pickup}</p>
            <p><strong>Dropoff:</strong> ${ride.dropoff}</p>
          </div>
          <div class="modal-block">
            <h4>Route map</h4>
            <div class="mini-map" aria-label="Route map placeholder">
              <span class="mini-map-pin"></span>
              <span class="mini-map-pin mini-map-pin--end"></span>
              <div class="mini-map-line"></div>
            </div>
          </div>
        </div>
      `;
      Modal.open({ title: `Ride ${ride.id}`, content });
    },

    cancelRide(id) {
      const ride = state.rides.find((r) => r.id === id);
      if (!ride || ride.status === 'cancelled') return;
      ride.status = 'cancelled';
      Renderer.renderRides();
      Renderer.renderOverview();
      UI.toast(`Ride ${ride.id} cancelled.`);
    },

    reassignRide(id) {
      const ride = state.rides.find((r) => r.id === id);
      if (!ride) return;
      const drivers = state.drivers.filter((d) => d.status === 'active');
      const select = DOM.create('select', { class: 'select' });
      drivers.forEach((driver) => {
        const option = DOM.create('option', { text: `${driver.name} (${driver.vehicle})`, value: driver.id });
        option.selected = driver.id === ride.driverId;
        select.appendChild(option);
      });

      const content = DOM.create('div');
      content.innerHTML = `<p>Select a new driver for this ride.</p>`;
      content.appendChild(select);
      const confirmBtn = DOM.create('button', { class: 'btn', text: 'Assign' });
      confirmBtn.addEventListener('click', () => {
        ride.driverId = select.value;
        const driver = state.drivers.find((d) => d.id === select.value);
        ride.driverName = driver ? driver.name : ride.driverName;
        Renderer.renderRides();
        UI.toast('Driver reassigned (mock).');
        Modal.close();
      });

      content.appendChild(confirmBtn);
      Modal.open({ title: `Reassign driver for ${ride.id}`, content });
    },

    flagReview(id) {
      const review = state.reviews.find((r) => r.id === id);
      if (!review) return;
      review.flagged = !review.flagged;
      Renderer.renderReviews();
      UI.toast(
        review.flagged ? 'Review flagged for moderation.' : 'Review unflagged.'
      );
    },

    respondReview(id) {
      const review = state.reviews.find((r) => r.id === id);
      if (!review) return;
      const textarea = DOM.create('textarea', { class: 'textarea', rows: 4 });
      const content = DOM.create('div');
      content.innerHTML = `<p>Reply to <strong>${review.user}</strong>:</p>`;
      content.appendChild(textarea);
      const send = DOM.create('button', { class: 'btn', text: 'Send reply' });
      send.addEventListener('click', () => {
        review.responded = true;
        UI.toast('Response recorded (mock).');
        Modal.close();
      });
      content.appendChild(send);
      Modal.open({ title: `Respond to review`, content });
    },

    toggleZone(id) {
      const zone = state.zones.find((z) => z.id === id);
      if (!zone) return;
      zone.active = !zone.active;
      Renderer.renderZones();
      UI.toast(`Zone "${zone.name}" is now ${zone.active ? 'active' : 'disabled'}.`);
    },

    removeZone(id) {
      state.zones = state.zones.filter((z) => z.id !== id);
      Renderer.renderZones();
      UI.toast('Zone removed.');
    },

    viewTicket(id) {
      const ticket = state.tickets.find((t) => t.id === id);
      if (!ticket) return;
      const content = DOM.create('div');
      content.innerHTML = `
        <div class="modal-grid">
          <div class="modal-block">
            <h4>Ticket details</h4>
            <p><strong>ID:</strong> ${ticket.id}</p>
            <p><strong>User:</strong> ${ticket.user}</p>
            <p><strong>Issue:</strong> ${ticket.type}</p>
            <p><strong>Status:</strong> <span class="badge ${ticket.status === 'resolved' ? 'badge-ok' : ticket.status === 'pending' ? 'badge-info' : 'badge-warn'}">${ticket.status}</span></p>
          </div>
          <div class="modal-block">
            <h4>Conversation</h4>
            <div class="modal-chat">
              ${ticket.conversation
                .map(
                  (msg) =>
                    `<div class="chat-line chat-line--${msg.from}"><strong>${msg.from === 'admin' ? 'Support' : 'User'}:</strong> ${msg.text}</div>`
                )
                .join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <label>Admin note</label>
          <textarea class="textarea" rows="3">${ticket.notes}</textarea>
          <button class="btn" id="saveTicketNote">Save note</button>
        </div>
      `;

      Modal.open({ title: `Ticket ${ticket.id}`, content });
      DOM.qs('#saveTicketNote').addEventListener('click', () => {
        const val = DOM.qs('.modal-footer textarea').value.trim();
        ticket.notes = val;
        UI.toast('Admin note saved.');
      });
    },

    resolveTicket(id) {
      const ticket = state.tickets.find((t) => t.id === id);
      if (!ticket) return;
      ticket.status = 'resolved';
      Renderer.renderSupport();
      UI.toast('Ticket marked as resolved.');
    },
  };

  /* ---------- Simulation ---------- */
  const Simulation = {
    start() {
      if (state.refreshInterval) return;
      state.refreshInterval = setInterval(() => {
        Simulation.updateDrivers();
        Simulation.randomRideUpdates();
        Simulation.randomMonitoringEvents();
        Renderer.renderOverview();
        if (state.directions.activeSection === 'analytics') {
          Renderer.updateAnalyticsCharts();
        }
      }, 5000);
    },

    stop() {
      clearInterval(state.refreshInterval);
      state.refreshInterval = null;
    },

    updateDrivers() {
      state.drivers.forEach((driver) => {
        if (Math.random() < 0.4) return;
        driver.location.lat += (Math.random() - 0.5) * 0.01;
        driver.location.lng += (Math.random() - 0.5) * 0.01;
        driver.location.lat = utils.clamp(driver.location.lat, 0.32, 1.1);
        driver.location.lng = utils.clamp(driver.location.lng, 32.2, 33.0);
        if (Math.random() > 0.8) driver.online = !driver.online;
      });
    },

    randomRideUpdates() {
      state.rides.forEach((ride) => {
        if (Math.random() > 0.85) {
          const nextStatus = {
            pending: 'accepted',
            accepted: 'in-progress',
            'in-progress': 'completed',
            completed: 'completed',
            cancelled: 'cancelled',
          };
          ride.status = nextStatus[ride.status] || ride.status;
        }
      });
    },

    randomMonitoringEvents() {
      if (Math.random() < 0.12) {
        state.monitoring.apiStatus = utils.pick(['online', 'degraded']);
        state.monitoring.dbStatus = utils.pick(['online', 'online', 'online', 'degraded']);
        state.monitoring.errors.unshift({
          time: utils.now(),
          service: utils.pick(['API', 'DB', 'Auth', 'Payments']),
          message: utils.pick([
            'Timeout while fetching driver locations.',
            'Database connection dropped.',
            'Payment provider returned 502.',
            'Unexpected token in JSON response.',
          ]),
          severity: utils.pick(['warning', 'critical']),
        });
      }
    },
  };

  /* ---------- Initialization ---------- */
  const init = () => {
    DataGenerator.init();
    Modal.init();
    Events.attach();
    Renderer.setActiveSection('overview');
    Renderer.renderUsers();
    Renderer.renderDrivers();
    Renderer.renderRides();
    Renderer.renderEarnings();
    Renderer.renderNotifications();
    Renderer.renderReviews();
    Renderer.renderSettings();
    Renderer.renderZones();
    Renderer.renderSupport();
    Renderer.renderSecurity();
    Renderer.renderMonitoring();
    Renderer.renderMarketing();
    Simulation.start();
  };

  return { init };
})();

window.addEventListener('DOMContentLoaded', () => TelekaAdmin.init());
