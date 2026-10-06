import {
  FolderGuess,
  FolderListing,
  FolderPlaces,
  MadeFolder,
  type PickPurpose,
  PickResult,
} from '@conch/protocol';

import { request } from '../api/client';

/**
 * Whether the system's Open dialog can show for this page: only on the
 * computer Conch runs on (the gateway checks too).
 */
export function canPickHere(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

/**
 * This page is the desktop app's window (ADR 0054): the app shows the system's
 * own Open dialog over it, which is what a person in an app expects. Anywhere
 * else — a browser, a phone — Conch's own folder browser does it.
 */
export function inDesktopApp(): boolean {
  return canPickHere() && /\bElectron\//.test(navigator.userAgent);
}

/** The system's own Open dialog, for one purpose. Undefined when cancelled. */
export async function pickPath(purpose: PickPurpose): Promise<string | undefined> {
  const result = await request(PickResult, '/api/pick', { method: 'POST', body: { purpose } });
  return result.path;
}

/** Walking through this computer's folders, from any device (`/api/pick/…`). */
export const folders = {
  places: () => request(FolderPlaces, '/api/pick/places'),
  list: (path: string, options: { hidden?: boolean; purpose?: PickPurpose } = {}) => {
    const query = new URLSearchParams({ path });
    if (options.hidden) query.set('hidden', '1');
    if (options.purpose) query.set('purpose', options.purpose);
    return request(FolderListing, `/api/pick/list?${query}`);
  },
  guess: (path: string) => request(FolderGuess, `/api/pick/guess?${new URLSearchParams({ path })}`),
  make: (parent: string, name: string) =>
    request(MadeFolder, '/api/pick/folder', { method: 'POST', body: { parent, name } }),
};
