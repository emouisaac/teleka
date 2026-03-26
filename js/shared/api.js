const defaultHeaders = {
  Accept: "application/json"
};

async function request(url, options = {}) {
  const headers = { ...defaultHeaders, ...(options.headers || {}) };
  const requestOptions = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers
  };

  if (options.body instanceof FormData) {
    requestOptions.body = options.body;
    delete requestOptions.headers["Content-Type"];
  } else if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
    requestOptions.headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, requestOptions);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

export const api = {
  request,
  authStatus: () => request("/api/auth/status"),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  notifications: () => request("/api/auth/notifications"),
  markNotificationRead: (id) =>
    request(`/api/auth/notifications/${id}/read`, { method: "POST" }),
  publicConfig: () => request("/api/public/config"),
  autocompletePlaces: (query) =>
    request(`/api/public/places/autocomplete?q=${encodeURIComponent(query)}`),
  customerDashboard: () => request("/api/customer/dashboard"),
  customerQuote: (body) => request("/api/customer/quote", { method: "POST", body }),
  createRide: (body) => request("/api/customer/rides", { method: "POST", body }),
  customerRideMessages: (rideId) => request(`/api/customer/rides/${rideId}/messages`),
  customerSendRideMessage: (rideId, body) =>
    request(`/api/customer/rides/${rideId}/messages`, { method: "POST", body }),
  adminLogin: (body) => request("/api/auth/admin/login", { method: "POST", body }),
  adminDashboard: () => request("/api/admin/dashboard"),
  adminApproveDriver: (driverId, body) =>
    request(`/api/admin/drivers/${driverId}/approve`, { method: "POST", body }),
  adminRejectDriver: (driverId, body) =>
    request(`/api/admin/drivers/${driverId}/reject`, { method: "POST", body }),
  adminAssignRide: (rideId, body) =>
    request(`/api/admin/rides/${rideId}/assign`, { method: "POST", body }),
  adminUpdateRideStatus: (rideId, body) =>
    request(`/api/admin/rides/${rideId}/status`, { method: "POST", body }),
  adminFareSettings: (body) =>
    request("/api/admin/settings/fare", { method: "PUT", body }),
  adminDriverDocuments: (driverId) =>
    request(`/api/admin/drivers/${driverId}/documents`),
  driverRegister: (formData) =>
    request("/api/auth/driver/register", { method: "POST", body: formData }),
  driverLogin: (body) => request("/api/auth/driver/login", { method: "POST", body }),
  driverDashboard: () => request("/api/driver/dashboard"),
  driverAvailability: (body) =>
    request("/api/driver/availability", { method: "POST", body }),
  driverLocation: (body) =>
    request("/api/driver/location", { method: "POST", body }),
  driverAcceptRide: (rideId) =>
    request(`/api/driver/rides/${rideId}/accept`, { method: "POST" }),
  driverStartRide: (rideId) =>
    request(`/api/driver/rides/${rideId}/start`, { method: "POST" }),
  driverCompleteRide: (rideId, body) =>
    request(`/api/driver/rides/${rideId}/complete`, { method: "POST", body }),
  driverRideMessages: (rideId) => request(`/api/driver/rides/${rideId}/messages`),
  driverSendRideMessage: (rideId, body) =>
    request(`/api/driver/rides/${rideId}/messages`, { method: "POST", body })
};
