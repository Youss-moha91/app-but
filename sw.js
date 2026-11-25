// ============================================================
//  Service worker de l'app BUT R&T
//  C'est un petit programme qui se place ENTRE l'app et Internet.
//  Il garde une copie des fichiers de l'app pour qu'elle s'ouvre
//  même sans réseau.
// ============================================================
const CACHE = 'app-but-v2'; // change ce nom pour forcer une remise à zéro du cache
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

// 1) Installation : on range les fichiers de base dans le cache
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// 2) Activation : on supprime les anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau avec une limite de temps : si le Wi-Fi rame, on n'attend pas indéfiniment
const fetchTimeout = (req, ms) => Promise.race([
  fetch(req),
  new Promise((_, ko) => setTimeout(() => ko(new Error('timeout')), ms))
]);

// 3) Chaque requête de l'app passe par ici
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;

  // Les DONNÉES (Supabase, Formadep) vont toujours au réseau :
  // l'app garde déjà sa propre copie dans le localStorage.
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('workers.dev')) return;

  // La PAGE de l'app : réseau d'abord (pour avoir la dernière version),
  // et si pas de réseau → la copie en cache.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetchTimeout(req, 4000)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Le RESTE (icônes, polices, bibliothèques pdf.js et Supabase) :
  // on sert la copie tout de suite si on l'a, et on la met à jour en arrière-plan.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

// 4) Une notification arrive (envoyée par ton Worker, déjà déchiffrée par le téléphone)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'App BUT R&T', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'App BUT R&T', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: d.url || './' }
  }));
});

// 5) Tu touches la notification → on ouvre (ou on remet au premier plan) l'app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return clients.openWindow(url);
  }));
});
