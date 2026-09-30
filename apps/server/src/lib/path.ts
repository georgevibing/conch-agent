/**
 * The PATH as it is now, not as it was when Conch started.
 *
 * A running process keeps the PATH it was started with. On Windows, anything
 * installed afterwards (winget, npm, an installer) lands in the registry's
 * PATH, and Conch wouldn't see it until restarted — so “Install Node, then try
 * again” would fail however often you tried. `refreshPath` reads the user and
 * machine PATH from the registry and adds any folder Conch doesn't have yet to
 * `process.env.PATH`, so both Conch and the programs it starts find it.
 */
import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { delimiter } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Registry reads are cheap but not free; programs aren't installed every second. */
const FRESH_FOR_MS = 5_000;

const KEYS = [
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  'HKCU\\Environment',
];

/** `reg query` output → the values it lists (`Path REG_EXPAND_SZ C:\…;%X%`). */
export function parseRegValues(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s{2,}(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2].trim();
  }
  return values;
}

/** `%NAME%` expanded the way Windows does, from `vars` (names ignore case). */
export function expandVars(text: string, vars: Record<string, string | undefined>): string {
  const lookup = (name: string) =>
    Object.entries(vars).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
  return text.replace(/%([^%]+)%/g, (whole, name: string) => lookup(name) ?? whole);
}

/**
 * Folders in `extra` that `current` doesn't have yet (Windows compares without
 * case or trailing slashes). `separator` is Windows' `;` whatever this machine
 * uses: `C:\Tools` would fall apart on a `:`.
 */
export function missingDirs(current: string, extra: string[], separator = ';'): string[] {
  const key = (dir: string) => dir.replace(/[\\/]+$/, '').toLowerCase();
  const have = new Set(current.split(separator).filter(Boolean).map(key));
  const out: string[] = [];
  for (const dir of extra) {
    const k = key(dir);
    if (!dir || have.has(k) || dir.includes('%')) continue;
    have.add(k);
    out.push(dir);
  }
  return out;
}

async function registryPath(): Promise<string[]> {
  const found: Record<string, string>[] = [];
  for (const key of KEYS) {
    try {
      const { stdout } = await exec('reg.exe', ['query', key], {
        timeout: 5_000,
        windowsHide: true,
      });
      found.push(parseRegValues(stdout));
    } catch {
      // A key that can't be read just adds nothing.
    }
  }
  // Variables the PATH refers to (%NVM_HOME%, %PNPM_HOME%) may be registry-only too.
  const vars: Record<string, string | undefined> = { ...process.env };
  for (const values of found)
    for (const [name, value] of Object.entries(values))
      if (name.toUpperCase() !== 'PATH') vars[name] = expandVars(value, vars);
  return found.flatMap((values) =>
    expandVars(values.Path ?? values.PATH ?? '', vars)
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean),
  );
}

let checkedAt = 0;
let running: Promise<string[]> | undefined;

/**
 * Pick up folders added to the PATH since Conch started. Returns the folders
 * it added (usually none). Windows only; elsewhere the PATH a program gets is
 * the one it's started with, and `commonBinDirs` covers the usual installers.
 */
export function refreshPath(options: { force?: boolean } = {}): Promise<string[]> {
  if (platform() !== 'win32') return Promise.resolve([]);
  if (!options.force && Date.now() - checkedAt < FRESH_FOR_MS) return Promise.resolve([]);
  running ??= registryPath()
    .then((dirs) => {
      checkedAt = Date.now();
      const added = missingDirs(process.env.PATH ?? '', dirs);
      if (added.length)
        process.env.PATH = [process.env.PATH ?? '', ...added].filter(Boolean).join(delimiter);
      return added;
    })
    .catch(() => [])
    .finally(() => (running = undefined));
  return running;
}
