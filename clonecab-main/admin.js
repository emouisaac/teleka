// Load pending drivers, notifications, fare & commission, currency from localStorage or default
document.addEventListener("DOMContentLoaded", () => {
  loadPendingDrivers();
  loadNotifications();
  loadFareCommission();
  loadCurrency();

  // Handle fare & commission form submit
  document.getElementById("fare-commission-form").addEventListener("submit", (e) => {
    e.preventDefault();
    updateFareCommission();
  });

  // Handle currency selection
  document.getElementById("currency-select").addEventListener("change", (e) => {
    localStorage.setItem("currency", e.target.value);
    alert(`Currency set to ${e.target.options[e.target.selectedIndex].text}`);
  });
});

function loadPendingDrivers() {
  const list = document.getElementById("pending-drivers-list");
  const pendingDrivers = JSON.parse(localStorage.getItem("pendingDrivers") || "[]");

  list.innerHTML = "";

  if (pendingDrivers.length === 0) {
    list.innerHTML = "<li>No pending driver registrations.</li>";
    return;
  }

  pendingDrivers.forEach((driver, index) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "driver-info";
    info.innerHTML = `
      <strong>${driver.fullName}</strong> — ${driver.email} — ${driver.phone}<br/>
      License: ${driver.license} | National ID: ${driver.nationalId}
    `;

    const approveBtn = document.createElement("button");
    approveBtn.className = "approve-btn";
    approveBtn.textContent = "Approve";
    approveBtn.onclick = () => approveDriver(index);

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "reject-btn";
    rejectBtn.textContent = "Reject";
    rejectBtn.onclick = () => rejectDriver(index);

    li.appendChild(info);
    li.appendChild(approveBtn);
    li.appendChild(rejectBtn);

    list.appendChild(li);
  });
}

function approveDriver(index) {
  let pendingDrivers = JSON.parse(localStorage.getItem("pendingDrivers") || "[]");
  let approvedDrivers = JSON.parse(localStorage.getItem("approvedDrivers") || "[]");

  let driver = pendingDrivers.splice(index, 1)[0];
  driver.approved = true;
  approvedDrivers.push(driver);

  localStorage.setItem("pendingDrivers", JSON.stringify(pendingDrivers));
  localStorage.setItem("approvedDrivers", JSON.stringify(approvedDrivers));

  addNotification(`Driver approved: ${driver.fullName}`);
  loadPendingDrivers();
  loadNotifications();
}

function rejectDriver(index) {
  let pendingDrivers = JSON.parse(localStorage.getItem("pendingDrivers") || "[]");
  let driver = pendingDrivers.splice(index, 1)[0];
  localStorage.setItem("pendingDrivers", JSON.stringify(pendingDrivers));

  addNotification(`Driver rejected: ${driver.fullName}`);
  loadPendingDrivers();
  loadNotifications();
}

function loadNotifications() {
  const container = document.getElementById("notifications");
  let notifications = JSON.parse(localStorage.getItem("notifications") || "[]");

  if (notifications.length === 0) {
    container.textContent = "No new notifications";
    return;
  }

  container.innerHTML = notifications.map(n => `<div>${n}</div>`).join("");
}

function addNotification(message) {
  let notifications = JSON.parse(localStorage.getItem("notifications") || "[]");
  notifications.unshift(`${new Date().toLocaleString()}: ${message}`);

  // Keep max 20 notifications
  if (notifications.length > 20) notifications.pop();

  localStorage.setItem("notifications", JSON.stringify(notifications));
}

function loadFareCommission() {
  const fareInput = document.getElementById("fare-input");
  const commissionInput = document.getElementById("commission-input");

  let fare = localStorage.getItem("fare");
  let commission = localStorage.getItem("commission");

  fareInput.value = fare !== null ? fare : 2.0;
  commissionInput.value = commission !== null ? commission : 10.0;
}

function updateFareCommission() {
  const fare = parseFloat(document.getElementById("fare-input").value);
  const commission = parseFloat(document.getElementById("commission-input").value);

  if (isNaN(fare) || fare < 0) {
    alert("Please enter a valid fare.");
    return;
  }
  if (isNaN(commission) || commission < 0 || commission > 100) {
    alert("Please enter a valid commission between 0 and 100.");
    return;
  }

  localStorage.setItem("fare", fare.toFixed(2));
  localStorage.setItem("commission", commission.toFixed(1));
  alert("Fare and commission updated!");
}

function loadCurrency() {
  const currencySelect = document.getElementById("currency-select");
  const savedCurrency = localStorage.getItem("currency");

  if (savedCurrency) {
    currencySelect.value = savedCurrency;
  } else {
    currencySelect.value = "usd"; // default
  }
}
