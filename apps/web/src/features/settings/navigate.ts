import { go, here } from '../../app/navigation';
import {
  behindOf,
  behindPath,
  settingsAt,
  settingsPath,
  type SettingsState,
  type SettingsTab,
} from './paths';

export interface SettingsMove {
  /** Take the place of this history entry rather than adding one. */
  replace?: boolean;
  /** The page Settings opens over, when it isn't the one showing now. */
  from?: string;
}

/**
 * Show a place in Settings (or Settings itself). Each place is its own entry
 * in the history, so Back and Forward step through them; the page Settings
 * opened over travels along, so leaving returns there.
 */
export function showSettings(tab?: SettingsTab, item?: string, move: SettingsMove = {}): void {
  const at = here();
  if (!at) return;
  const path = settingsPath(tab, item);
  const inside = settingsAt(at.pathname) !== null;
  if (inside && at.pathname === path && !move.replace) return;
  const behind =
    behindPath(move.from) ??
    (inside ? behindOf(at) : behindPath(at.pathname + at.search + at.hash));
  const state: SettingsState | null = behind ? { behind } : null;
  go(path, { replace: move.replace, state });
}

/** Back to the page Settings opened over (the chats, when it was opened by its address). */
export function leaveSettings(): void {
  const at = here();
  if (!at || !settingsAt(at.pathname)) return;
  go(behindOf(at) ?? '/');
}
