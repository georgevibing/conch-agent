/* global self, caches, fetch, URL */
/*
 * Conch's service worker (ADR 0027). It does three small things:
 *
 * 1. When Conch can't be reached, a page opened from the Home Screen shows a
 *    calm "Conch can't be reached" screen instead of the browser's error, and
 *    comes back by itself. Nothing else is cached: chats never sit in a cache.
 * 2. It shows notifications Conch sends (Web Push, encrypted end to end).
 * 3. A tap on one opens Conch where it matters. "Allow" and "Deny" answer right
 *    there (ADR 0108), each with the one-use ticket this device was sent for
 *    that one question; Allow is only offered for routine steps. Where a
 *    browser shows no buttons (iPhone), the tap opens the approval sheet.
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
    data: {
      url: typeof data.url === 'string' ? data.url : '/',
      answer: data.answer,
      deny: data.deny,
    },
    // Only where the browser shows buttons; elsewhere a tap opens the approval sheet.
    actions:
      Array.isArray(data.actions) && maxActions() > 0
        ? data.actions.slice(0, Math.min(2, maxActions()))
        : [],
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

/** How many buttons this browser shows on a notification; one that doesn't say ignores them. */
function maxActions() {
  const N = self.Notification;
  return N && typeof N.maxActions === 'number' ? N.maxActions : 2;
}

/** A short word back on the lock screen, replacing the question it answered. */
function said(title, body, tag) {
  return self.registration.showNotification(title, {
    body,
    tag,
    icon: '/icons/conch-192.png',
    badge: '/icons/conch-192.png',
    silent: true,
    data: { url: '/' },
  });
}

/** Allow or Deny, right here, with the ticket for this one question and this device's sign-in. */
function answer(data, decision, tag) {
  const answer = data.answer;
  const body = answer
    ? {
        conversationId: answer.conversationId,
        permissionId: answer.permissionId,
        ticket: answer.ticket,
        decision,
      }
    : data.deny;
  return fetch('/api/push/answer', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((response) => (response.ok ? response.json() : { outcome: 'failed' }))
    .catch(() => ({ outcome: 'failed' }))
    .then((result) => {
      if (result.outcome === 'answered')
        return decision === 'allow'
          ? said('Allowed', 'It carries on.', tag)
          : said('Denied', 'It won’t do that.', tag);
      if (result.outcome === 'gone') return said('Already answered', 'Nothing more to do.', tag);
      // Not from the lock screen, or Conch couldn't be reached: open the sheet.
      return open(data.url);
    });
}

function open(url) {
  const target = new URL(url || '/', self.location.origin).href;
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
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
  });
}

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  notification.close();
  if ((event.action === 'allow' || event.action === 'deny') && (data.answer || data.deny)) {
    event.waitUntil(answer(data, event.action, notification.tag));
    return;
  }
  event.waitUntil(open(data.url));
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
