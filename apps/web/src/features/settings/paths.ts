import type { Location } from 'react-router';

/** Settings is a page with an address of its own, and so is every place in it. */
export const SETTINGS_PATH = '/settings';

/** Every place in Settings, as its address names it: `/settings/<place>`. */
export const SETTINGS_TABS = [
  'general',
  'notifications',
  'agents',
  'memory',
  'voice',
  'providers',
  'usage',
  'browser',
  'terminal',
  'computer',
  'access',
  'security',
  'health',
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

const isTab = (value: string): value is SettingsTab =>
  (SETTINGS_TABS as readonly string[]).includes(value);

/** Everything Conch remembers: a page inside Settings → Memory (`/settings/memory/everything`). */
export const MEMORY_ALL = 'everything';

/** `openSettings('providers', FALLBACK_FOCUS)`: Providers → When one can’t answer. */
export const FALLBACK_FOCUS = 'fallback';

/** `openSettings('access', OTHER_APPS_FOCUS)`: Access → Apps that use Conch, under its Advanced. */
export const OTHER_APPS_FOCUS = 'other-apps';

/**
 * Places that moved: an old address (a bookmark, a link, a fix from an older
 * gateway) lands where they are now, at the part that was the page.
 */
const MOVED = {
  personality: { tab: 'agents' },
  appearance: { tab: 'general' },
  about: { tab: 'memory' },
  // The defaults are the composer's own (Make this my default); what was left is on Providers.
  models: { tab: 'providers' },
  devices: { tab: 'access' },
  'other-apps': { tab: 'access', focus: OTHER_APPS_FOCUS },
} as const satisfies Record<string, { tab: SettingsTab; focus?: string }>;

/** An old name of a place in Settings, still understood. */
export type MovedTab = keyof typeof MOVED;

/** Where an old name of a place lands now (a current name is itself). */
export function placeOf(named: string): { tab: SettingsTab; focus?: string } | undefined {
  if (isTab(named)) return { tab: named };
  return Object.hasOwn(MOVED, named) ? MOVED[named as MovedTab] : undefined;
}

/** Places that left Settings for a page of their own: Commands is on Skills now. */
const MOVED_OUT: Record<string, { path: string; focus: string }> = {
  commands: { path: '/skills', focus: 'commands' },
};

/** The page an old Settings address (`/settings/commands`) now is, or undefined. */
export function movedOut(named: string): { path: string; focus: string } | undefined {
  return Object.hasOwn(MOVED_OUT, named) ? MOVED_OUT[named] : undefined;
}

/** Bringing your things from another assistant: `/settings/memory/from-openclaw`. */
export const comeHomeItem = (source: string) => `from-${source}`;

/**
 * Where Settings is. No `tab`: Settings itself (General, or the list on a
 * phone). `item`: a page inside a place — a provider's own page is
 * `/settings/providers/<id>`.
 */
export interface SettingsAddress {
  tab?: SettingsTab;
  item?: string;
}

/** What Settings keeps in the history entry: the page it opened over, to go back to. */
export interface SettingsState {
  behind?: string;
}

export function settingsPath(tab?: SettingsTab, item?: string): string {
  if (!tab) return SETTINGS_PATH;
  return item ? `${SETTINGS_PATH}/${tab}/${encodeURIComponent(item)}` : `${SETTINGS_PATH}/${tab}`;
}

/** The place an address shows, or null when it isn't in Settings. */
export function settingsAt(pathname: string): SettingsAddress | null {
  if (pathname !== SETTINGS_PATH && !pathname.startsWith(`${SETTINGS_PATH}/`)) return null;
  const [named, item] = pathname.slice(SETTINGS_PATH.length + 1).split('/');
  // An address from a newer or older Conch that names no place here: Settings itself.
  const tab = named ? placeOf(named)?.tab : undefined;
  if (!tab) return {};
  if (!item) return { tab };
  try {
    return { tab, item: decodeURIComponent(item) };
  } catch {
    return { tab };
  }
}

/** A page of this app to return to: a path here, never Settings itself, never another site. */
export function behindPath(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return undefined;
  const pathname = path.split(/[?#]/)[0] ?? path;
  return settingsAt(pathname) ? undefined : path;
}

/** The page Settings opened over, kept in its history entry (it survives a reload). */
export function behindOf(location: Pick<Location, 'state'>): string | undefined {
  const state = location.state as SettingsState | null | undefined;
  return behindPath(state?.behind);
}

/** The pages Settings can open over, by what their addresses start with. */
const BEHIND_NAMES: [prefix: string, name: string][] = [
  ['/routines', 'Routines'],
  ['/skills', 'Skills'],
  ['/apps/a_', 'Back'],
  ['/apps', 'Apps'],
  ['/channels', 'Apps'],
  ['/passwords', 'Passwords'],
  ['/activity', 'Activity'],
  ['/archived', 'Archived chats'],
];

/**
 * What leaving Settings goes back to, in a word for its button: Chats from a
 * chat (or when it was opened by its address), the page's name from another.
 */
export function behindName(behind: string | undefined): string {
  const pathname = behind?.split(/[?#]/)[0] ?? '/';
  if (pathname === '/' || pathname.startsWith('/c/')) return 'Chats';
  return BEHIND_NAMES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Back';
}
