let map; // Global map variable to allow route rendering

// Vehicle options sample data
const vehicleOptions = [
  { type: "Boda", baseFare: 0.5, perKm: 0.2 },
  { type: "Uber A", baseFare: 2.0, perKm: 1.0 },
  { type: "Uber L", baseFare: 3.0, perKm: 1.5 },
  { type: "Uber X", baseFare: 4.0, perKm: 2.0 }
];

function initMap() {
  const centerLocation = { lat: 0.3476, lng: 32.5825 }; // Kampala

  map = new google.maps.Map(document.getElementById("map"), {
    center: centerLocation,
    zoom: 13,
  });

  new google.maps.Marker({
    position: centerLocation,
    map: map,
    title: "You are here",
  });

  populateVehicleOptions();
  updateTripHistory();
}

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

function drawRoute(destination) {
  const directionsService = new google.maps.DirectionsService();
  const directionsRenderer = new google.maps.DirectionsRenderer();

  directionsRenderer.setMap(map);

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

function initMap() {
  const center = { lat: 0.3476, lng: 32.5825 };

  const map = new google.maps.Map(document.getElementById("driver-map"), {
    zoom: 13,
    center,
  });

  new google.maps.Marker({
    position: center,
    map,
    title: "Your Position",
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("toggle-online");
  let isOnline = false;

  toggleBtn.addEventListener("click", () => {
    isOnline = !isOnline;
    toggleBtn.textContent = isOnline ? "Go Offline" : "Go Online";
    toggleBtn.style.backgroundColor = isOnline ? "#dc3545" : "#28a745";
  });

  // Display mock values
  document.getElementById("earnings").textContent = "$125.00";
  document.getElementById("wallet").textContent = "$25.00";

  // (Optional) Load driver data from localStorage if needed
});





  // Initial marker
  customerMarker = new google.maps.Marker({
    position: kampala,
    map: customerMap,
    title: "Starting point"
  });

  // Driver map still if needed
  const driverMapEl = document.getElementById("driver-map");
  if (driverMapEl) {
    const driverMap = new google.maps.Map(driverMapEl, {
      center: kampala,
      zoom: 12
    });
    new google.maps.Marker({ position: kampala, map: driverMap });
  }





let customerMap;
let customerMarker;

function initMap() {
  const kampala = { lat: 0.3476, lng: 32.5825 };
  customerMap = new google.maps.Map(document.getElementById("map"), {
    center: kampala,
    zoom: 13,
  });

  customerMarker = new google.maps.Marker({
    position: kampala,
    map: customerMap,
    title: "Starting Point"
  });

  // Optional: Setup driver map too
  const driverMapEl = document.getElementById("driver-map");
  if (driverMapEl) {
    const driverMap = new google.maps.Map(driverMapEl, {
      center: kampala,
      zoom: 12
    });
    new google.maps.Marker({ position: kampala, map: driverMap });
  }
}

document.getElementById("destination").addEventListener("change", () => {
  const destination = document.getElementById("destination").value;
  if (!destination || !customerMap) return;

  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: destination }, (results, status) => {
    if (status === "OK" && results[0]) {
      const location = results[0].geometry.location;
      customerMap.setCenter(location);
      customerMap.setZoom(15);

      if (customerMarker) customerMarker.setMap(null); // remove old marker
      customerMarker = new google.maps.Marker({
        position: location,
        map: customerMap,
        title: destination
      });
    } else {
      alert("Could not locate destination.");
    }
  });
});






  // Driver map (already working well)
  const driverMapElement = document.getElementById("driver-map");
  if (driverMapElement) {
    const driverMap = new google.maps.Map(driverMapElement, {
      center: kampala,
      zoom: 13,
    });

    new google.maps.Marker({
      position: kampala,
      map: driverMap,
      title: "Driver Start Point",
    });
  }







// Toggle login modal when ☰ menu icon is clicked
document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  
  // Close login modal
  document.getElementById("login-modal").style.display = "block";

  // Show dashboard
  document.getElementById("customer-dashboard").style.display = "block";

  // Hide ☰ nav bar icon
  document.getElementById("menu").style.display = "none";

  // Show logout button
  showLogoutButton();

  alert(`Logged in as: ${email}`);
});

// Toggle login modal when ☰ menu icon is clicked
document.getElementById("menu").addEventListener("click", () => {
  const modal = document.getElementById("login-modal");
  modal.style.display = modal.style.display === "none" ? "block" : "none";
});





// LOGOUT BUTTON FUNCTIONALITY
document.getElementById("logout-btn").addEventListener("click", () => {
  // Show the menu icon again
  document.getElementById("menu").style.display = "inline-block";

  // Show the login modal again
  document.getElementById("login-modal").style.display = "none";

  // Hide the logout button
  document.getElementById("logout-btn").style.display = "none";

  // DO NOT hide any dashboard. Leave the dashboard as is.
});


// Ride Types and Prices
const pricing = {
  "Boda": 1500,
  "Uber A": 3000,
  "Uber B": 5000,
  "Uber L": 8000
};

// Handle ride selection
document.querySelectorAll('.ride-option').forEach(option => {
  option.addEventListener('click', () => {
    const type = option.dataset.type;
    const destination = document.getElementById("destination").value;

    if (!destination) {
      alert("Please enter your destination.");
      return;
    }

    const fare = pricing[type];
    document.getElementById("ride-info").textContent = 
      `You selected ${type}. Estimated fare to "${destination}" is UGX ${fare}`;
    
    document.getElementById("ride-summary").style.display = "block";
  });
});

// Confirm ride
document.getElementById("confirm-ride").addEventListener("click", () => {
  alert("Your ride has been requested and will be assigned to a nearby driver.");
  document.getElementById("ride-summary").style.display = "none";

  // Optional: update trip history
  const tripList = document.getElementById("trip-list");
  const li = document.createElement("li");
  li.textContent = "Trip requested at " + new Date().toLocaleTimeString();
  tripList.appendChild(li);
});



// Global State
// =====================
let currentRole = "";

// =====================
// Menu opens login modal
// =====================
document.getElementById("menu").addEventListener("click", () => {
  document.getElementById("login-modal").style.display = "block";
  document.getElementById("login-form").style.display = "none";
  document.getElementById("register-form").style.display = "none";
});

// =====================
// Toggle between Login and Register
// =====================
document.getElementById("show-register").addEventListener("click", () => {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("register-form").style.display = "block";
});

document.getElementById("show-login").addEventListener("click", () => {
  document.getElementById("register-form").style.display = "none";
  document.getElementById("login-form").style.display = "block";
});

// =====================
// Role Selection Buttons
// =====================
document.getElementById("customer-login-btn").addEventListener("click", () => {
  currentRole = "customer";
  document.getElementById("login-form").style.display = "block";
});

document.getElementById("driver-login-btn").addEventListener("click", () => {
  currentRole = "driver";
  document.getElementById("login-form").style.display = "block";
});

document.getElementById("admin-login-btn").addEventListener("click", () => {
  currentRole = "admin";
  document.getElementById("login-form").style.display = "block";
});

// =====================
// Registration Logic
// =====================
document.getElementById("register-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("register-name").value;
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;

  // Save customer to localStorage
  const users = JSON.parse(localStorage.getItem("customers") || "[]");
  users.push({ name, email, password });
  localStorage.setItem("customers", JSON.stringify(users));

  alert("Registration successful! Please log in.");
  document.getElementById("register-form").style.display = "none";
  document.getElementById("login-form").style.display = "block";
});

// =====================
// Login Logic
// =====================
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
  } else if (currentRole === "customer") {
    const users = JSON.parse(localStorage.getItem("customers") || "[]");
    const match = users.find(u => u.email === email && u.password === password);
    if (match) {
      alert(`Welcome ${match.name}`);
      showDashboard("customer-dashboard");
    } else {
      alert("Invalid customer credentials.");
    }
  } else if (currentRole === "driver") {
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

// =====================
// Show Correct Dashboard
// =====================
function showDashboard(id) {
  document.getElementById("login-modal").style.display = "none";
  document.getElementById("logout-btn").style.display = "inline-block";
  document.getElementById("menu").style.display = "none";

  // Hide all dashboards
  document.getElementById("customer-dashboard").style.display = "none";
  document.getElementById("driver-dashboard").style.display = "none";
  document.getElementById("admin-dashboard").style.display = "none";

  // Show the selected one
  document.getElementById(id).style.display = "block";
}

// =====================
// Logout
// =====================
document.getElementById("logout-btn").addEventListener("click", () => {
  document.getElementById("login-modal").style.display = "block";
  document.getElementById("logout-btn").style.display = "none";
  document.getElementById("menu").style.display = "inline-block";

  
});









// DRIVER REGISTRATION
document.getElementById("driver-register-form")?.addEventListener("submit", (e) => {
  e.preventDefault();

  const newDriver = {
    name: document.getElementById("d-name").value,
    email: document.getElementById("d-email").value,
    password: document.getElementById("d-password").value,
    phone: document.getElementById("d-phone").value,
    license: document.getElementById("d-license").value,
    nationalID: document.getElementById("d-id").value,
    approved: false
  };

  const drivers = JSON.parse(localStorage.getItem("drivers") || "[]");
  drivers.push(newDriver);
  localStorage.setItem("drivers", JSON.stringify(drivers));

  alert("Registration submitted. Awaiting admin approval.");
  document.getElementById("driver-register").style.display = "none";
});

// LOAD PENDING DRIVERS FOR ADMIN
function loadPendingDrivers() {
  const drivers = JSON.parse(localStorage.getItem("drivers") || "[]");
  const pendingList = document.getElementById("pending-drivers");
  if (!pendingList) return;

  pendingList.innerHTML = "";

  drivers.forEach((driver, index) => {
    if (!driver.approved) {
      const li = document.createElement("li");
      li.textContent = `${driver.name} (${driver.email})`;
      const approveBtn = document.createElement("button");
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", () => {
        driver.approved = true;
        drivers[index] = driver;
        localStorage.setItem("drivers", JSON.stringify(drivers));
        alert(`Approved ${driver.name}`);
        loadPendingDrivers();
      });
      li.appendChild(approveBtn);
      pendingList.appendChild(li);
    }
  });
}

// Check for admin login success
function showDashboard(id) {
  document.getElementById("login-modal").style.display = "none";
  document.getElementById("logout-btn").style.display = "inline-block";
  document.getElementById("menu").style.display = "none";

  document.getElementById("customer-dashboard").style.display = "none";
  document.getElementById("driver-dashboard").style.display = "none";
  document.getElementById("admin-dashboard").style.display = "none";

  if (id === "admin-dashboard") loadPendingDrivers();

  if (id) document.getElementById(id).style.display = "block";
}



// Show the driver registration form
document.getElementById("open-driver-register").addEventListener("click", () => {
  document.getElementById("driver-register").style.display = "block";
  document.getElementById("login-modal").style.display = "none";
});


function loadPendingDrivers() {
  const drivers = JSON.parse(localStorage.getItem("drivers") || "[]");
  const pendingList = document.getElementById("pending-drivers");
  if (!pendingList) return;

  pendingList.innerHTML = "";

  drivers.forEach((driver, index) => {
    if (!driver.approved) {
      const li = document.createElement("li");
      li.textContent = `${driver.name} (${driver.email})`;
      const approveBtn = document.createElement("button");
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", () => {
        driver.approved = true;
        drivers[index] = driver;
        localStorage.setItem("drivers", JSON.stringify(drivers));
        alert(`Approved ${driver.name}`);
        loadPendingDrivers();
      });
      li.appendChild(approveBtn);
      pendingList.appendChild(li);
    }
  });
}


