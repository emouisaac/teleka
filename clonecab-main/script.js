// Global variables for maps and markers
let customerMap;
let customerMarker;

// Vehicle options sample data
const vehicleOptions = [
  { type: "Boda", baseFare: 0.5, perKm: 0.2 },
  { type: "Uber A", baseFare: 2.0, perKm: 1.0 },
  { type: "Uber L", baseFare: 3.0, perKm: 1.5 },
  { type: "Uber X", baseFare: 4.0, perKm: 2.0 }
];








// Show register form when 'Register' link is clicked
document.getElementById("show-register").addEventListener("click", () => {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("register-form").style.display = "block";
});

// Show login form when 'Login' link is clicked
document.getElementById("show-login").addEventListener("click", () => {
  document.getElementById("register-form").style.display = "none";
  document.getElementById("login-form").style.display = "block";
});

// Show the driver registration form
document.getElementById("open-driver-register").addEventListener("click", () => {
  document.getElementById("driver-register").style.display = "block";  // Show the driver form
  document.getElementById("login-modal").style.display = "none";       // Hide login modal
});







// Initialize Google Maps on page load
function initMap() {
  const kampala = { lat: 0.3476, lng: 32.5825 };
  if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      // Set map center to user's current location
      map.setCenter(userLocation);

      // Add marker for user location
      new google.maps.Marker({
        position: userLocation,
        map: map,
        title: "You are here",
        icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
      });
    },
    () => {
      alert("Geolocation failed. Using default location.");
    }
  );
} else {
  alert("Geolocation is not supported by your browser.");
}






  // Customer map
  customerMap = new google.maps.Map(document.getElementById("map"), {
    center: kampala,
    zoom: 13,
  });

  customerMarker = new google.maps.Marker({
    position: kampala,
    map: customerMap,
    title: "Starting Point",
  });

  // Driver map if exists
  const driverMapEl = document.getElementById("driver-map");
  if (driverMapEl) {
    const driverMap = new google.maps.Map(driverMapEl, {
      center: kampala,
      zoom: 12,
    });
    new google.maps.Marker({ position: kampala, map: driverMap });
  }

  // Populate vehicle options UI
  populateVehicleOptions();
  // Load trip history from localStorage
  updateTripHistory();
}

// Listen for destination input changes to update map marker and center
document.getElementById("destination").addEventListener("change", () => {
  const destination = document.getElementById("destination").value;
  if (!destination || !customerMap) return;

  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: destination }, (results, status) => {
    if (status === "OK" && results[0]) {
      const location = results[0].geometry.location;
      customerMap.setCenter(location);
      customerMap.setZoom(15);

      if (customerMarker) customerMarker.setMap(null); // Remove old marker
      customerMarker = new google.maps.Marker({
        position: location,
        map: customerMap,
        title: destination,
      });
    } else {
      alert("Could not locate destination.");
    }
  });
});

// Populate the vehicle options in the UI and add click handlers
function populateVehicleOptions() {
  const container = document.getElementById("vehicle-options");
  container.innerHTML = "";

  vehicleOptions.forEach((opt) => {
    const div = document.createElement("div");
    div.className = "vehicle-choice";
    div.textContent = opt.type;
    div.onclick = () => {
      // Clear previous selection
      document.querySelectorAll(".vehicle-choice").forEach(el => el.classList.remove("selected"));
      div.classList.add("selected");
      localStorage.setItem("selectedVehicle", JSON.stringify(opt));
      calculateFare(document.getElementById("destination").value || "Nakasero, Kampala");
    };
    container.appendChild(div);
  });
}

// Calculate fare based on selected vehicle and destination distance
function calculateFare(destination) {
  const origin = "Kampala";
  const service = new google.maps.DistanceMatrixService();

  service.getDistanceMatrix(
    {
      origins: [origin],
      destinations: [destination],
      travelMode: "DRIVING",
      unitSystem: google.maps.UnitSystem.METRIC,
    },
    (response, status) => {
      if (status !== "OK") {
        alert("Distance request failed: " + status);
      } else {
        const element = response.rows[0].elements[0];
        if (element.status === "ZERO_RESULTS") {
          document.getElementById("fare-display").innerText = "No route found to this destination.";
          return;
        }
        const distanceText = element.distance.text;
        const distanceValue = element.distance.value / 1000; // in km

        const selectedVehicle = JSON.parse(localStorage.getItem("selectedVehicle"));
        if (!selectedVehicle) {
          document.getElementById("fare-display").innerText = "Please select a vehicle.";
          return;
        }

        const fare = selectedVehicle.baseFare + distanceValue * selectedVehicle.perKm;

        document.getElementById("fare-display").innerText =
          `Distance: ${distanceText}, Estimated Fare: $${fare.toFixed(2)}`;
      }
    }
  );
}

// Draw route on the map between origin and destination
function drawRoute(destination) {
  const directionsService = new google.maps.DirectionsService();
  const directionsRenderer = new google.maps.DirectionsRenderer();

  directionsRenderer.setMap(customerMap);

  directionsService.route(
    {
      origin: "Kampala",
      destination: destination,
      travelMode: google.maps.TravelMode.DRIVING,
    },
    (response, status) => {
      if (status === "OK") {
        directionsRenderer.setDirections(response);
      } else {
        alert("Could not display directions: " + status);
      }
    }
  );
}

// Update trip history list from localStorage
function updateTripHistory() {
  const list = document.getElementById("trip-list");
  const history = JSON.parse(localStorage.getItem("tripHistory") || "[]");

  list.innerHTML = "";

  history.forEach((trip) => {
    const li = document.createElement("li");
    li.textContent = `${trip.type} to ${trip.destination} on ${trip.date}`;
    list.appendChild(li);
  });
}

// Confirm ride button click handler
document.getElementById("confirm-ride").addEventListener("click", () => {
  const selected = JSON.parse(localStorage.getItem("selectedVehicle"));
  const destination = document.getElementById("destination").value.trim();

  if (!selected || !destination) {
    alert("Please enter a destination and select a vehicle.");
    return;
  }

  const trip = {
    type: selected.type,
    destination,
    date: new Date().toLocaleString(),
  };

  // Save to localStorage trip history
  const history = JSON.parse(localStorage.getItem("tripHistory") || "[]");
  history.unshift(trip); // Add newest first
  localStorage.setItem("tripHistory", JSON.stringify(history));

  // Update UI & map
  document.getElementById("confirm-ride").textContent = "Connecting...";

  setTimeout(() => {
    document.getElementById("confirm-ride").textContent = `${trip.type} Assigned!`;
    alert(`Your driver is on the way to ${destination} 🚗`);
    drawRoute(destination);
    updateTripHistory();
  }, 2000);
});

// Login and logout management and UI toggles (your existing logic)
// Add your login/logout and other event listeners here (as you shared)





// Navbar ☰ icon opens the login modal
document.getElementById("menu").addEventListener("click", () => {
  document.getElementById("login-modal").style.display = "block";
  document.getElementById("login-form").style.display = "none";
});

let currentRole = ""; // Track selected role








// Role selection
document.getElementById("customer-login-btn").addEventListener("click", () => {
  currentRole = "customer";
  document.getElementById("login-form").style.display = "block";
  document.getElementById("register-form").style.display = "none";
  document.getElementById("show-register").style.display = "block";
  document.getElementById("become-driver-link").style.display = "none";
});

document.getElementById("driver-login-btn").addEventListener("click", () => {
  currentRole = "driver";
  document.getElementById("login-form").style.display = "block";
  document.getElementById("register-form").style.display = "none";
  document.getElementById("show-register").style.display = "none";
  document.getElementById("become-driver-link").style.display = "block"; // Show Become Driver link
});


document.getElementById("admin-login-btn").addEventListener("click", () => {
  currentRole = "admin";
  document.getElementById("login-form").style.display = "block";
  document.getElementById("register-form").style.display = "none";
  document.getElementById("show-register").style.display = "none";
  document.getElementById("become-driver-link").style.display = "none";
});

document.getElementById("become-driver-link").addEventListener("click", () => {
  document.getElementById("login-modal").style.display = "none";
  document.getElementById("driver-register").style.display = "block";
});


// Register link click

// Login link click (from register form)
document.getElementById("show-login").addEventListener("click", () => {
  document.getElementById("register-form").style.display = "none";
  document.getElementById("login-form").style.display = "block";
});
//ooooooooooooooooooooooooooooooooooooooooooooooooooooooo


document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  if (currentRole === "admin") {
    if (email === "admin@uber.com" && password === "Admin@123") {
      alert("Welcome Admin");
      showDashboard("admin-dashboard");
    } else {
      alert("Invalid admin credentials. Redirecting to customer dashboard...");
      showDashboard("customer-dashboard");
    }

  } else if (currentRole === "customer") {
    const users = JSON.parse(localStorage.getItem("customers") || "[]");
    const match = users.find(u => u.email === email && u.password === password);

    if (match) {
      alert(`Welcome ${match.name}`);
      showDashboard("customer-dashboard");
    } else {
      alert("Invalid customer credentials. Redirecting to customer dashboard...");
      showDashboard("customer-dashboard");
    }

  } else if (currentRole === "driver") {
    const drivers = JSON.parse(localStorage.getItem("drivers") || "[]");
    const match = drivers.find(d => d.email === email && d.password === password);

    if (match && match.approved) {
      alert(`Welcome Driver ${match.name}`);
      showDashboard("driver-dashboard");
    } else if (match && !match.approved) {
      alert("Your account is pending approval.");
    } else {
      alert("Invalid driver credentials. Redirecting to customer dashboard...");
      showDashboard("customer-dashboard");
    }
  }
});








document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  if (currentRole === "admin") {
    if (email === "admin@uber.com" && password === "Admin@123") {
      alert("Admin logged in");
      showDashboard("admin-dashboard");
    } else {
      alert("Invalid admin credentials.");
    }
  }

  else if (currentRole === "customer") {
    const users = JSON.parse(localStorage.getItem("customers") || "[]");
    const match = users.find(u => u.email === email && u.password === password);
    if (match) {
      alert(`Welcome ${match.name}`);
      showDashboard("customer-dashboard");
    } else {
      alert("Invalid customer credentials.");
    }
  }

  else if (currentRole === "driver") {
    const drivers = JSON.parse(localStorage.getItem("drivers") || "[]");
    const found = drivers.find(d => d.email === email && d.password === password);

    if (found && found.approved) {
      alert("Driver logged in");
      showDashboard("driver-dashboard");
    } else if (found && !found.approved) {
      alert("Your account is pending approval.");
    } else {
      alert("Invalid driver credentials.");
    }
  }
});




function showDashboard(id) {
  // Hide login UI
  document.getElementById("login-modal").style.display = "none";
  document.getElementById("menu").style.display = "none";
  document.getElementById("logout-btn").style.display = "inline-block";

  // Hide all dashboards
  document.getElementById("customer-dashboard").style.display = "none";
  document.getElementById("driver-dashboard").style.display = "none";
  document.getElementById("admin-dashboard").style.display = "block";

  // Load extras if admin
  if (id === "admin-dashboard") loadPendingDrivers();

  // Show the correct dashboard
  document.getElementById(id).style.display = "block";
}



document.getElementById("admin-login-btn").addEventListener("click", () => {
  currentRole = "admin";
  document.getElementById("login-form").style.display = "block";
  document.getElementById("register-form").style.display = "none";
});

