import { useLocation } from 'react-router';

import { showSettings } from './navigate';
import { settingsAt, type SettingsTab } from './paths';

/**
 * The pages inside a place that open from a row on it, as a phone's settings
 * drill in (NACRE.md § Settings): `/settings/<place>/<page>`, by name. Their
 * way back is the trail above them.
 */
export const SUBPAGES: Partial<Record<SettingsTab, Record<string, string>>> = {
  notifications: { topics: 'Topics' },
  usage: { limits: 'Limits' },
  health: { 'always-on': 'Always on' },
};

/**
 * What ⌘K, Repair everything and other pages bring into view
 * (`openSettings(place, focus)`) that now lives on one of those pages: the
 * page opens, and the section comes into view on it. The names are each
 * section's own (`TURN_LIMITS_FOCUS`, `BACKGROUND_FOCUS`…), written out here
 * so Settings doesn't depend on every place in it.
 */
const ON_SUBPAGE: Partial<Record<SettingsTab, Record<string, string>>> = {
  usage: { 'turn-limits': 'limits', routines: 'limits', 'plan-room': 'limits', learning: 'limits' },
  health: { background: 'always-on' },
};

/** The name of a page inside a place, for the trail: Notifications › **Topics**. */
export function subpageName(tab: SettingsTab | null, item: string | undefined) {
  if (!tab || item === undefined) return undefined;
  return SUBPAGES[tab]?.[item];
}

/** The page inside a place that a focus opens — the page itself, or what's on it. */
export function subpageFor(tab: SettingsTab | undefined, focus: string | undefined) {
  if (!tab || focus === undefined) return undefined;
  if (SUBPAGES[tab]?.[focus] !== undefined) return focus;
  return ON_SUBPAGE[tab]?.[focus];
}

/**
 * Which page inside `tab` the address shows (or `null`, the place itself), and
 * the way to open one. Each is an entry in the history, so Back steps out.
 */
export function useSubpage(tab: SettingsTab) {
  const { pathname } = useLocation();
  const at = settingsAt(pathname);
  const item = at?.tab === tab ? at.item : undefined;
  return {
    page: subpageName(tab, item) !== undefined ? (item ?? null) : null,
    open: (next: string) => showSettings(tab, next),
  };
}
