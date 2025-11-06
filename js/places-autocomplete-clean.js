const PlacesAutocomplete = {
    POPULAR_TYPES: [
        'airport', 'bus_station', 'train_station', 'hotel', 'shopping_mall',
        'gas_station', 'hospital', 'restaurant', 'bank', 'supermarket',
        'tourist_attraction', 'point_of_interest'
    ],

    init(pickupId, destinationId) {
        const pickupInput = document.getElementById(pickupId);
        const destinationInput = document.getElementById(destinationId);
        if (!pickupInput || !destinationInput) return;

        this.setupInput(pickupInput);
        this.setupInput(destinationInput);
    },

    setupInput(input) {
        const wrapper = this.createWrapper(input);
        const dropdown = this.createDropdown(wrapper);
        const loadingBar = this.createLoadingBar(wrapper);

        let debounceTimer = null;
        let suggestions = [];
        let sessionToken = this.getSessionToken();

        const fetchAndShowNearby = async () => {
            loadingBar.style.display = 'block';
            try {
                const nearby = await this.fetchNearbyPlaces(sessionToken);
                suggestions = nearby;
                this.showSuggestions(dropdown, suggestions, index => this.handleSelection(input, suggestions[index], () => {
                    sessionToken = this.getSessionToken();
                    this.calculatePriceIfReady();
                }));
            } finally {
                loadingBar.style.display = 'none';
            }
        };

        const handleInput = async () => {
            const query = input.value.trim();
            if (query.length < 1) {
                this.hideDropdown(dropdown);
                fetchAndShowNearby();
                return;
            }

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                loadingBar.style.display = 'block';
                try {
                    suggestions = await this.fetchSuggestions(query, sessionToken);
                    this.showSuggestions(dropdown, suggestions, index => this.handleSelection(input, suggestions[index], () => {
                        sessionToken = this.getSessionToken();
                        this.calculatePriceIfReady();
                    }));
                } finally {
                    loadingBar.style.display = 'none';
                }
            }, 200);
        };

        input.addEventListener('input', handleInput);
        input.addEventListener('focus', handleInput);

        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.pac-item:not(.pac-error)');
            if (!items || items.length === 0) return;

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const current = dropdown.querySelector('.pac-item-selected');
                let idx = Array.from(items).indexOf(current);
                if (e.key === 'ArrowDown') idx = Math.min(items.length - 1, idx + 1);
                else idx = idx <= 0 ? items.length - 1 : idx - 1;

                items.forEach(it => it.classList.remove('pac-item-selected'));
                if (idx >= 0) items[idx].classList.add('pac-item-selected');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const sel = dropdown.querySelector('.pac-item-selected');
                if (sel) {
                    const index = parseInt(sel.dataset.index, 10);
                    if (!isNaN(index)) this.handleSelection(input, suggestions[index], () => {
                        sessionToken = this.getSessionToken();
                        this.calculatePriceIfReady();
                    });
                }
            } else if (e.key === 'Escape') {
                this.hideDropdown(dropdown);
            }
        });

        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) this.hideDropdown(dropdown);
        });
    },

    createWrapper(input) {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        return wrapper;
    },

    createDropdown(wrapper) {
        const dropdown = document.createElement('div');
        dropdown.className = 'pac-container';
        dropdown.style.display = 'none';
        dropdown.style.position = 'absolute';
        dropdown.style.width = '100%';
        dropdown.style.zIndex = '1000';
        dropdown.style.top = '100%';
        dropdown.style.left = '0';
        wrapper.appendChild(dropdown);
        return dropdown;
    },

    createLoadingBar(wrapper) {
        const loadingBar = document.createElement('div');
        loadingBar.className = 'loading-bar';
        loadingBar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--primary),var(--accent));background-size:200% 100%;animation:loading 1.5s infinite linear;display:none;';
        wrapper.appendChild(loadingBar);
        return loadingBar;
    },

    async fetchSuggestions(query, sessionToken) {
        const recentPlaces = this.getRecentPlaces().filter(p => this.matchesQuery(p, query)).map(p => ({ ...p, _recent: true }));
        try {
            const resp = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(query)}&sessiontoken=${sessionToken}`);
            const data = await resp.json();

            if (data && data.predictions && data.predictions.length) return [...recentPlaces, ...data.predictions];

            // If Google returned an error (e.g. legacy API / not enabled), log it but fall back to OSM
            if (data && data.error_message) {
                console.warn('Places API returned error_message, falling back to OSM:', data.error_message);
            } else if (data && data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
                console.warn('Places API status:', data.status);
            }

            const osm = await this.fetchFromOpenStreetMap(query);
            if (osm.length) return [...recentPlaces, ...osm];

            return recentPlaces.length ? recentPlaces : [{ _error: true, message: 'No matches found.' }];
        } catch (err) {
            console.error('Error fetching suggestions:', err);
            return recentPlaces.length ? recentPlaces : [{ _error: true, message: 'Network error fetching suggestions.' }];
        }
    },

    async fetchNearbyPlaces(sessionToken) {
        try {
            const pos = await this.getCurrentPosition();
            const resp = await fetch(`/api/places/nearby?location=${pos.lat},${pos.lng}&sessiontoken=${sessionToken}`);
            const data = await resp.json();
            if (data.results && data.results.length) {
                return data.results.map(place => ({
                    place_id: place.place_id,
                    description: place.name,
                    structured_formatting: { main_text: place.name, secondary_text: place.vicinity || '' },
                    types: place.types || []
                }));
            }
            return [{ _error: true, message: 'No popular places found nearby.' }];
        } catch (err) {
            console.warn('Nearby fetch failed:', err);
            return [{ _error: true, message: 'Could not fetch nearby places.' }];
        }
    },

    getCurrentPosition() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) return resolve({ lat: 0.3476, lng: 32.5825 });
            navigator.geolocation.getCurrentPosition(pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => resolve({ lat: 0.3476, lng: 32.5825 }), { timeout: 5000 });
        });
    },

    async fetchFromOpenStreetMap(query) {
        try {
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=ug&limit=6`);
            const data = await resp.json();
            return data.map(item => ({
                place_id: `osm:${item.osm_id}`,
                description: item.display_name,
                structured_formatting: { main_text: (item.display_name || '').split(',')[0], secondary_text: (item.display_name || '').split(',').slice(1).join(',').trim() },
                types: item.type ? [item.type] : []
            }));
        } catch (err) {
            console.warn('OSM fallback failed:', err);
            return [];
        }
    },

    showSuggestions(dropdown, items, onSelect) {
        if (!items || items.length === 0) return this.hideDropdown(dropdown);
        dropdown.innerHTML = items.map((item, i) => {
            if (item._error) return `<div class="pac-item pac-error"><span class="pac-item-query">${item.message}</span></div>`;
            const main = item.structured_formatting?.main_text || item.description || '';
            const sec = item.structured_formatting?.secondary_text || '';
            const type = item.types && item.types[0] ? ` (${this.formatPlaceType(item.types[0])})` : '';
            const recentClass = item._recent ? 'recent' : '';
            return `<div class="pac-item ${recentClass}" data-index="${i}">${item._recent ? '<span class="recent-icon">↻</span>' : ''}<span class="pac-item-query">${main}${type}</span><span>${sec}</span></div>`;
        }).join('');
        dropdown.style.display = 'block';
        dropdown.querySelectorAll('.pac-item:not(.pac-error)').forEach(item => item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index, 10);
            if (!isNaN(idx)) onSelect(idx);
        }));
    },

    hideDropdown(dropdown) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
    },

    formatPlaceType(type) {
        return String(type).split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    },

    async handleSelection(input, item, onComplete) {
        if (!item || item._error) return;
        let placeDetails = item;
        if (item.place_id && !String(item.place_id).startsWith('osm:')) {
            try {
                const resp = await fetch(`/api/places/details?place_id=${encodeURIComponent(item.place_id)}`);
                const data = await resp.json();
                if (data.result) placeDetails = data.result;
            } catch (err) {
                console.warn('Details fetch failed:', err);
            }
        }

        input.value = placeDetails.formatted_address || placeDetails.description || placeDetails.name || '';
        this.saveRecentPlace(placeDetails);
        if (onComplete) onComplete();
    },

    calculatePriceIfReady() {
        const pickup = document.getElementById('pickup').value;
        const destination = document.getElementById('destination').value;
        if (pickup && destination) this.calculatePrice(pickup, destination);
    },

    async calculatePrice(origin, destination) {
        const display = document.getElementById('priceDisplay');
        if (!display) return;
        display.innerHTML = '<div class="price-info">Calculating price...</div>';
        display.classList.add('loading');
        try {
            const resp = await fetch(`/api/calculate-price?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`);
            const data = await resp.json();
            if (data.error) throw new Error(data.error);
            const price = new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(data.price);
            const distance = data.distance?.text || '';
            const duration = data.duration?.text || '';
            display.innerHTML = `
                <div class="price-info">
                    <div class="price-amount">${price}</div>
                    <div class="trip-details">
                        <div>
                            <i class="fas fa-route"></i> ${distance} ・ 
                            <i class="fas fa-clock"></i> ${duration}
                        </div>
                            <div class="traffic-level" data-level="${data.traffic_level}">
                                <i class="fas fa-car"></i> ${data.traffic_level} Traffic
                            </div>
                    </div>
                </div>
            `;
        } catch (err) {
            console.error('Price calc failed:', err);
            display.innerHTML = '<div class="price-info"><div style="color:var(--text-light);"><i class="fas fa-exclamation-circle"></i> Could not calculate price.</div></div>';
        } finally {
            display.classList.remove('loading');
        }
    },

    getRecentPlaces() {
        try {
            const raw = localStorage.getItem('teleka_places');
            if (!raw) return [];
            const { places, timestamp } = JSON.parse(raw);
            if (Date.now() - timestamp > 7 * 24 * 60 * 60 * 1000) { localStorage.removeItem('teleka_places'); return []; }
            return places || [];
        } catch (e) { console.warn(e); return []; }
    },

    saveRecentPlace(place) {
        try {
            const recent = this.getRecentPlaces();
            const newPlace = {
                place_id: place.place_id || place.id || place.placeId || null,
                description: place.formatted_address || place.description || place.name || '',
                structured_formatting: { main_text: place.name || place.structured_formatting?.main_text || '', secondary_text: place.structured_formatting?.secondary_text || '' },
                types: place.types || []
            };
            const updated = [newPlace, ...recent.filter(p => p.place_id !== newPlace.place_id)].slice(0,5);
            localStorage.setItem('teleka_places', JSON.stringify({ places: updated, timestamp: Date.now() }));
        } catch (e) { console.warn(e); }
    },

    matchesQuery(place, query) {
        if (!place || !query) return false;
        query = query.toLowerCase();
        return (place.description && place.description.toLowerCase().includes(query)) || (place.structured_formatting?.main_text && place.structured_formatting.main_text.toLowerCase().includes(query));
    },

    getSessionToken() {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
            return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
        } catch (e) {
            return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
        }
    }
};

// initialize if inputs exist
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('pickup') && document.getElementById('destination')) {
            PlacesAutocomplete.init('pickup', 'destination');
        }
    });
} else {
    if (document.getElementById('pickup') && document.getElementById('destination')) {
        PlacesAutocomplete.init('pickup', 'destination');
    }
}
