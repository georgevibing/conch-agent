/**
 * Conch as an app (ADR 0026): "Conch" in Applications, Spotlight and
 * Launchpad on a Mac, the Start menu on Windows, the app menu on Linux.
 * Opening it opens Conch in the browser — and starts Conch first when it
 * isn't running, with a quiet "Starting Conch…" from the computer while it
 * does. No Terminal, ever.
 *
 * The app is a few small files Conch writes for this computer (an app
 * bundle, a shortcut), never a program downloaded from anywhere: nothing to
 * sign, nothing Gatekeeper or SmartScreen has to vouch for.
 */
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';

import { writeFileAtomic } from '../lib/fs';
import { run } from '../lib/proc';
import { unitName, type Exec } from './backends';
import { serviceLabel, shellLauncher, shQuote, windowsLauncher, type LaunchSpec } from './files';

const exec: Exec = (file, args) => run(file, args, { timeout: 30_000 });

export interface ShortcutSpec extends LaunchSpec {
  /** Where Conch answers. */
  url: string;
  /** The app icon (1024 px PNG) from Conch's web app. */
  icon: string;
}

/** The icon Conch ships, in its own folder. */
export const iconIn = (checkout: string) =>
  join(checkout, 'apps', 'web', 'public', 'icons', 'conch-1024.png');

// ── macOS: ~/Applications/Conch.app ───────────────────────────────────────

export function macInfoPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Conch</string>
  <key>CFBundleDisplayName</key>
  <string>Conch</string>
  <key>CFBundleIdentifier</key>
  <string>app.conch.open</string>
  <key>CFBundleExecutable</key>
  <string>Conch</string>
  <key>CFBundleIconFile</key>
  <string>Conch</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version.replace(/[^0-9A-Za-z.+-]/g, '')}</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
}

/**
 * What runs when you open the app: Conch answering means open it; otherwise
 * start it — through Always on's agent when it's on, or once by itself —
 * say "Starting Conch…" the computer's own way, and open it once it answers.
 *
 * It opens as this computer (ADR 0063): it asks Conch for a one-time link in
 * a folder only your account can write (`here/asks`), and opens the private
 * file Conch writes back. Nothing secret goes over the network, so whatever
 * listens on Conch's port while Conch is stopped learns nothing, and can't
 * choose what gets opened.
 */
export function openScript(spec: ShortcutSpec, platform: 'darwin' | 'linux'): string {
  const label = serviceLabel(spec.home);
  const open = platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
  const startViaComputer =
    platform === 'darwin'
      ? `PLIST="$HOME/Library/LaunchAgents/${label}.plist"
  if [ -f "$PLIST" ]; then
    launchctl kickstart "gui/$(id -u)/${label}" >/dev/null 2>&1 || launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1
    STARTED=1
  fi`
      : `if command -v systemctl >/dev/null 2>&1 && systemctl --user is-enabled ${unitName(label)}.service >/dev/null 2>&1; then
    systemctl --user start ${unitName(label)}.service && STARTED=1
  fi`;
  const notify =
    platform === 'darwin'
      ? `/usr/bin/osascript -e 'display notification "This takes a few seconds." with title "Starting Conch…"' >/dev/null 2>&1 &`
      : `command -v notify-send >/dev/null 2>&1 && notify-send -a Conch "Starting Conch…" "This takes a few seconds." >/dev/null 2>&1 &`;
  const failed =
    platform === 'darwin'
      ? `/usr/bin/osascript -e 'display alert "Conch didn’t start" message "Run pnpm start in Conch’s folder to see why." as warning' >/dev/null 2>&1`
      : `command -v notify-send >/dev/null 2>&1 && notify-send -a Conch "Conch didn’t start" "Run pnpm start in Conch’s folder to see why."`;
  return `#!/bin/sh
# Opens Conch, starting it first when it isn't running. Written by Conch; changes here don't last.
URL=${shQuote(spec.url)}
ASKS=${shQuote(posix.join(spec.home, 'here', 'asks'))}
HERE=$(cd "$(dirname "$0")" && pwd)
up() { /usr/bin/curl -fsS --max-time 2 -o /dev/null "$URL/api/health" 2>/dev/null; }
show() {
  FILE=
  if [ -d "$ASKS" ]; then
    ASK="$ASKS/$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
    if (umask 077 && printf '/\\n' > "$ASK.tmp" && mv "$ASK.tmp" "$ASK.ask"); then
      i=0
      while [ $i -lt 50 ] && [ ! -e "$ASK.open" ]; do sleep 0.1; i=$((i + 1)); done
      [ -s "$ASK.open" ] && [ -O "$ASK.open" ] && [ ! -L "$ASK.open" ] && FILE=$(cat "$ASK.open")
      rm -f "$ASK.ask"
    fi
  fi
  # Only a private page Conch wrote: its name, a plain file of yours, not a link.
  case "$FILE" in */conch-open-*.html) ;; *) FILE= ;; esac
  if [ -n "$FILE" ] && [ -f "$FILE" ] && [ ! -L "$FILE" ] && [ -O "$FILE" ]; then exec ${open} "$FILE"; fi
  exec ${open} "$URL"
}
if up; then show; fi
STARTED=
${startViaComputer}
if [ -z "$STARTED" ]; then
  START="$HERE/start"
  [ -f "$START" ] || START="$HERE/../Resources/start"
  nohup /bin/sh "$START" >/dev/null 2>&1 &
fi
${notify}
i=0
while [ $i -lt 120 ]; do
  if up; then show; fi
  sleep 0.5
  i=$((i + 1))
done
${failed}
exit 1
`;
}

/** Build `Conch.icns` from the 1024 px PNG with the Mac's own tools (sips, iconutil). */
async function macIcns(png: string, out: string, runner: Exec): Promise<boolean> {
  if (!existsSync(png)) return false;
  const set = join(await mkdtemp(join(tmpdir(), 'conch-icon-')), 'Conch.iconset');
  await mkdir(set);
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [
        [1, ''],
        [2, '@2x'],
      ] as const) {
        const px = String(size * scale);
        const result = await runner('sips', [
          '-z',
          px,
          px,
          png,
          '--out',
          join(set, `icon_${size}x${size}${suffix}.png`),
        ]);
        if (result.code !== 0) return false;
      }
    }
    return (await runner('iconutil', ['-c', 'icns', set, '-o', out])).code === 0;
  } finally {
    await rm(join(set, '..'), { recursive: true, force: true });
  }
}

// ── Windows ───────────────────────────────────────────────────────────────

/** An `.ico` holding one 256 px PNG (Windows Vista and later read PNG icons). */
export function icoFromPng(png: Uint8Array): Uint8Array {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(0, 6); // 256 wide
  header.writeUInt8(0, 7); // 256 high
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.byteLength, 14);
  header.writeUInt32LE(22, 18); // offset
  return Buffer.concat([header, png]);
}

/** VBScript string: double quotes doubled. */
const vbs = (value: string) => value.replaceAll('"', '""');

/**
 * The Start menu item runs this with no window: open Conch, starting it first
 * if it's down. It opens as this computer (ADR 0063): it asks Conch for a
 * one-time link in a folder only your account can write (`here\asks`), and
 * opens the private file Conch writes back. Nothing secret goes over the
 * network.
 */
export function windowsOpenScript(spec: ShortcutSpec, startCmd: string): string {
  return [
    `Dim url : url = "${vbs(spec.url)}"`,
    `Dim asks : asks = "${vbs(win32.join(spec.home, 'here', 'asks'))}"`,
    `Dim pages : pages = "${vbs(win32.join(spec.home, 'here', 'open'))}"`,
    'Dim shell : Set shell = CreateObject("WScript.Shell")',
    'Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")',
    'Function HereFile()',
    '  On Error Resume Next',
    '  HereFile = ""',
    '  If Not fso.FolderExists(asks) Then Exit Function',
    '  Randomize',
    '  Dim id, n : id = ""',
    '  For n = 1 To 24 : id = id & LCase(Hex(Int(Rnd * 16))) : Next',
    '  Dim ask : ask = asks & "\\" & id',
    '  Dim f : Set f = fso.CreateTextFile(ask & ".tmp", True)',
    '  f.WriteLine "/"',
    '  f.Close',
    '  fso.MoveFile ask & ".tmp", ask & ".ask"',
    '  Dim i : i = 0',
    '  Do While i < 50 And Not fso.FileExists(ask & ".open")',
    '    WScript.Sleep 100',
    '    i = i + 1',
    '  Loop',
    '  If fso.FileExists(ask & ".open") Then HereFile = Trim(Replace(Replace(fso.OpenTextFile(ask & ".open", 1).ReadAll(), vbCr, ""), vbLf, ""))',
    '  If fso.FileExists(ask & ".ask") Then fso.DeleteFile ask & ".ask"',
    'End Function',
    "' Only a private page Conch wrote: in its folder, its name, a plain file (not a link).",
    'Function Mine(file)',
    '  On Error Resume Next',
    '  Mine = False',
    '  If file = "" Then Exit Function',
    '  If Not fso.FileExists(file) Then Exit Function',
    '  If LCase(fso.GetParentFolderName(file)) <> LCase(pages) Then Exit Function',
    '  Dim name : name = LCase(fso.GetFileName(file))',
    '  If Len(name) <> 40 Or Left(name, 11) <> "conch-open-" Or Right(name, 5) <> ".html" Then Exit Function',
    '  If (fso.GetFile(file).Attributes And 1024) <> 0 Then Exit Function',
    '  Mine = (Err.Number = 0)',
    'End Function',
    'Function Up()',
    '  On Error Resume Next',
    '  Dim http : Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")',
    '  http.setTimeouts 1000, 1000, 2000, 2000',
    '  http.open "GET", url & "/api/health", False',
    '  http.send',
    '  Up = (Err.Number = 0 And http.status = 200)',
    'End Function',
    'If Not Up() Then',
    `  shell.Run """${vbs(startCmd)}""", 0, False`,
    '  Dim i : i = 0',
    '  Do While i < 120 And Not Up()',
    '    WScript.Sleep 500',
    '    i = i + 1',
    '  Loop',
    'End If',
    'If Up() Then',
    '  Dim file : file = HereFile()',
    '  If Mine(file) Then',
    '    shell.Run """" & file & """"',
    '  Else',
    '    shell.Run url',
    '  End If',
    'Else',
    '  MsgBox "Conch didn\'t start. Run pnpm start in Conch\'s folder to see why.", 48, "Conch"',
    'End If',
    '',
  ].join('\r\n');
}

/** A Start menu shortcut, made with Windows' own scripting (no extra program). */
function windowsLinkCommand(link: string, target: string, args: string, icon: string): string {
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  return [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(link)})`,
    `$s.TargetPath = ${q(target)}`,
    `$s.Arguments = ${q(args)}`,
    `$s.IconLocation = ${q(icon)}`,
    `$s.Description = 'Open Conch'`,
    '$s.Save()',
  ].join('; ');
}

// ── Linux ─────────────────────────────────────────────────────────────────

export function linuxDesktopEntry(script: string, icon: string): string {
  const quote = (value: string) => `"${value.replace(/(["`$\\])/g, '\\$1').replaceAll('%', '%%')}"`;
  return `[Desktop Entry]
Type=Application
Name=Conch
Comment=Your assistant
Exec=/bin/sh ${quote(script)}
Icon=${icon}
Terminal=false
Categories=Utility;
StartupNotify=false
`;
}

// ── Putting it in place ───────────────────────────────────────────────────

export interface ShortcutPlaces {
  /** macOS: the app bundle. */
  macApp: string;
  /** Windows: the Start menu item. */
  startMenu: string;
  /** Linux: the desktop entry. */
  desktopEntry: string;
}

export function shortcutPlaces(home = homedir()): ShortcutPlaces {
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  return {
    macApp: join(home, 'Applications', 'Conch.app'),
    startMenu: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Conch.lnk'),
    desktopEntry: join(home, '.local', 'share', 'applications', 'conch.desktop'),
  };
}

/** Where people will find it, in their words. */
export function shortcutWhere(platform: NodeJS.Platform): string | undefined {
  if (platform === 'darwin') return 'Applications';
  if (platform === 'win32') return 'the Start menu';
  if (platform === 'linux') return 'your apps';
  return undefined;
}

export class Shortcut {
  constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      places?: ShortcutPlaces;
      exec?: Exec;
      version: string;
    },
  ) {}

  get #platform() {
    return this.options.platform ?? process.platform;
  }

  get #places() {
    return this.options.places ?? shortcutPlaces();
  }

  /** Where people will find it, in their words: "Applications". */
  where(): string | undefined {
    return shortcutWhere(this.#platform);
  }

  /** It's there, where people look for apps. */
  installed(): boolean {
    const places = this.#places;
    if (this.#platform === 'darwin')
      return existsSync(join(places.macApp, 'Contents', 'Info.plist'));
    if (this.#platform === 'win32') return existsSync(places.startMenu);
    if (this.#platform === 'linux') return existsSync(places.desktopEntry);
    return false;
  }

  /**
   * Write it, or write it again for where Conch is now. Returns whether
   * anything changed. `dir` holds the scripts on Linux and Windows (under
   * `CONCH_HOME/shortcut`); a Mac keeps them inside the app.
   */
  async install(spec: ShortcutSpec, dir: string): Promise<boolean> {
    const runner = this.options.exec ?? exec;
    const platform = this.#platform;
    const places = this.#places;
    if (platform === 'darwin') {
      const contents = join(places.macApp, 'Contents');
      const before = await readFile(join(contents, 'MacOS', 'Conch'), 'utf8').catch(() => '');
      const script = openScript(spec, 'darwin');
      await mkdir(join(contents, 'MacOS'), { recursive: true });
      await mkdir(join(contents, 'Resources'), { recursive: true });
      await writeFileAtomic(
        join(contents, 'Info.plist'),
        macInfoPlist(this.options.version),
        0o644,
      );
      await writeFileAtomic(join(contents, 'MacOS', 'Conch'), script, 0o755);
      await chmod(join(contents, 'MacOS', 'Conch'), 0o755);
      await writeFileAtomic(join(contents, 'Resources', 'start'), shellLauncher(spec), 0o700);
      const icns = join(contents, 'Resources', 'Conch.icns');
      if (!existsSync(icns)) await macIcns(spec.icon, icns, runner);
      // Finder and Launchpad notice the new app straight away.
      await runner('touch', [places.macApp]);
      return before !== script;
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (platform === 'win32') {
      const start = join(dir, 'start.cmd');
      const open = join(dir, 'open.vbs');
      const icon = join(dir, 'conch.ico');
      const before = await readFile(open, 'utf8').catch(() => '');
      const script = windowsOpenScript(spec, start);
      await writeFileAtomic(start, windowsLauncher(spec), 0o700);
      await writeFileAtomic(open, script, 0o700);
      const png256 = spec.icon.replace(/conch-1024\.png$/, 'conch-256.png');
      if (existsSync(png256)) await writeFile(icon, icoFromPng(await readFile(png256)));
      const wscript = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe');
      await mkdir(join(places.startMenu, '..'), { recursive: true });
      const made = await runner('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        windowsLinkCommand(places.startMenu, wscript, `"${open}"`, icon),
      ]);
      if (made.code !== 0)
        throw new Error(`Windows couldn’t add Conch to the Start menu: ${made.stderr.trim()}`);
      return before !== script;
    }
    if (platform === 'linux') {
      const open = join(dir, 'open');
      const before = await readFile(open, 'utf8').catch(() => '');
      const script = openScript(spec, 'linux');
      await writeFileAtomic(open, script, 0o700);
      await writeFileAtomic(join(dir, 'start'), shellLauncher(spec), 0o700);
      const icon = join(dir, 'conch.png');
      if (existsSync(spec.icon)) await copyFile(spec.icon, icon);
      await writeFileAtomic(places.desktopEntry, linuxDesktopEntry(open, icon), 0o644);
      return before !== script;
    }
    return false;
  }

  async remove(dir: string): Promise<void> {
    const places = this.#places;
    if (this.#platform === 'darwin') await rm(places.macApp, { recursive: true, force: true });
    if (this.#platform === 'win32') await rm(places.startMenu, { force: true });
    if (this.#platform === 'linux') await rm(places.desktopEntry, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
}
