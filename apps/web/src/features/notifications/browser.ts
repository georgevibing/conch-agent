import { PushSubscriptionJson } from '@conch/protocol';

import { installed } from '../pwa/register';

/**
 * What this browser can do about notifications:
 * - `ok`: it can, once you say yes;
 * - `install`: an iPhone or iPad, which notifies apps on the Home Screen only;
 * - `insecure`: not over https (or this computer), where no browser allows them;
 * - `unsupported`: this browser can't.
 */
export type PushSupport = 'ok' | 'install' | 'insecure' | 'unsupported';

const apple = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

export function pushSupport(): PushSupport {
  if (apple() && !installed()) return 'install';
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  return 'ok';
}

export function permission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'default';
}

const keyBytes = (base64url: string) => {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

async function registration(): Promise<ServiceWorkerRegistration> {
  const ready = navigator.serviceWorker.ready;
  // Registered on load; if it isn't yet (the first visit), register it now.
  if (!(await navigator.serviceWorker.getRegistration('/')))
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return ready;
}

/** The subscription this browser has now, if any. */
export async function current(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Subscribe this browser to `publicKey` (asking for permission first; call
 * it from a press). An old subscription made with another key — a restored
 * backup, a new Conch — is replaced.
 */
export async function subscribe(publicKey: string): Promise<PushSubscriptionJson> {
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error(
      'Notifications weren’t allowed. Allow them for Conch in the browser’s settings, then try again.',
    );
  const reg = await registration();
  const key = keyBytes(publicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing && !sameKey(existing.options.applicationServerKey, key))
    await existing.unsubscribe();
  const subscription =
    (existing && sameKey(existing.options.applicationServerKey, key) ? existing : undefined) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  return PushSubscriptionJson.parse(subscription.toJSON());
}

export async function unsubscribe(): Promise<void> {
  await (await current())?.unsubscribe();
}

/** This browser's subscription still matches what Conch knows (same key, same address). */
export function matches(subscription: PushSubscription | null, publicKey: string): boolean {
  return Boolean(
    subscription && sameKey(subscription.options.applicationServerKey, keyBytes(publicKey)),
  );
}
