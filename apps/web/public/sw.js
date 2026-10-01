/* global self, caches, fetch, URL */
/*
 * Conch's service worker (ADR 0027). It does three small things:
 *
 * 1. When Conch can't be reached, a page opened from the Home Screen shows a
 *    calm "Conch can't be reached" screen instead of the browser's error, and
 *    comes back by itself. Nothing else is cached: chats never sit in a cache.
 * 2. It shows notifications Conch sends (Web Push, encrypted end to end).
 * 3. A tap on one opens Conch where it matters; "Deny" answers right there.
 */
const SHELL = 'conch-shell-v1';
const OFFLINE = ['/offline.html', '/offline.js', '/favicon.svg', '/icons/conch-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(OFFLINE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Always the network first: the cache is only for when Conch isn't there.
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (OFFLINE.includes(url.pathname))
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname)));
});

// ── Notifications ─────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Conch', body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' ? data.title : 'Conch';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    renotify: Boolean(data.tag),
    icon: '/icons/conch-192.png',
    badge: '/icons/conch-192.png',
    data: { url: typeof data.url === 'string' ? data.url : '/', deny: data.deny },
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    requireInteraction: Boolean(data.requireInteraction),
  };
  event.waitUntil(
    // A page of Conch in front of you already shows it; the notification would be noise.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const looking = windows.some((w) => w.visibilityState === 'visible' && w.focused);
      if (looking && !data.always) return undefined;
      return self.registration.showNotification(title, options);
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  notification.close();
  if (event.action === 'deny' && data.deny) {
    // Answered right here, with this device's own sign-in; nothing opens.
    event.waitUntil(
      fetch('/api/push/answer', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data.deny),
      }).catch(() => undefined),
    );
    return;
  }
  const target = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          return w
            .focus()
            .then((focused) =>
              focused && 'navigate' in focused ? focused.navigate(target) : undefined,
            );
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The push service changed this device's address: tell Conch the new one.
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((subscription) =>
        fetch('/api/push/subscriptions/renew', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            old: event.oldSubscription ? event.oldSubscription.endpoint : undefined,
            subscription: subscription.toJSON(),
          }),
        }),
      )
      .catch(() => undefined),
  );
});
