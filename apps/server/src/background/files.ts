/**
 * What Always on writes (ADR 0026), as text: the launcher that starts Conch,
 * and the file each computer reads at login to run it. Pure functions, so
 * every quoting rule is tested with the awkward paths people really have
 * (spaces, quotes, `$`, `%`, non-ASCII).
 *
 * The launcher looks for Node each time it starts, rather than remembering
 * one path: Homebrew, nvm and installers move Node on every upgrade, and a
 * login item pointing at an old one would never start again to fix itself.
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The oldest Node Conch runs on (package.json `engines`). */
export const NODE_MAJOR = 24;

export interface LaunchSpec {
  /** Conch's own folder (the git checkout). */
  checkout: string;
  /** `CONCH_HOME`. */
  home: string;
  /** The Node running Conch now: tried first. */
  node: string;
  /** Where the launcher writes Conch's output. */
  log: string;
  /** Settings that came from the environment and must survive a login (host, port…). */
  env: Record<string, string>;
  /** The PATH Conch was started with: the programs it runs live there. */
  path: string;
  /**
   * The desktop app's own program (ADR 0054). Then the launcher starts the
   * app with `--background` (no window, just the menu bar) instead of Node.
   */
  app?: string;
}

/** The label a computer knows Conch by. Another `CONCH_HOME` (a test) gets its own. */
export function serviceLabel(home: string, defaultHome = join(homedir(), '.conch')): string {
  if (home === defaultHome) return 'app.conch.gateway';
  return `app.conch.gateway.${createHash('sha256').update(home).digest('hex').slice(0, 8)}`;
}

/** `app.conch.gateway` → `conch`; another home's label keeps its suffix. */
export function unitName(label: string): string {
  return label === 'app.conch.gateway' ? 'conch' : `conch-${label.split('.').pop() ?? 'other'}`;
}

/**
 * Environment worth carrying into a login. Proxies and certificates often
 * only exist in a shell's profile, and without them nothing reaches the
 * internet at work. A proxy with a password in it stays out: the launcher is
 * a plain file.
 */
const CARRIED = [
  'CONCH_HOST',
  'CONCH_PORT',
  'CONCH_ALLOW_REMOTE',
  'CONCH_ALLOWED_HOSTS',
  // Your own address (ADR 0064): its ports, its certificate authority and its network.
  'CONCH_HTTPS_PORT',
  'CONCH_HTTP_PORT',
  'CONCH_ACME_DIRECTORY',
  'CONCH_PUBLIC_IP',
  'CONCH_DNS_SERVERS',
  'CONCH_LOG_LEVEL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'LANG',
  'LC_ALL',
] as const;

export function carriedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of CARRIED) {
    const value = env[key];
    if (!value?.trim()) continue;
    if (/proxy/i.test(key) && value.includes('@')) continue;
    kept[key] = value;
  }
  return kept;
}

// ── POSIX sh ──────────────────────────────────────────────────────────────

/** `'it'\''s'`: single quotes keep everything literal in sh, except a quote. */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Places Node lands when it isn't on a login's PATH, newest first where there are versions. */
const NODE_PLACES = [
  '"$HOME/.conch/runtime/node/bin/node"',
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
  '"$HOME/.volta/bin/node"',
  '"$HOME/.local/bin/node"',
];
const NODE_VERSION_DIRS = [
  '"$HOME"/.nvm/versions/node/v*/bin/node',
  '"$HOME"/.local/share/fnm/node-versions/v*/installation/bin/node',
  '"$HOME"/Library/Application\\ Support/fnm/node-versions/v*/installation/bin/node',
  '"$HOME"/.local/share/mise/installs/node/*/bin/node',
  '"$HOME"/.asdf/installs/nodejs/*/bin/node',
];

/**
 * The launcher on a Mac and Linux. It keeps its log to a few megabytes,
 * finds a Node new enough, and starts Conch's supervisor, which keeps the
 * gateway running. Exit 78 (`EX_CONFIG`) when it can't: what's missing is
 * in the log, and Repair everything says it in words.
 */
export function shellLauncher(spec: LaunchSpec): string {
  if (spec.app) return appShellLauncher(spec, spec.app);
  const exports = Object.entries({
    // Quiet by default: a log nobody reads shouldn't grow with every request.
    CONCH_LOG_LEVEL: 'warn',
    ...spec.env,
    CONCH_HOME: spec.home,
    CONCH_SUPERVISE: '1',
    CONCH_BACKGROUND: '1',
    CONCH_OPEN: '0',
  })
    .map(([key, value]) => `export ${key}=${shQuote(value)}`)
    .join('\n');
  return `#!/bin/sh
# Starts Conch in the background when you log in (Settings → Health → Always on).
# Conch writes this file and rewrites it when something moves; changes here don't last.
${exports}
export PATH=${shQuote(spec.path)}:"$PATH"
CHECKOUT=${shQuote(spec.checkout)}
LOG=${shQuote(spec.log)}

# The log can say what you asked for: it's yours alone, like everything in ~/.conch.
umask 077
mkdir -p "$(dirname "$LOG")"
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ]; then mv -f "$LOG" "$LOG.1"; fi
exec >>"$LOG" 2>&1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') Conch is starting in the background"

recent() { "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= ${NODE_MAJOR} ? 0 : 1)' 2>/dev/null; }
NODE=
for candidate in ${shQuote(spec.node)} "$(command -v node 2>/dev/null)" ${NODE_PLACES.join(' ')}; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && recent "$candidate"; then NODE=$candidate; break; fi
done
if [ -z "$NODE" ]; then
  for candidate in ${NODE_VERSION_DIRS.join(' ')}; do
    if [ -x "$candidate" ] && recent "$candidate"; then NODE=$candidate; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "Conch needs Node.js ${NODE_MAJOR} or newer and couldn't find it. Install it from https://nodejs.org, then open Conch again."
  exit 78
fi
# A release swapped in since (ADR 0051) is where Conch runs from now.
if [ -f "$CONCH_HOME/versions/current" ]; then
  CURRENT=$(head -n 1 "$CONCH_HOME/versions/current")
  if [ -n "$CURRENT" ] && [ -f "$CURRENT/apps/server/src/start.ts" ]; then CHECKOUT=$CURRENT; fi
fi
if ! cd "$CHECKOUT/apps/server" 2>/dev/null; then
  echo "Conch's folder isn't at $CHECKOUT any more. Run Conch from where it is now (pnpm start), and it puts this right."
  exit 78
fi
exec "$NODE" --import tsx src/start.ts
`;
}

/**
 * The launcher for the desktop app: the app itself, with no window. It runs
 * its own Conch, so nothing here looks for Node or a folder. Exit 78 when the
 * app isn't where it was: opening it from where it is now puts this right.
 */
function appShellLauncher(spec: LaunchSpec, app: string): string {
  return `#!/bin/sh
# Starts the Conch app in the background when you log in (Settings → Health → Always on).
# Conch writes this file and rewrites it when the app moves; changes here don't last.
export CONCH_HOME=${shQuote(spec.home)}
APP=${shQuote(app)}
LOG=${shQuote(spec.log)}

umask 077
mkdir -p "$(dirname "$LOG")"
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ]; then mv -f "$LOG" "$LOG.1"; fi
exec >>"$LOG" 2>&1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') The Conch app is starting in the background"
if [ ! -x "$APP" ]; then
  echo "The Conch app isn't at $APP any more. Open Conch from where it is now, and it puts this right."
  exit 78
fi
exec "$APP" --background
`;
}

// ── macOS: launchd ────────────────────────────────────────────────────────

const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * A LaunchAgent: runs at login, and again if it stops by accident (not when
 * you quit it: a clean exit stays stopped). `Interactive` keeps App Nap from
 * slowing it down, so a routine runs on the minute. With Conch's host
 * (`host.ts`), the host runs the launcher, so macOS knows it all as Conch.
 */
export function launchdPlist(label: string, launcher: string, log: string, host?: string): string {
  const program = host ? [host, '/bin/sh', launcher] : [launcher];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${program.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

// ── Linux: systemd, or the desktop's autostart ────────────────────────────

/** A systemd argument: double quotes, with `\`, `"`, `$` and `%` made literal. */
export function systemdQuote(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '$$$$')
    .replaceAll('%', '%%')}"`;
}

/** A user service: starts with your session, again after a crash, never after you quit it. */
export function systemdUnit(launcher: string): string {
  return `[Unit]
Description=Conch, your assistant, always on
After=network-online.target

[Service]
Type=simple
ExecStart=/bin/sh ${systemdQuote(launcher)}
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=78
KillMode=mixed
TimeoutStopSec=25

[Install]
WantedBy=default.target
`;
}

/** A desktop-entry `Exec` argument (freedesktop rules: quote, then escape `"`, `` ` ``, `$`, `\`; `%` doubled). */
export function desktopQuote(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1').replaceAll('%', '%%')}"`;
}

/** For desktops without systemd: started when you sign in to the desktop. */
export function autostartEntry(launcher: string): string {
  return `[Desktop Entry]
Type=Application
Name=Conch
Comment=Your assistant, always on
Exec=/bin/sh ${desktopQuote(launcher)}
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`;
}

// ── Windows ───────────────────────────────────────────────────────────────

/** A value in `set "NAME=value"`: `%` is the only character a batch file still reads. */
const batch = (value: string) => value.replaceAll('%', '%%');

/** The batch file that starts Conch, written for `wscript` to run with no window. */
export function windowsLauncher(spec: LaunchSpec): string {
  if (spec.app)
    return [
      '@echo off',
      'rem Starts the Conch app in the background when you sign in (Settings > Health > Always on).',
      'rem Conch writes this file and rewrites it when the app moves.',
      `set "CONCH_HOME=${batch(spec.home)}"`,
      `set "LOG=${batch(spec.log)}"`,
      `set "APP=${batch(spec.app)}"`,
      `if not exist "%APP%" (echo The Conch app has moved. Open Conch from where it is now and it puts this right. >> "%LOG%" & exit /b 78)`,
      'echo --- %DATE% %TIME% The Conch app is starting in the background >> "%LOG%"',
      'start "" "%APP%" --background',
      '',
    ].join('\r\n');
  const sets = Object.entries({
    // Quiet by default: a log nobody reads shouldn't grow with every request.
    CONCH_LOG_LEVEL: 'warn',
    ...spec.env,
    CONCH_HOME: spec.home,
    CONCH_SUPERVISE: '1',
    CONCH_BACKGROUND: '1',
    CONCH_OPEN: '0',
  })
    .map(([key, value]) => `set "${key}=${batch(value)}"`)
    .join('\r\n');
  return [
    '@echo off',
    'rem Starts Conch in the background when you sign in (Settings > Health > Always on).',
    'rem Conch writes this file and rewrites it when something moves.',
    sets,
    `set "PATH=${batch(spec.path)};%PATH%"`,
    `set "LOG=${batch(spec.log)}"`,
    `set "NODE=${batch(spec.node)}"`,
    'if not exist "%NODE%" for /f "delims=" %%i in (\'where node 2^>nul\') do if not defined FOUND set "NODE=%%i" & set FOUND=1',
    `if not exist "%NODE%" (echo Conch needs Node.js ${NODE_MAJOR} or newer and couldn't find it. Install it from https://nodejs.org. >> "%LOG%" & exit /b 78)`,
    `set "CHECKOUT=${batch(spec.checkout)}"`,
    'rem A release swapped in since (ADR 0051) is where Conch runs from now.',
    'set "CURRENT="',
    'if exist "%CONCH_HOME%\\versions\\current" set /p CURRENT=<"%CONCH_HOME%\\versions\\current"',
    'if defined CURRENT if exist "%CURRENT%\\apps\\server\\src\\start.ts" set "CHECKOUT=%CURRENT%"',
    `cd /d "%CHECKOUT%\\apps\\server" || (echo Conch's folder has moved. Run Conch from where it is now and it puts this right. >> "%LOG%" & exit /b 78)`,
    'echo --- %DATE% %TIME% Conch is starting in the background >> "%LOG%"',
    '"%NODE%" --import tsx src\\start.ts >> "%LOG%" 2>&1',
    '',
  ].join('\r\n');
}

/** VBScript string: double quotes doubled. */
const vbs = (value: string) => value.replaceAll('"', '""');

/** Runs the batch file with no window (style 0), and doesn't wait for it. */
export function windowsHidden(launcherCmd: string): string {
  return `CreateObject("WScript.Shell").Run """${vbs(launcherCmd)}""", 0, False\r\n`;
}
