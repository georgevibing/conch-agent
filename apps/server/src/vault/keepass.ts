/**
 * Finding KeePassXC databases, so nobody types a path (ADR 0025): the ones
 * KeePassXC itself opened lately (its own settings file), then any `.kdbx`
 * in the places people keep them. Names and paths only; nothing is opened.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface FoundDatabase {
  path: string;
  name: string;
  /** Where it is, for people: "Documents", "iCloud Drive". */
  where: string;
  /** KeePassXC opened it recently. */
  recent: boolean;
  modifiedAt?: number;
}

/** KeePassXC's settings and state files, newest layout first. */
function iniFiles(home: string, platform: NodeJS.Platform): string[] {
  if (platform === 'darwin')
    return [
      join(home, 'Library', 'Caches', 'KeePassXC', 'keepassxc.ini'),
      join(home, 'Library', 'Application Support', 'KeePassXC', 'keepassxc.ini'),
    ];
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(local, 'KeePassXC', 'keepassxc.ini'), join(roaming, 'KeePassXC', 'keepassxc.ini')];
  }
  return [
    join(home, '.cache', 'keepassxc', 'keepassxc.ini'),
    join(home, '.config', 'keepassxc', 'keepassxc.ini'),
  ];
}

/** `LastOpenedDatabases` / `LastActiveDatabase` from a Qt settings file. */
export function recentFromIni(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(LastOpenedDatabases|LastActiveDatabase|LastDatabases)\s*=\s*(.*)$/.exec(
      line.trim(),
    );
    if (!m?.[2]) continue;
    for (const raw of m[2].split(/,\s*/)) {
      const path = raw.trim().replace(/^"|"$/g, '').replace(/\\\\/g, '\\');
      if (/\.kdbx$/i.test(path) && !out.includes(path)) out.push(path);
    }
  }
  return out;
}

/** The folders worth looking in, with the name people know them by. */
function places(home: string): { dir: string; where: string }[] {
  return [
    { dir: join(home, 'Documents'), where: 'Documents' },
    { dir: join(home, 'Desktop'), where: 'Desktop' },
    { dir: join(home, 'Downloads'), where: 'Downloads' },
    {
      dir: join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
      where: 'iCloud Drive',
    },
    { dir: join(home, 'Dropbox'), where: 'Dropbox' },
    { dir: join(home, 'OneDrive'), where: 'OneDrive' },
    { dir: join(home, 'Google Drive'), where: 'Google Drive' },
    { dir: join(home, 'Nextcloud'), where: 'Nextcloud' },
    { dir: join(home, 'Sync'), where: 'Sync' },
    { dir: home, where: 'Home' },
  ];
}

const SKIP = /^(\.|node_modules$|Library$|AppData$|Applications$|Pictures$|Music$|Movies$|Videos$)/;

async function scan(dir: string, depth: number, found: string[], budget: { left: number }) {
  if (depth < 0 || budget.left <= 0 || found.length >= 30) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (--budget.left <= 0) return;
    if (e.isFile() && /\.kdbx$/i.test(e.name)) found.push(join(dir, e.name));
    else if (e.isDirectory() && !SKIP.test(e.name))
      await scan(join(dir, e.name), depth - 1, found, budget);
  }
}

function whereOf(path: string, home: string): string {
  for (const p of places(home)) if (p.dir !== home && path.startsWith(p.dir)) return p.where;
  const parent = dirname(path);
  return parent.startsWith(home) ? parent.slice(home.length + 1) || 'Home' : parent;
}

/** Databases on this computer, the ones KeePassXC opened lately first. */
export async function findDatabases(
  options: { home?: string; platform?: NodeJS.Platform } = {},
): Promise<FoundDatabase[]> {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const recent: string[] = [];
  for (const file of iniFiles(home, platform)) {
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const p of recentFromIni(text)) if (!recent.includes(p)) recent.push(p);
  }
  const scanned: string[] = [];
  const budget = { left: 20_000 };
  for (const p of places(home)) await scan(p.dir, p.dir === home ? 1 : 3, scanned, budget);
  const out: FoundDatabase[] = [];
  for (const path of [...recent, ...scanned]) {
    if (out.some((d) => d.path === path)) continue;
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) continue;
    out.push({
      path,
      name: basename(path).replace(/\.kdbx$/i, ''),
      where: whereOf(path, home),
      recent: recent.includes(path),
      modifiedAt: info.mtimeMs,
    });
  }
  return out.slice(0, 20);
}
