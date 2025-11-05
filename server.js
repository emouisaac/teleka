const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from project root (index.html, dindex.html, assets)
app.use(express.static(__dirname));

// In-memory data stores
let customers = [];
let drivers = [];
let pendingDrivers = [];
let notifications = [];
let fareSettings = { baseFare: 2.0, commission: 10 };

// Customer registration
app.post('/api/register/customer', (req, res) => {
  const { name, email, password, phone } = req.body;
  if (customers.find(u => u.email === email)) {
    return res.status(400).json({ message: 'User already exists.' });
  }
  customers.push({ name, email, password, phone });
  res.json({ message: 'Registration successful.' });
});

// Driver registration
app.post('/api/register/driver', (req, res) => {
  const { name, email, password, phone, license, nationalId } = req.body;
  if (pendingDrivers.find(d => d.email === email)) {
    return res.status(400).json({ message: 'Driver already pending.' });
  }
  pendingDrivers.push({ name, email, password, phone, license, nationalId, approved: false });
  notifications.push({ message: `New driver registration: ${name}`, timestamp: new Date().toLocaleString() });
  res.json({ message: 'Driver registration submitted.' });
});

// Login
app.post('/api/login', (req, res) => {
  const { role, email, password } = req.body;
  if (role === 'admin') {
    if (email === 'admin@cablink.com' && password === 'Admin@123') {
      return res.json({ message: 'Welcome Admin' });
    }
    return res.status(401).json({ message: 'Invalid admin credentials.' });
  }
  if (role === 'customer') {
    const user = customers.find(u => u.email === email && u.password === password);
    if (user) return res.json({ message: `Welcome ${user.name}` });
    return res.status(401).json({ message: 'Invalid customer credentials.' });
  }
  if (role === 'driver') {
    const driver = drivers.find(d => d.email === email && d.password === password);
    if (driver && driver.approved) return res.json({ message: 'Driver logged in' });
    if (driver && !driver.approved) return res.status(403).json({ message: 'Pending approval.' });
    return res.status(401).json({ message: 'Invalid driver credentials.' });
  }
  res.status(400).json({ message: 'Invalid role.' });
});

// Admin: get pending drivers
app.get('/api/pending-drivers', (req, res) => {
  res.json(pendingDrivers);
});

// Admin: approve driver
app.post('/api/approve-driver', (req, res) => {
  const { index } = req.body;
  const driver = pendingDrivers[index];
  if (!driver) return res.status(404).json({ message: 'Driver not found.' });
  driver.approved = true;
  drivers.push(driver);
  pendingDrivers.splice(index, 1);
  notifications.push({ message: `Driver ${driver.name} approved`, timestamp: new Date().toLocaleString() });
  res.json({ message: 'Driver approved.' });
});

// Admin: reject driver
app.post('/api/reject-driver', (req, res) => {
  const { index } = req.body;
  const driver = pendingDrivers[index];
  if (!driver) return res.status(404).json({ message: 'Driver not found.' });
  pendingDrivers.splice(index, 1);
  notifications.push({ message: `Driver ${driver.name} rejected`, timestamp: new Date().toLocaleString() });
  res.json({ message: 'Driver rejected.' });
});

// Notifications
app.get('/api/notifications', (req, res) => {
  res.json(notifications.slice(-5).reverse());
});

// Fare & commission
app.get('/api/fare-settings', (req, res) => {
  res.json(fareSettings);
});
app.post('/api/fare-settings', (req, res) => {
  const { baseFare, commission } = req.body;
  fareSettings.baseFare = baseFare;
  fareSettings.commission = commission;
  res.json({ message: 'Settings updated.' });
});

// Fallback for other routes (optional)
// Use a pathless middleware to avoid path-to-regexp parsing issues with '*' or '/*'
app.use((req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).send('Not Found');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
