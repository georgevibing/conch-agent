/**
 * The one window (ADR 0054): Conch's page, held to Conch's origin.
 *
 * - Every other link opens in the person's browser (web and mail links only).
 * - Sign-in windows are created hidden; the moment one heads for a
 *   provider's page, that address goes to the person's browser and the
 *   window closes. The page sees the sign-in finish from the gateway.
 * - Only Conch's origin gets permissions, and only the ones it uses.
 * - Closing the window hides it: Conch keeps running in the menu bar.
 */
import {
  BrowserWindow,
  clipboard,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  allowPermission,
  appAction,
  appFile,
  APP_SCHEME,
  externalUrl,
  isConch,
  isSignInWindow,
  STATUS_PAGE,
} from './policy';

/** The page's own colours, so the window never flashes white in the dark. */
export const BACKGROUND = { light: '#fbf9f7', dark: '#13100e' };

export interface WindowDeps {
  /** The app's pictures and pages. */
  resources: string;
  /** Where Conch is right now (the gateway, or the web dev server), as origins. */
  origins: () => string[];
  /** The status page's buttons: Try again, Open the log, Quit. */
  onAction: (action: 'retry' | 'log' | 'quit') => void;
  icon?: string;
  dev: boolean;
}

const SECURE: BrowserWindowConstructorOptions['webPreferences'] = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: true,
};

/** Hand `url` to the person's browser, if it's a link at all. */
function openOutside(url: string): void {
  const safe = externalUrl(url);
  if (safe) void shell.openExternal(safe).catch(() => undefined);
}

/** Right-click: what any text box offers, and a link's own address. */
function contextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    for (const suggestion of params.dictionarySuggestions.slice(0, 4))
      items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
    if (params.misspelledWord)
      items.push(
        {
          label: 'Add to dictionary',
          click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
        { type: 'separator' },
      );
    const link = externalUrl(params.linkURL);
    if (link)
      items.push(
        { label: 'Open link in browser', click: () => openOutside(link) },
        { label: 'Copy link', click: () => clipboard.writeText(link) },
        { type: 'separator' },
      );
    const { editFlags, isEditable, selectionText } = params;
    if (isEditable)
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { role: 'selectAll' },
      );
    else if (selectionText.trim()) items.push({ role: 'copy' });
    while (items.at(-1)?.type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}

/** The rules every window of the app's follows. */
function guard(contents: WebContents, deps: WindowDeps): void {
  const leave = (event: Electron.Event, url: string) => {
    if (isConch(url, deps.origins())) return;
    event.preventDefault();
    openOutside(url);
  };
  // The status page's buttons are fragments of its own address.
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    const action = isMainFrame ? appAction(url) : undefined;
    if (action) deps.onAction(action);
  });
  contents.on('will-navigate', leave);
  contents.on('will-redirect', leave);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url, frameName }) => {
    if (isSignInWindow(url, frameName, deps.origins()))
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: false,
          width: 520,
          height: 720,
          webPreferences: SECURE,
        },
      };
    openOutside(url);
    return { action: 'deny' };
  });
  // A sign-in window: hidden, and gone the moment it heads elsewhere.
  contents.on('did-create-window', (child) => {
    const away = (event: Electron.Event, url: string) => {
      if (isConch(url, deps.origins())) return;
      event.preventDefault();
      openOutside(url);
      if (!child.isDestroyed()) child.close();
    };
    child.webContents.on('will-navigate', away);
    child.webContents.on('will-redirect', away);
    child.webContents.setWindowOpenHandler(({ url }) => {
      openOutside(url);
      return { action: 'deny' };
    });
    // One that never went anywhere (the page gave up) doesn't linger.
    setTimeout(() => {
      if (!child.isDestroyed()) child.close();
    }, 120_000).unref();
  });
  contextMenu(contents);
}

/** Only Conch's origin gets anything, and only what Conch uses. */
export function grantPermissions(origins: () => string[]): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const media = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    callback(allowPermission(permission, contents.getURL(), origins(), media));
  });
  ses.setPermissionCheckHandler((_contents, permission, origin) =>
    allowPermission(permission, origin, origins(), permission === 'media' ? ['audio'] : []),
  );
  // Nothing in Conch asks to pick a device; a page that tries gets nothing.
  ses.setDevicePermissionHandler(() => false);
}

export function createWindow(deps: WindowDeps, bounds?: Electron.Rectangle): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Conch',
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 860,
    ...(bounds && { x: bounds.x, y: bounds.y }),
    minWidth: 380,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    ...(deps.icon && { icon: deps.icon }),
    autoHideMenuBar: true,
    webPreferences: SECURE,
  });
  guard(window.webContents, deps);
  // The page crashed (out of memory, a GPU hiccup): draw it again.
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.reload();
    }, 500);
  });
  if (deps.dev)
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') window.webContents.toggleDevTools();
    });
  return window;
}

/**
 * The app's own pages, from `conch-app://app/`: before the app is ready the
 * scheme is made a standard, secure one, so the page has an origin of its
 * own and its CSP can say 'self'.
 */
export function appScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/** Once the app is ready: serve its two files, read from its archive, and nothing else. */
export function serveAppFiles(resources: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const name = appFile(request.url);
    if (!name) return new Response('Not here.', { status: 404 });
    const body = await readFile(join(resources, name));
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}

/** The app's own page while Conch starts, or after it stopped: the pearl, a sentence, a button. */
export function showStatus(
  window: BrowserWindow,
  status: { state: 'starting'; message?: string } | { state: 'stopped'; message: string },
): void {
  const query = new URLSearchParams({
    state: status.state,
    ...(status.message && { message: status.message }),
  });
  void window.loadURL(`${STATUS_PAGE}?${query.toString()}`).catch(() => undefined);
}
