/**
 * Conch, the app (ADR 0054): a window on the gateway it carries.
 *
 * One copy runs at a time. It starts the gateway (or finds a Conch already
 * running and shows that), keeps it running, opens the window on it, and
 * stays in the menu bar when the window closes. Quit Conch stops both.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  app,
  BrowserWindow as ElectronWindow,
  type BrowserWindow,
  dialog,
  globalShortcut,
  Notification,
  type OpenDialogOptions,
  screen,
  shell,
} from 'electron';

import { conchBuildLabel, type GatewayToApp } from '@conch/protocol';
import { readBuild } from '../../server/src/build';
import { gatewayEnv, loginShellPath } from './environment';
import { Gateway } from './gateway';
import { asThisComputer } from './here';
import { appMenu, ConchTray } from './menus';
import { ComputerOverlay } from './overlay';
import { missing, places } from './places';
import { originOf, STATUS_PAGE } from './policy';
import { Updater, updatesMode } from './updater';
import { appScheme, createWindow, grantPermissions, serveAppFiles, showStatus } from './window';

/** Started at login by Always on: no window until it's asked for. */
const background = process.argv.includes('--background');

if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  appScheme();
  main();
}

function main(): void {
  // Windows names the app's notifications and taskbar entry by this.
  app.setAppUserModelId('com.conchagent.app');
  const at = places({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const dev = at.kind === 'dev';
  const build = readBuild(at.conch);
  const buildLabel = conchBuildLabel(build);
  app.setAboutPanelOptions({
    applicationName: 'Conch',
    applicationVersion: buildLabel,
    version: '',
  });

  // ── The log: what the gateway says, kept beside Conch's own ────────────
  const logPath = join(at.home, 'logs', 'app.log');
  const log = (text: string) => {
    try {
      mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
      if ((statSync(logPath, { throwIfNoEntry: false })?.size ?? 0) > 5_000_000)
        renameSync(logPath, `${logPath}.1`);
      appendFileSync(logPath, text, { mode: 0o600 });
    } catch {
      // A log that can't be written never stops Conch.
    }
    if (dev) process.stdout.write(text);
  };
  log(
    `--- ${new Date().toISOString()} Conch ${buildLabel} is starting${background ? ' in the background' : ''}\n`,
  );
  process.on('uncaughtException', (error) => log(`[app] ${error.stack ?? error.message}\n`));

  // ── Who it is, and how it updates ─────────────────────────────────────
  const signed = (() => {
    try {
      const own = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
        conch?: { signed?: unknown };
      };
      return own.conch?.signed === true;
    } catch {
      return false;
    }
  })();
  const updates = updatesMode({
    packaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
    signed,
  });
  const loginPath = loginShellPath();

  // ── The gateway ───────────────────────────────────────────────────────
  let shellPath: string | undefined;
  const gateway = new Gateway(
    () => ({
      command: at.node,
      args: ['--import', 'tsx', 'src/main.ts'],
      cwd: join(at.conch, 'apps', 'server'),
      env: gatewayEnv({
        env: process.env,
        home: at.home,
        exe: process.execPath,
        updates,
        background,
        loginPath: shellPath,
        nodeBin: at.nodeBin,
      }),
    }),
    { log },
  );

  let quitting = false;
  let window: BrowserWindow | undefined;
  let gatewayUrl: string | undefined;
  const origins = () =>
    [gatewayUrl, at.web].flatMap((url) => {
      const origin = url ? originOf(url) : undefined;
      return origin ? [origin] : [];
    });
  /** Where the window shows Conch: the gateway, or the web app's dev server. */
  const conchPage = () => at.web ?? gatewayUrl;
  /** Load Conch in `shown` as this computer (ADR 0063): a one-time code from the gateway. */
  const showConch = async (shown: BrowserWindow, target: string) => {
    const url = await asThisComputer(target, at.home);
    if (!shown.isDestroyed()) await shown.loadURL(url).catch(() => undefined);
  };

  // ── The window ────────────────────────────────────────────────────────
  const boundsFile = join(app.getPath('userData'), 'window.json');
  const savedBounds = (): Electron.Rectangle | undefined => {
    try {
      const saved = JSON.parse(readFileSync(boundsFile, 'utf8')) as Electron.Rectangle;
      const area = screen.getDisplayMatching(saved).workArea;
      const visible =
        saved.x < area.x + area.width - 80 &&
        saved.x + saved.width > area.x + 80 &&
        saved.y >= area.y - 10 &&
        saved.y < area.y + area.height - 80;
      return visible && saved.width >= 380 && saved.height >= 480 ? saved : undefined;
    } catch {
      return undefined;
    }
  };
  const resources = at.resources;
  const onAction = (action: 'retry' | 'log' | 'quit') => {
    if (action === 'quit') app.quit();
    else if (action === 'log') void shell.openPath(logPath);
    else {
      if (window) showStatus(window, { state: 'starting' });
      gateway.retry();
    }
  };

  const ensureWindow = (): BrowserWindow => {
    if (window && !window.isDestroyed()) return window;
    const made = createWindow(
      {
        resources,
        origins,
        onAction,
        dev,
        // The pearl in the title bar and on the taskbar; a Mac shows the app's own.
        ...(process.platform === 'win32' && { icon: join(resources, 'icon.ico') }),
        ...(process.platform === 'linux' && { icon: join(resources, 'icon.png') }),
      },
      savedBounds(),
    );
    window = made;
    made.once('ready-to-show', () => {
      if (!background || shownOnce) made.show();
    });
    made.on('close', (event) => {
      try {
        writeFileSync(boundsFile, JSON.stringify(made.getNormalBounds()));
      } catch {
        // Its size is only a nicety.
      }
      if (quitting) return;
      // Conch keeps running: the window only hides.
      event.preventDefault();
      made.hide();
      sayStillRunning();
    });
    const state = gateway.state;
    const target = conchPage();
    if (state.kind === 'running' && target) void showConch(made, target);
    else if (state.kind === 'stopped')
      showStatus(made, { state: 'stopped', message: state.message });
    else
      showStatus(made, {
        state: 'starting',
        ...(state.kind === 'starting' && { message: state.message }),
      });
    return made;
  };

  let shownOnce = !background;
  const showWindow = () => {
    shownOnce = true;
    const shown = ensureWindow();
    if (shown.isMinimized()) shown.restore();
    shown.show();
    shown.focus();
  };

  /** The first time the window closes on Windows and Linux: Conch is still here. */
  const sayStillRunning = () => {
    if (process.platform === 'darwin' || !Notification.isSupported()) return;
    const told = join(app.getPath('userData'), 'told-still-running');
    try {
      readFileSync(told);
      return;
    } catch {
      // Not yet.
    }
    try {
      writeFileSync(told, '1');
    } catch {
      // Then it may say it again; that's fine.
    }
    const note = new Notification({
      title: 'Conch is still running',
      body: `Open it again from the ${process.platform === 'win32' ? 'tray' : 'panel'}. Quit Conch from there to stop it.`,
    });
    note.on('click', showWindow);
    note.show();
  };

  // ── The tray, the menus, updates ──────────────────────────────────────
  const actions = {
    open: showWindow,
    quit: () => app.quit(),
    checkForUpdates: () => {
      showWindow();
      const target = conchPage();
      if (target && window) void showConch(window, new URL('/?open=check-updates', target).href);
    },
    dev,
  };
  const tray = new ConchTray(resources, actions);
  // The glowing edge while the assistant uses this computer's apps (ADR 0110).
  const overlay = new ComputerOverlay({
    create: (options) => new ElectronWindow(options),
    displays: () => {
      const main = screen.getPrimaryDisplay();
      return [main, ...screen.getAllDisplays().filter((d) => d.id !== main.id)];
    },
    register: (accelerator, pressed) => {
      try {
        return globalShortcut.register(accelerator, pressed);
      } catch {
        return false;
      }
    },
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    onStop: () => void gateway.send({ type: 'computer.stop' }),
  });
  const updater = new Updater({
    development: build.kind === 'dev',
    send: (message) => void gateway.send(message),
    beforeInstall: async () => {
      quitting = true;
      await gateway.stop();
    },
    log: (line) => log(`${line}\n`),
  });

  // ── What the gateway says ─────────────────────────────────────────────
  let watching: NodeJS.Timeout | undefined;
  gateway.on('state', (state) => {
    clearInterval(watching);
    // A gateway that went away isn't using the computer any more.
    if (state.kind !== 'running') overlay.hide();
    if (state.kind === 'running') {
      const moved = gatewayUrl !== state.url;
      gatewayUrl = state.url;
      const target = conchPage();
      const current = window && !window.isDestroyed() ? window.webContents.getURL() : '';
      // A restart on the same address: the page brings itself back.
      if (window && target && (moved || !current.startsWith(target)))
        void showConch(window, target);
      // Another Conch: if it goes away, this app starts its own.
      if (state.elsewhere) watching = watchElsewhere(state.url);
    } else if (state.kind === 'stopped') {
      if (window && !window.isDestroyed())
        showStatus(window, { state: 'stopped', message: state.message });
      if ((!window || !window.isVisible()) && Notification.isSupported()) {
        const note = new Notification({ title: 'Conch stopped', body: state.message });
        note.on('click', showWindow);
        note.show();
      }
    } else if (state.kind === 'quit') {
      quitting = true;
      app.quit();
    } else if (
      window &&
      !window.isDestroyed() &&
      (window.webContents.getURL().startsWith(STATUS_PAGE) || state.message)
    ) {
      showStatus(window, { state: 'starting', message: state.message });
    }
  });
  /**
   * The system's Open dialog, over the window (`POST /api/pick` from it): what
   * a person in an app expects, rather than one raised in front of it. The
   * gateway wrote the words and the file types; the answer is a path or none.
   */
  const pickFor = async (asked: Extract<GatewayToApp, { type: 'pick' }>) => {
    try {
      const folder = asked.kind === 'folder';
      const options: OpenDialogOptions = {
        title: asked.prompt,
        message: asked.prompt,
        buttonLabel: 'Choose',
        properties: folder ? ['openDirectory', 'createDirectory', 'promptToCreate'] : ['openFile'],
        ...(!folder &&
          asked.extensions.length > 0 && {
            filters: [{ name: asked.prompt, extensions: asked.extensions }],
          }),
      };
      const parent = window && !window.isDestroyed() && window.isVisible() ? window : undefined;
      if (!parent) app.focus({ steal: true });
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      const path = result.canceled ? undefined : result.filePaths[0];
      gateway.send({ type: 'picked', id: asked.id, ...(path && { path }) });
    } catch {
      gateway.send({ type: 'picked', id: asked.id, failed: true });
    }
  };

  gateway.on('message', (message) => {
    if (message.type === 'tray') tray.show(message.on);
    else if (message.type === 'pick') void pickFor(message);
    else if (message.type === 'wake') {
      // "Hey Conch" (ADR 0078): the tray says it's listening, and the hidden window keeps running.
      tray.listening(message.on, () => void gateway.send({ type: 'wake.stop' }));
      if (window && !window.isDestroyed()) window.webContents.setBackgroundThrottling(!message.on);
    } else if (message.type === 'show') showWindow();
    else if (message.type === 'update') void updater.get(message.version, message.feed);
    else if (message.type === 'computer') overlay.set(message.on, message.label);
  });

  const watchElsewhere = (url: string) => {
    let misses = 0;
    const timer = setInterval(() => {
      void fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(3_000) })
        .then((response) => (misses = response.ok ? 0 : misses + 1))
        .catch(() => (misses += 1))
        .then(() => {
          if (misses < 2 || quitting) return;
          clearInterval(timer);
          log('[app] The Conch this app was showing stopped; starting its own.\n');
          gateway.retry();
        });
    }, 5_000);
    timer.unref();
    return timer;
  };

  // ── The app's life ────────────────────────────────────────────────────
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--background')) showWindow();
  });
  // The Dock icon. A Mac also says "activate" as an app starts: not a reason to
  // open a window that Always on started without one.
  const launchedAt = Date.now();
  app.on('activate', () => {
    if (!background || Date.now() - launchedAt > 3_000) showWindow();
  });
  app.on('window-all-closed', () => {
    // Conch keeps running in the menu bar.
  });
  let stopped = false;
  app.on('before-quit', (event) => {
    quitting = true;
    overlay.hide();
    if (stopped) return;
    event.preventDefault();
    clearInterval(watching);
    void gateway.stop().finally(() => {
      stopped = true;
      tray.show(false);
      app.quit();
    });
  });

  void app.whenReady().then(async () => {
    appMenu(actions);
    serveAppFiles(resources);
    grantPermissions(origins);
    const problem = missing(at);
    if (!background) showWindow();
    if (problem) {
      if (window) showStatus(window, { state: 'stopped', message: problem });
      return;
    }
    shellPath = await loginPath;
    gateway.start();
    // Development: the gateway starts again when its code changes.
    if (dev)
      watchSource(join(at.conch, 'apps', 'server', 'src'), (file) => {
        if (quitting) return;
        log(`[app] apps/server/src/${file} changed: starting the gateway again.\n`);
        void gateway.restart();
      });
  });
}

/**
 * Development only: call `changed` a moment after the gateway's code changes,
 * with the last file that did. Tests and anything that isn't code (an editor's
 * swap file, a test's scratch folder) don't count.
 */
function watchSource(folder: string, changed: (file: string) => void): void {
  let timer: NodeJS.Timeout | undefined;
  void import('node:fs').then(({ watch }) => {
    try {
      watch(folder, { recursive: true }, (_event, name) => {
        const file = name ? String(name).replaceAll('\\', '/') : '';
        if (!/\.(ts|mts|mjs|js|json)$/.test(file) || /\.test\.ts$/.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(() => changed(file), 300);
      });
    } catch {
      // No watching here: restart the app to pick up changes.
    }
  });
}
