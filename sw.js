self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Notification', body: event.data ? String(event.data) : '' }; }
  const title = data.title || 'Teleka Notification';
  const options = Object.assign({
    body: data.body || '',
    icon: '/ims/1110.png',
    badge: '/ims/1110.png',
    data: data.data || {},
    requireInteraction: true
  }, data.options || {});

  event.waitUntil(self.registration.showNotification(title, options));
  // Also notify open clients (pages) so they can show in-page UI and play sound
  event.waitUntil((async () => {
    try{
      const all = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for(const c of all){
        try{ c.postMessage({ type: 'push', data }); }catch(e){}
      }
    }catch(e){ /* ignore */ }
  })());
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    for (let i = 0; i < windowClients.length; i++) {
      const client = windowClients[i];
      if (client.url === url && 'focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
