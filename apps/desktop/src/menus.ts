/**
 * Conch in the menu bar, tray or panel, and the Mac's app menu (ADR 0054).
 * Closing the window keeps Conch running; the icon opens it again, and
 * Quit Conch stops everything.
 */
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';

export interface MenuActions {
  open: () => void;
  quit: () => void;
  checkForUpdates: () => void;
  dev: boolean;
}

/** The pearl, at the size this computer's menu bar or tray draws. */
function trayPicture(resources: string) {
  const picture = nativeImage.createFromPath(join(resources, 'tray.png'));
  const size = process.platform === 'darwin' ? 18 : process.platform === 'win32' ? 16 : 22;
  return picture.isEmpty()
    ? picture
    : picture.resize({ width: size, height: size, quality: 'best' });
}

export class ConchTray {
  #tray?: Tray;

  constructor(
    private readonly resources: string,
    private readonly actions: MenuActions,
  ) {}

  get shown(): boolean {
    return Boolean(this.#tray && !this.#tray.isDestroyed());
  }

  show(on: boolean): void {
    if (!on) {
      this.#tray?.destroy();
      this.#tray = undefined;
      return;
    }
    if (this.shown) return;
    const tray = new Tray(trayPicture(this.resources));
    tray.setToolTip('Conch');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Conch', click: this.actions.open },
        { type: 'separator' },
        { label: 'Quit Conch', click: this.actions.quit },
      ]),
    );
    // Windows and Linux open with a click; a Mac shows its menu.
    if (process.platform !== 'darwin') tray.on('click', this.actions.open);
    this.#tray = tray;
  }
}

/** A Mac app has a menu bar of its own; Windows and Linux windows go without one. */
export function appMenu(actions: MenuActions): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: actions.checkForUpdates },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit Conch', accelerator: 'Command+Q', click: actions.quit },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(actions.dev ? [{ role: 'toggleDevTools' } as const] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
