import { useCallback, useSyncExternalStore } from 'react';

/**
 * The products someone hearted, kept for as long as the page is open: a
 * shelf drawn again (another chat and back, a reply streaming above it)
 * remembers. Nothing is saved or sent anywhere.
 */
const hearted = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setShortlisted(key: string, on: boolean) {
  if (hearted.has(key) === on) return;
  if (on) hearted.add(key);
  else hearted.delete(key);
  version++;
  for (const l of listeners) l();
}

/** For tests: forget every heart. */
export function clearShortlist() {
  hearted.clear();
  version++;
  for (const l of listeners) l();
}

/** Whether each of these keys is on the shortlist, and a way to change one. */
export function useShortlist(keys: readonly string[]) {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  const toggle = useCallback((key: string) => setShortlisted(key, !hearted.has(key)), []);
  return {
    has: (key: string) => hearted.has(key),
    toggle,
    count: keys.filter((k) => hearted.has(k)).length,
  };
}
