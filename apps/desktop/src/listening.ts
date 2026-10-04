/**
 * The tray's menu (ADR 0054), and what it says while the window listens for
 * "Hey Conch" (ADR 0078): that it's listening, and one click to stop.
 * Kept apart from Electron so it can be tested.
 */
import type { MenuItemConstructorOptions } from 'electron';

/** The icon's menu: what it's doing first, while it listens. */
export function trayMenu(
  actions: { open: () => void; quit: () => void },
  stopListening?: () => void,
): MenuItemConstructorOptions[] {
  return [
    ...(stopListening
      ? ([
          { label: 'Listening for “Hey Conch”', enabled: false },
          { label: 'Stop listening', click: stopListening },
          { type: 'separator' },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    { label: 'Open Conch', click: actions.open },
    { type: 'separator' },
    { label: 'Quit Conch', click: actions.quit },
  ];
}
