self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { body: event.data ? String(event.data) : '' }; }
  const title = payload.title || 'Teleka Notification';
  const body = payload.body || 'You have a new notification';
  const data = payload.data || {};
  const options = {
    body,
    icon: data.icon || '/ims/1110.png',
    badge: data.badge || '/ims/1110.png',
    tag: data.tag || 'teleka-notification',
    renotify: true,
    requireInteraction: true,
    vibrate: data.vibrate || [300,100,300],
    data: Object.assign({ url: '/admin/alert.html', playSound: true, booking: data.booking || null }, data),
    actions: data.actions || [ { action: 'open', title: 'Open Dashboard' }, { action: 'ack', title: 'Acknowledge' } ]
  };

  // Show notification and also notify any open clients so they can play sound immediately
  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, options);
    } catch (e) { /* ignore showNotification errors */ }

    try {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        // Prefer visible/focused clients
        try {
          client.postMessage({ type: 'play-sound', booking: options.data && options.data.booking ? options.data.booking : null });
        } catch (e) { /* ignore postMessage failures */ }
      }
    } catch (e) {
      // ignore client messaging errors
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/admin/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    for (const client of clientList) {
      if (client.url && (client.url.includes(urlToOpen) || client.url.includes('/admin'))) {
        client.focus();
        try { client.postMessage({ type: 'play-sound', booking: event.notification.data && event.notification.data.booking }); } catch(e){}
        return;
      }
    }
    return clients.openWindow(urlToOpen).then(win => {
      setTimeout(()=>{ try { if (win) win.postMessage({ type: 'play-sound', booking: event.notification.data && event.notification.data.booking }); } catch(e){} }, 500);
    });
  }));
});

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
