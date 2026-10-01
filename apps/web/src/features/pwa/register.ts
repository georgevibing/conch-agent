/**
 * The service worker (ADR 0027): a calm "can't be reached" screen when Conch
 * is away, and notifications. Only in a secure context (https, or this
 * computer), which is also the only place a browser allows one.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // The development server serves its own modules; the worker is for Conch itself.
  if (import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  });
}

/** Opened from the Home Screen or as an installed app, not in a browser tab. */
export function installed(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
