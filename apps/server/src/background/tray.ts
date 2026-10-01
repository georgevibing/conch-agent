/**
 * Conch in the menu bar, the tray or the panel (ADR 0029).
 *
 * The gateway keeps one small helper running whenever it runs and the person
 * wants it (`preferences.menuBar`, on by default): at login with Always on,
 * or as soon as Conch starts. The helper outlives a Quit, so "Start Conch" is
 * one click away. It is built here from source Conch writes (`tray-sources`),
 * rebuilt when that source changes, and started again when it has stopped:
 * by the gateway on every start, and by Repair everything.
 *
 * It asks the gateway how things are over loopback with its own token
 * (`tray/token`, 0600, compared in constant time, `Gatekeeper.trayAllowed`).
 * It can read a few counts, quit Conch and hide itself; everything else
 * opens the page.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DoctorItem, TrayStatus } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { writeFileAtomic } from '../lib/fs';
import { run, type RunResult } from '../lib/proc';
import { serviceLabel, shellLauncher, shQuote, windowsLauncher, type LaunchSpec } from './files';
import { powershellSource, pythonSource, swiftSource, type TraySpec } from './tray-sources';
import { icoFromPng, iconIn } from './shortcut';
import { unitName } from './backends';

export const trayDir = (home: string) => join(home, 'tray');

export type Exec = (file: string, args: string[], timeout?: number) => Promise<RunResult>;
const exec: Exec = (file, args, timeout = 10_000) => run(file, args, { timeout });

export type Spawn = (
  file: string,
  args: string[],
  env: Record<string, string>,
) => number | undefined | Promise<number | undefined>;

/** One argument on a Windows command line, quoted the way the program will read it back. */
const windowsArg = (arg: string) =>
  /^[^\s"]+$/.test(arg) ? arg : `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;

/**
 * Windows: PowerShell that starts the helper and says its pid. What to start
 * comes from the environment, so a folder's name is never part of a command.
 */
const START_HIDDEN =
  '(Start-Process -FilePath $env:CONCH_START_FILE -ArgumentList $env:CONCH_START_ARGS -WindowStyle Hidden -PassThru).Id';

/**
 * Start the helper and let it go: it outlives this process. Returns its pid.
 *
 * Windows can't simply detach it. A detached program gets no console, and
 * `powershell.exe` without one leaves straight away (exit 0, nothing run);
 * one that isn't detached goes when the gateway does. So a short-lived
 * PowerShell starts it with `Start-Process`: the helper gets a hidden console
 * of its own and belongs to nobody.
 */
export const startHelper: Spawn = async (file, args, env) => {
  if (process.platform === 'win32') {
    const started = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', START_HIDDEN],
      {
        timeout: 20_000,
        env: {
          ...(Object.fromEntries(
            Object.entries(process.env).filter(([, value]) => value !== undefined),
          ) as Record<string, string>),
          ...env,
          CONCH_START_FILE: file,
          CONCH_START_ARGS: args.map(windowsArg).join(' '),
        },
      },
    );
    const pid = Number(started.stdout.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  }
  const child = nodeSpawn(file, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  child.unref();
  child.on('error', () => undefined);
  return child.pid;
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const WHERE: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'menu bar',
  win32: 'tray',
  linux: 'panel',
};

export interface TrayDeps {
  home: string;
  checkout?: string;
  /** Where Conch answers on this computer. */
  url: string;
  /** What the launcher needs (Node, PATH, environment). */
  spec: Omit<LaunchSpec, 'checkout' | 'home' | 'log'>;
  /** The person wants it (`preferences.menuBar`). */
  wanted: () => Promise<boolean>;
  setWanted: (on: boolean) => Promise<void>;
  /** Tell the gate which token the helper carries. */
  onToken: (token: string) => void;
  platform?: NodeJS.Platform;
  exec?: Exec;
  spawn?: Spawn;
  /** How long a helper just started gets before it's believed to have stayed (ms). */
  settle?: number;
  env?: NodeJS.ProcessEnv;
  heal?: (message: string) => void;
}

export class TrayService {
  #token?: string;

  constructor(private readonly deps: TrayDeps) {}

  get #platform() {
    return this.deps.platform ?? process.platform;
  }

  get #dir() {
    return trayDir(this.deps.home);
  }

  get #exec() {
    return this.deps.exec ?? exec;
  }

  /**
   * Whether this computer can show it: a Mac with its command-line tools (to
   * build the helper) and a desktop session; Windows; Linux with a desktop and
   * AppIndicator for Python.
   */
  async support(): Promise<Pick<TrayStatus, 'available' | 'unavailable' | 'need'>> {
    const env = this.deps.env ?? process.env;
    const platform = this.#platform;
    if (platform === 'darwin') {
      // Over SSH there's no menu bar to show anything in.
      const session = await this.#exec('launchctl', ['managername']);
      if (session.code === 0 && !/aqua/i.test(session.stdout))
        return {
          available: false,
          unavailable: 'This Mac has nobody logged in to its screen right now.',
        };
      if (existsSync(this.#binary())) return { available: true };
      const tools = await this.#exec('xcode-select', ['-p']);
      if (tools.code !== 0)
        return {
          available: false,
          unavailable: 'Showing Conch in the menu bar needs Apple’s Command Line Tools.',
          need: 'command-line-tools',
        };
      return { available: true };
    }
    if (platform === 'win32') return { available: true };
    if (platform === 'linux') {
      if (!env.DISPLAY && !env.WAYLAND_DISPLAY)
        return {
          available: false,
          unavailable: 'There’s no desktop on this computer to show it in.',
        };
      const check = await this.#exec('python3', [
        '-c',
        'import gi\ngi.require_version("Gtk","3.0")\ntry:\n  gi.require_version("AyatanaAppIndicator3","0.1")\nexcept ValueError:\n  gi.require_version("AppIndicator3","0.1")',
      ]);
      return check.code === 0
        ? { available: true }
        : {
            available: false,
            unavailable: 'Showing Conch in the panel needs AppIndicator for Python.',
            need: 'appindicator',
          };
    }
    return { available: false, unavailable: 'This computer can’t show Conch in a menu bar.' };
  }

  #binary(): string {
    return join(this.#dir, 'Conch Menu.app', 'Contents', 'MacOS', 'ConchMenu');
  }

  async #pid(): Promise<number | undefined> {
    const text = await readFile(join(this.#dir, 'pid'), 'utf8').catch(() => '');
    const pid = Number(text.trim());
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : undefined;
  }

  async status(): Promise<TrayStatus> {
    const where = WHERE[this.#platform] ?? 'menu bar';
    const support = await this.support().catch(() => ({ available: false }));
    return {
      ...support,
      where,
      on: await this.deps.wanted(),
      running: (await this.#pid()) !== undefined,
    };
  }

  /** The helper's token: made once, kept in its own file, told to the gate. */
  async token(): Promise<string> {
    if (this.#token) return this.#token;
    const file = join(this.#dir, 'token');
    let token = (await readFile(file, 'utf8').catch(() => '')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      token = randomBytes(32).toString('base64url');
      await mkdir(this.#dir, { recursive: true, mode: 0o700 });
      await writeFileAtomic(file, `${token}\n`, 0o600);
    }
    this.#token = token;
    this.deps.onToken(token);
    return token;
  }

  /** What starts Conch when the helper's "Start Conch" is pressed. */
  #startScript(spec: LaunchSpec): { path: string; text: string } {
    const label = serviceLabel(this.deps.home);
    if (this.#platform === 'win32')
      return { path: join(this.#dir, 'start.cmd'), text: windowsLauncher(spec) };
    const viaComputer =
      this.#platform === 'darwin'
        ? `PLIST="$HOME/Library/LaunchAgents/${label}.plist"
if [ -f "$PLIST" ]; then
  launchctl kickstart "gui/$(id -u)/${label}" >/dev/null 2>&1 || launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 && exit 0
fi`
        : `if command -v systemctl >/dev/null 2>&1 && systemctl --user is-enabled ${unitName(label)}.service >/dev/null 2>&1; then
  systemctl --user start ${unitName(label)}.service && exit 0
fi`;
    return {
      path: join(this.#dir, 'start'),
      text: `#!/bin/sh
# Starts Conch for the menu bar's "Start Conch". Written by Conch; changes here don't last.
${viaComputer}
nohup /bin/sh ${shQuote(join(this.#dir, 'launch'))} >/dev/null 2>&1 &
`,
    };
  }

  /**
   * Write the helper (and build it, on a Mac) for where Conch is now.
   * Returns where it is and how to run it. Rebuilds only when its source changed.
   */
  async #prepare(): Promise<{ file: string; args: string[] } | undefined> {
    const { checkout, home } = this.deps;
    if (!checkout) return undefined;
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    const launch: LaunchSpec = {
      ...this.deps.spec,
      checkout,
      home,
      log: join(home, 'logs', 'conch.log'),
    };
    const start = this.#startScript(launch);
    await writeFileAtomic(start.path, start.text, 0o700);
    if (this.#platform !== 'win32')
      await writeFileAtomic(join(this.#dir, 'launch'), shellLauncher(launch), 0o700);
    const png = iconIn(checkout).replace('conch-1024.png', 'conch-256.png');
    const spec: TraySpec = {
      url: this.deps.url,
      tokenFile: join(this.#dir, 'token'),
      startScript: start.path,
    };
    if (this.#platform === 'darwin') {
      const source = swiftSource(spec);
      const hash = createHash('sha256').update(source).digest('hex');
      const built = await readFile(join(this.#dir, 'built'), 'utf8').catch(() => '');
      if (built.trim() !== hash || !existsSync(this.#binary())) {
        const app = join(this.#dir, 'Conch Menu.app', 'Contents');
        await mkdir(join(app, 'MacOS'), { recursive: true });
        await writeFile(join(this.#dir, 'ConchMenu.swift'), source);
        await writeFileAtomic(join(app, 'Info.plist'), menuPlist(), 0o644);
        const compiled = await this.#exec(
          'xcrun',
          [
            'swiftc',
            '-O',
            '-framework',
            'AppKit',
            '-o',
            this.#binary(),
            join(this.#dir, 'ConchMenu.swift'),
          ],
          180_000,
        );
        if (compiled.code !== 0)
          throw new Error(
            `The menu bar helper didn’t build: ${compiled.stderr.trim().split('\n').pop() ?? ''}`,
          );
        await writeFile(join(this.#dir, 'built'), hash);
      }
      return { file: this.#binary(), args: [] };
    }
    if (this.#platform === 'win32') {
      const ico = join(this.#dir, 'conch.ico');
      if (existsSync(png)) await writeFile(ico, icoFromPng(await readFile(png)));
      const script = join(this.#dir, 'tray.ps1');
      await writeFileAtomic(script, powershellSource({ ...spec, icon: ico }), 0o600);
      return {
        file: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
        ],
      };
    }
    const icon = join(this.#dir, 'conch.png');
    if (existsSync(png)) await copyFile(png, icon);
    const script = join(this.#dir, 'tray.py');
    await writeFileAtomic(script, pythonSource({ ...spec, icon }), 0o700);
    await chmod(script, 0o700);
    return { file: 'python3', args: [script] };
  }

  /**
   * Show it, if it's wanted and can be shown, and it isn't already: on every
   * start, now and then, and from Repair everything. Never throws.
   */
  async ensure(): Promise<'running' | 'started' | 'off' | 'unavailable' | 'failed'> {
    try {
      if (!(await this.deps.wanted())) return 'off';
      if (!(await this.support()).available) return 'unavailable';
      await this.token();
      const before = await this.#pid();
      const prepared = await this.#prepare();
      if (!prepared) return 'unavailable';
      // A newer helper (Conch was updated) replaces the old one.
      const fresh = await readFile(join(this.#dir, 'started'), 'utf8').catch(() => '');
      const version = createHash('sha256')
        .update(JSON.stringify(prepared))
        .update(await this.#sourceStamp())
        .digest('hex');
      if (before && fresh.trim() === version) return 'running';
      if (before) this.#kill(before);
      const pid = await (this.deps.spawn ?? startHelper)(prepared.file, prepared.args, {
        CONCH_TRAY: '1',
      });
      if (!pid) return 'failed';
      await writeFile(join(this.#dir, 'pid'), String(pid));
      await writeFile(join(this.#dir, 'started'), version);
      // A pid isn't an icon: one that left straight away never showed anything.
      await new Promise((resolve) => setTimeout(resolve, this.deps.settle ?? 1_500));
      return alive(pid) ? 'started' : 'failed';
    } catch (error) {
      this.deps.heal?.(`The menu bar helper couldn’t start: ${(error as Error).message}`);
      return 'failed';
    }
  }

  async #sourceStamp(): Promise<string> {
    const name =
      this.#platform === 'darwin' ? 'built' : this.#platform === 'win32' ? 'tray.ps1' : 'tray.py';
    return readFile(join(this.#dir, name), 'utf8').catch(() => '');
  }

  #kill(pid: number) {
    if (pid === process.pid) return;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }

  /** Turn it on or off. Off stops it now; on shows it now. */
  async set(on: boolean): Promise<TrayStatus> {
    await this.deps.setWanted(on);
    if (on) await this.ensure();
    else await this.stop();
    return this.status();
  }

  async stop(): Promise<void> {
    const pid = await this.#pid();
    if (pid) this.#kill(pid);
    await rm(join(this.#dir, 'pid'), { force: true });
  }

  /** Everything it wrote goes (uninstall). */
  async remove(): Promise<void> {
    await this.stop();
    await rm(this.#dir, { recursive: true, force: true });
  }
}

/** The helper is an app of its own, so it has a name in Activity Monitor and no Dock icon. */
export function menuPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Conch Menu</string>
  <key>CFBundleIdentifier</key>
  <string>app.conch.menu</string>
  <key>CFBundleExecutable</key>
  <string>ConchMenu</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
}

/** A pretend helper for the mock engine: tests never put anything in this computer's menu bar. */
export function pretendTray(): Pick<TrayDeps, 'exec' | 'spawn' | 'settle' | 'platform'> {
  return {
    platform: 'win32',
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    spawn: () => process.pid,
    settle: 0,
  };
}

/** Repair everything's look at the menu bar helper: shown when wanted, started again when it stopped. */
export function trayCheck(tray: TrayService): DoctorCheck {
  return {
    id: 'tray',
    group: 'This computer',
    title: 'Menu bar',
    async run({ repair }) {
      const status = await tray.status();
      const item = (state: DoctorItem['state'], message: string, action?: DoctorItem['action']) => [
        {
          id: 'tray',
          group: 'This computer',
          title: `Conch in the ${status.where}`,
          state,
          message,
          ...(action && { action }),
        },
      ];
      if (!status.on) return item('off', `Conch isn’t shown in the ${status.where}.`);
      if (!status.available)
        return status.need
          ? item('needs-you', status.unavailable ?? 'It can’t be shown here yet.', {
              kind: 'need',
              label: 'Get it',
              need: status.need,
              mode: 'install',
            })
          : item('off', status.unavailable ?? 'It can’t be shown here.');
      if (status.running) return item('ok', `Conch is in the ${status.where}.`);
      if (!repair) return item('warning', `Conch should be in the ${status.where}, but isn’t.`);
      const result = await tray.ensure();
      return result === 'started' || result === 'running'
        ? item('fixed', `Conch is back in the ${status.where}.`)
        : item(
            'warning',
            `Conch couldn’t show itself in the ${status.where}. It tries again by itself.`,
          );
    },
  };
}
