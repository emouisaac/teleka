const navbarToggle = document.querySelector('.navbar-toggle');
const navbarMenu = document.querySelector('.navbar-menu');

navbarToggle.addEventListener('click', () => {
    navbarMenu.classList.toggle('active');
    navbarToggle.classList.toggle('active');
});

// Dark Mode Toggle from Settings
const darkModeToggle = document.querySelector('#dark-mode-toggle');

// Check for saved dark mode preference in localStorage or system settings
function initDarkMode() {
    let isDarkMode;
    const stored = localStorage.getItem('darkMode');
    if (stored !== null) {
        isDarkMode = stored === 'true';
    } else if (window.matchMedia) {
        // default to system preference if no value stored yet
        isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
        isDarkMode = false;
    }

    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        if (darkModeToggle) darkModeToggle.checked = true;
    } else {
        document.body.classList.remove('dark-mode');
        if (darkModeToggle) darkModeToggle.checked = false;
    }
}

// Initialize dark mode on page load
initDarkMode();

// Toggle dark mode via settings checkbox
if (darkModeToggle) {
    darkModeToggle.addEventListener('change', () => {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        localStorage.setItem('darkMode', isDarkMode);
    });
}

// Hero slider logic
function initHeroSlider() {
    const slides = document.querySelectorAll('.hero-content h1');
    if (slides.length === 0) return;
    let current = 0;
    slides.forEach((s, i) => s.style.color = '');
    slides[current].classList.add('active');
    slides[current].style.color = 'orange';
    setInterval(() => {
        const prev = slides[current];
        prev.classList.remove('active');
        prev.classList.add('exit');
        // prepare next
        current = (current + 1) % slides.length;
        const next = slides[current];
        next.classList.remove('exit');
        next.classList.add('active');
        slides.forEach((s,i)=>{
            s.style.color = i === current ? 'orange' : '';
        });
    }, 3000);
}

function setCurrentDate() {
    const dateEl = document.getElementById('current-date');
    if (!dateEl) return;

    const now = new Date();
    const options = { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' };
    dateEl.textContent = now.toLocaleDateString(undefined, options);
}

// initialize hero slider and date on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    initHeroSlider();
    setCurrentDate();
    
    // Ensure other sections are visible when dashboard is active on page load
    const activeSection = document.querySelector('.content .section.active');
    if (activeSection && activeSection.id === 'dashboard') {
        const otherSections = document.querySelectorAll('.services, .features, .contact');
        otherSections.forEach(section => {
            section.style.display = 'block';
        });
    }
});

// Function to switch sections from navbar clicks
function switchSection(sectionId) {
    const sections = document.querySelectorAll('.content .section');
    sections.forEach(sec => {
        if (sec.id === sectionId) {
            sec.classList.add('active');
        } else {
            sec.classList.remove('active');
        }
    });

    if (sectionId === 'request') {
        initRideRequest();
    }

    // Update sidebar active state if sidebar exists
    const sidebarItems = document.querySelectorAll('.sidebar-menu li[data-section]');
    sidebarItems.forEach(item => {
        if (item.getAttribute('data-section') === sectionId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Show/hide other content sections based on whether dashboard is active
    const otherSections = document.querySelectorAll('.services, .features, .contact');
    if (sectionId === 'dashboard') {
        // Show all other sections when dashboard is active
        otherSections.forEach(section => {
            section.style.display = 'block';
        });
    } else {
        // Hide all other sections when any other section is active
        otherSections.forEach(section => {
            section.style.display = 'none';
        });
    }

    // Close mobile menu after selection
    navbarMenu.classList.remove('active');
    navbarToggle.classList.remove('active');
}

// Logout function
function logout() {
    alert('Logged out successfully!');
    // You can add redirect or clear session here
    switchSection('dashboard');
}

// sidebar navigation in dashboard
const sidebarItems = document.querySelectorAll('.sidebar-menu li[data-section]');
const sections = document.querySelectorAll('.content .section');

sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
        // toggle active class on sidebar items
        sidebarItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const target = item.getAttribute('data-section');
        sections.forEach(sec => {
            if (sec.id === target) {
                sec.classList.add('active');
            } else {
                sec.classList.remove('active');
            }
        });
    });
});

// simple form submissions placeholders
const profileForm = document.querySelector('.profile-form');
if (profileForm) {
    profileForm.addEventListener('submit', e => {
        e.preventDefault();
        alert('Profile updated!');
    });
}

const settingsForm = document.querySelector('.settings-form');
if (settingsForm) {
    settingsForm.addEventListener('submit', e => {
        e.preventDefault();
        alert('Settings saved!');
    });
}

// Add icons to service cards
function addServiceIcons() {
    const serviceCards = document.querySelectorAll('.service-card');
    
    const icons = {
        'Airport Transfers': `<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`,
        'City Rides': `<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>`,
        'Business Travel': `<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M20 7h-4V5l-2-2h-4L8 5v2H4c-1.1 0-2 .9-2 2v5c0 .75.4 1.38 1 1.73V19c0 1.11.89 2 2 2h14c1.11 0 2-.89 2-2v-3.27c.59-.36 1-.98 1-1.73V9c0-1.1-.9-2-2-2zM10 5h4v2h-4V5zM4 9h16v5h-5v-3H9v3H4V9zm9 6h-2v1h-2v-1H9v-1h2v1zm4 4H7v-1h1v-1h8v1h1v1z"/></svg>`,
        'Tours Travel': `<svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 1.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-1.1L3 19V6.5l6-1.1 6 1.1V19zm3-14.5V17l-5-.9V5.1l5-.9z"/></svg>`
    };
    
    serviceCards.forEach(card => {
        const title = card.querySelector('h3').textContent.trim();
        const iconDiv = card.querySelector('.service-icon');
        if (iconDiv && icons[title]) {
            iconDiv.innerHTML = icons[title];
        }
    });
}

// Call the function when the page loads
document.addEventListener('DOMContentLoaded', addServiceIcons);

// Footer toggle functionality for small screens
document.addEventListener('DOMContentLoaded', () => {
    const footerToggles = document.querySelectorAll('.footer-toggle');
    footerToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const content = toggle.nextElementSibling;
            content.classList.toggle('active');
        });
    });
});

/* --------------------------------------------------------------------------
 * Google Maps Places + Directions (professional ride request)
 * -------------------------------------------------------------------------- */

const DEFAULT_CENTER = { lat: 0.3476, lng: 32.5825 }; // Kampala

let map;
let directionsService;
let directionsRenderer;
let pickupMarker;
let dropoffMarker;

function formatUGX(amount) {
    if (Number.isNaN(amount) || amount === null) return 'UGX 0';
    return new Intl.NumberFormat('en-UG', {
        style: 'currency',
        currency: 'UGX',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

function estimateFare(distanceMeters, carType) {
    const distanceKm = distanceMeters / 1000;
    const baseFare = 3000;
    const perKm = 1800;
    let multiplier = 1;

    if (carType === 'premium') multiplier = 1.4;
    if (carType === 'suv') multiplier = 1.75;

    return Math.round((baseFare + perKm * distanceKm) * multiplier);
}

function updateRouteAndFare(origin, destination) {
    if (!origin || !destination || !directionsService || !directionsRenderer) return;

    directionsService.route(
        {
            origin,
            destination,
            travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
            if (status !== 'OK' || !result) {
                console.warn('Directions request failed:', status);
                return;
            }

            directionsRenderer.setDirections(result);

            const leg = result.routes[0].legs[0];
            const distanceMeters = leg.distance.value;
            const carType = document.getElementById('car-type')?.value || 'standard';
            const fare = estimateFare(distanceMeters, carType);

            const fareEl = document.getElementById('fare-amount');
            if (fareEl) {
                fareEl.textContent = formatUGX(fare);
            }

            // Update markers
            const startLoc = leg.start_location;
            const endLoc = leg.end_location;

            if (pickupMarker) pickupMarker.setPosition(startLoc);
            else {
                pickupMarker = new google.maps.Marker({
                    position: startLoc,
                    map,
                    label: 'A',
                });
            }

            if (dropoffMarker) dropoffMarker.setPosition(endLoc);
            else {
                dropoffMarker = new google.maps.Marker({
                    position: endLoc,
                    map,
                    label: 'B',
                });
            }

            map.fitBounds(result.routes[0].bounds, { padding: 60 });
        }
    );
}

let rideRequestInitialized = false;

function initRideRequest() {
    if (rideRequestInitialized) return;

    if (!window.google || !google.maps) {
        console.error('Google Maps API not loaded. Make sure the API key is valid and the script is included.');
        return;
    }

    const mapEl = document.getElementById('map');
    const pickupInput = document.getElementById('pickup-location');
    const dropoffInput = document.getElementById('dropoff-location');
    const rideForm = document.getElementById('ride-form');

    if (!mapEl || !pickupInput || !dropoffInput || !rideForm) {
        console.warn('Ride request elements missing. Skipping map initialization.');
        return;
    }

    map = new google.maps.Map(mapEl, {
        center: DEFAULT_CENTER,
        zoom: 12,
        disableDefaultUI: true,
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#3c8dbc', strokeWeight: 6 },
    });

    const options = {
        componentRestrictions: { country: 'ug' },
        fields: ['place_id', 'geometry', 'formatted_address', 'name'],
        strictBounds: false,
    };

    const pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, options);
    const dropoffAutocomplete = new google.maps.places.Autocomplete(dropoffInput, options);

    let origin = null;
    let destination = null;

    function tryUpdateRoute() {
        if (!origin || !destination) return;
        updateRouteAndFare(origin, destination);
    }

    pickupAutocomplete.addListener('place_changed', () => {
        const place = pickupAutocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;
        origin = place.geometry.location;
        tryUpdateRoute();
    });

    dropoffAutocomplete.addListener('place_changed', () => {
        const place = dropoffAutocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;
        destination = place.geometry.location;
        tryUpdateRoute();
    });

    rideForm.addEventListener('submit', e => {
        e.preventDefault();

        if (!origin || !destination) {
            alert('Please select both pickup and dropoff locations from the suggestions.');
            return;
        }

        const pickupText = pickupInput.value.trim();
        const dropoffText = dropoffInput.value.trim();
        const dateText = document.getElementById('ride-date')?.value || '';
        const carType = document.getElementById('car-type')?.value || '';
        const paymentMethod = document.getElementById('payment-method')?.value || '';
        const fareText = document.getElementById('fare-amount')?.textContent || 'UGX 0';

        alert(`Ride requested from:\n• ${pickupText}\n• ${dropoffText}\n\nEstimated fare: ${fareText}`);

        // Only send server-side email notifications when launched from the live telekataxi domains
        if (['telekataxi.com', 'www.telekataxi.com'].includes(location.hostname)) {
            fetch('/api/ride-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pickup: pickupText,
                    dropoff: dropoffText,
                    date: dateText,
                    carType,
                    payment: paymentMethod,
                }),
            })
                .then(res => res.json())
                .then(data => {
                    if (!data.ok) {
                        console.warn('Ride notification failed:', data);
                    }
                })
                .catch(err => {
                    console.warn('Ride notification error:', err);
                });
        }

        rideForm.reset();
        origin = null;
        destination = null;
        directionsRenderer.set('directions', null);
        if (pickupMarker) pickupMarker.setMap(null);
        if (dropoffMarker) dropoffMarker.setMap(null);
        pickupMarker = null;
        dropoffMarker = null;
        document.getElementById('fare-amount').textContent = 'UGX 0';
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(12);
    });

    rideRequestInitialized = true;
}
