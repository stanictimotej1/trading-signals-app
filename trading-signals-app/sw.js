// Service Worker za Trading Signals PWA
const CACHE_NAME = 'trading-signals-v1';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png'];

// Install - predpomni datoteke
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// Activate - počisti star cache
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - najprej cache, potem network
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/') || event.request.url.includes('/webhook')) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// Push Notification
self.addEventListener('push', event => {
  let data = { title: '📈 Nov Signal', body: 'Preveri aplikacijo!', action: 'BUY', symbol: '' };

  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch(e) { data.body = event.data.text(); }
  }

  const emoji = data.action === 'BUY' ? '🟢' : '🔴';
  const title = `${emoji} ${data.action} ${data.symbol}`;
  const options = {
    body: data.body || `Cena: $${data.price} | TP: $${data.tp} | SL: $${data.sl}`,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [300, 100, 300],
    tag: 'trading-signal-' + Date.now(),
    requireInteraction: true,
    data: { url: '/', signal: data },
    actions: [
      { action: 'open', title: '📊 Odpri' },
      { action: 'dismiss', title: '✕ Zapri' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Klik na notifikacijo
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Background Sync (za zanesljivost)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-signals') {
    event.waitUntil(syncSignals());
  }
});

async function syncSignals() {
  // Sinhronizacija v ozadju
  console.log('Background sync: preverjam signale...');
}
