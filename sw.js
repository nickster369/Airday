// Airday service worker: opens offline, loads fast, and shows episode alerts.
const VERSION = 'airday-v4';
const CORE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const IMG_CACHE = 'airday-images';
const RELAY = 'https://airday-movies.nicolassabbagha802.workers.dev';

self.addEventListener('install', e => {
  // Save each file on its own so one hiccup can never stop the install.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u =>
    fetch(u, { cache: 'reload' }).then(r => (r.ok && !r.redirected) ? c.put(u, r) : null).catch(() => null)
  ))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms){ return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin){
    // The app page: try the network first so updates show up, fall back to the saved copy.
    if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')){
      e.respondWith(
        Promise.race([fetch(req), timeout(3500)])
          .then(res => { if (res.ok && !res.redirected){ const copy = res.clone(); caches.open(VERSION).then(c => c.put('./', copy)); } return res; })
          .catch(() => caches.match('./').then(hit => hit || fetch(req)))
      );
      return;
    }
    // Icons and manifest: saved copy first.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Posters and cover art: keep a copy so they show offline and load instantly.
  if (req.destination === 'image'){
    e.respondWith(caches.open(IMG_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque'){
          c.put(req, res.clone());
          c.keys().then(keys => { if (keys.length > 600) keys.slice(0, 150).forEach(k => c.delete(k)); });
        }
        return res;
      } catch (err){ return Response.error(); }
    }));
  }
});

// Episode alerts: the relay sends an empty push, then we ask it what's new.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let msgs = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub){
        const r = await fetch(RELAY + '/push/pending', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        if (r.ok) msgs = (await r.json()).messages || [];
      }
    } catch (err){}
    if (!msgs.length) msgs = [{ title: 'Airday', body: 'A new episode is out.' }];
    const opts = { icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './' } };
    if (msgs.length === 1) return self.registration.showNotification(msgs[0].title, Object.assign({ body: msgs[0].body, tag: 'airday-' + msgs[0].title }, opts));
    return self.registration.showNotification(msgs.length + ' new episodes', Object.assign({ body: msgs.map(m => m.title).join(', '), tag: 'airday-batch' }, opts));
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list){ if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
