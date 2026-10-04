/**
 * Connecting another app in one press (ADR 0073): Conch writes itself into
 * Claude Desktop's, Cursor's or VS Code's own settings file, after you press
 * Connect and confirm it's you, and takes itself out again when you remove it.
 *
 * - Only Conch's own entry is ever written or removed. Everything else in the
 *   file stays as it was, and the file as it was is kept beside it
 *   (`<file>.before-conch`), once.
 * - A file Conch can't read as plain JSON (comments, a typo) is left alone: the
 *   person gets the entry to add themselves.
 * - The entry starts Conch's launcher with the app's id. No key or token is in
 *   it (an app's settings are read by more programs than the app).
 */
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { McpClientApp } from '@conch/protocol';

import { writeFileAtomic } from '../lib/fs';

export type TargetApp = Exclude<McpClientApp, 'other'>;

export const TARGET_NAMES: Record<TargetApp, string> = {
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code',
};

/** The name Conch's entry goes under in each app's list of servers. */
export const ENTRY = 'conch';

type Env = Record<string, string | undefined>;

export interface Place {
  /** The app's settings folder: its being there means the app is. */
  dir: string;
  file: string;
  /** Where servers are listed in it: `mcpServers` (most) or `servers` (VS Code). */
  key: 'mcpServers' | 'servers';
}

/** Where each app keeps its MCP servers, on this computer. */
export function placeOf(
  app: TargetApp,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env: Env = process.env,
): Place {
  const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const config = env.XDG_CONFIG_HOME ?? join(home, '.config');
  const support = join(home, 'Library', 'Application Support');
  switch (app) {
    case 'claude-desktop': {
      let dir =
        platform === 'win32'
          ? join(appData, 'Claude')
          : platform === 'darwin'
            ? join(support, 'Claude')
            : join(config, 'Claude');
      // The Microsoft Store's Claude keeps its settings in its own package folder.
      if (platform === 'win32' && !existsSync(dir)) {
        const packages = join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Packages');
        const store = safeList(packages).find((name) => name.startsWith('Claude_'));
        if (store) dir = join(packages, store, 'LocalCache', 'Roaming', 'Claude');
      }
      return { dir, file: join(dir, 'claude_desktop_config.json'), key: 'mcpServers' };
    }
    case 'cursor': {
      const dir = join(home, '.cursor');
      return { dir, file: join(dir, 'mcp.json'), key: 'mcpServers' };
    }
    case 'vscode': {
      const dir =
        platform === 'win32'
          ? join(appData, 'Code', 'User')
          : platform === 'darwin'
            ? join(support, 'Code', 'User')
            : join(config, 'Code', 'User');
      return { dir, file: join(dir, 'mcp.json'), key: 'servers' };
    }
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** How the app starts Conch's launcher. */
export interface Launch {
  command: string;
  args: string[];
}

export function launchFor(launcher: string, client: string, node = process.execPath): Launch {
  return { command: node, args: [launcher, '--client', client] };
}

/** The entry, as each app's file wants it. */
export function entryFor(app: TargetApp, launch: Launch): Record<string, unknown> {
  return app === 'vscode'
    ? { type: 'stdio', command: launch.command, args: launch.args }
    : { command: launch.command, args: launch.args };
}

/** An entry Conch wrote: it starts Conch's launcher. */
export function isOurs(entry: unknown): entry is { command: string; args: string[] } {
  if (!entry || typeof entry !== 'object') return false;
  const args = (entry as { args?: unknown }).args;
  return (
    Array.isArray(args) &&
    args.some((a) => typeof a === 'string' && /[\\/]mcp[\\/]launcher\.mjs$/.test(a)) &&
    args.includes('--client')
  );
}

/** The paired app an entry names, when it's ours. */
export function clientOf(entry: unknown): string | undefined {
  if (!isOurs(entry)) return undefined;
  const at = entry.args.indexOf('--client');
  return at === -1 ? undefined : entry.args[at + 1];
}

export class TargetError extends Error {
  constructor(
    message: string,
    /** The entry to add by hand, when Conch wouldn't change the file itself. */
    readonly snippet?: string,
  ) {
    super(message);
  }
}

type Settings = Record<string, unknown>;

async function readSettings(place: Place): Promise<{ settings: Settings; existed: boolean }> {
  let text: string;
  try {
    text = await readFile(place.file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { settings: {}, existed: false };
    throw error;
  }
  if (!text.trim()) return { settings: {}, existed: true };
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('not an object');
  return { settings: parsed as Settings, existed: true };
}

function serversOf(settings: Settings, key: Place['key']): Settings {
  const servers = settings[key];
  return servers && typeof servers === 'object' && !Array.isArray(servers)
    ? (servers as Settings)
    : {};
}

/** What's in the app's settings for Conch now. */
export async function look(
  place: Place,
): Promise<{ found: boolean; entry?: unknown; name?: string }> {
  if (!existsSync(place.dir)) return { found: false };
  try {
    const { settings } = await readSettings(place);
    const servers = serversOf(settings, place.key);
    const name = Object.keys(servers).find((n) => isOurs(servers[n]));
    return { found: true, ...(name && { entry: servers[name], name }) };
  } catch {
    return { found: true };
  }
}

/** Write Conch's entry into the app's settings, leaving everything else as it was. */
export async function connect(app: TargetApp, place: Place, launch: Launch): Promise<void> {
  const entry = entryFor(app, launch);
  const snippet = JSON.stringify({ [place.key]: { [ENTRY]: entry } }, null, 2);
  if (!existsSync(place.dir))
    throw new TargetError(`${TARGET_NAMES[app]} isn’t on this computer.`, snippet);
  let read: { settings: Settings; existed: boolean };
  try {
    read = await readSettings(place);
  } catch {
    throw new TargetError(
      `Conch couldn’t read ${TARGET_NAMES[app]}’s settings file, so it left it as it is. Add this to it yourself:`,
      snippet,
    );
  }
  const servers = serversOf(read.settings, place.key);
  // Ours already (an older pairing) is replaced; someone else's `conch` is left alone.
  const mine = Object.keys(servers).find((name) => isOurs(servers[name]));
  const name = mine ?? (servers[ENTRY] === undefined ? ENTRY : `${ENTRY}-assistant`);
  if (read.existed && !existsSync(`${place.file}.before-conch`))
    await copyFile(place.file, `${place.file}.before-conch`).catch(() => undefined);
  const next = { ...read.settings, [place.key]: { ...servers, [name]: entry } };
  await writeFileAtomic(place.file, `${JSON.stringify(next, null, 2)}\n`, 0o600);
}

/** Take Conch's entry out of the app's settings (only one Conch wrote, for this client). */
export async function disconnect(place: Place, client?: string): Promise<boolean> {
  if (!existsSync(place.file)) return false;
  let read: { settings: Settings; existed: boolean };
  try {
    read = await readSettings(place);
  } catch {
    return false;
  }
  const servers = serversOf(read.settings, place.key);
  const names = Object.keys(servers).filter(
    (name) => isOurs(servers[name]) && (!client || clientOf(servers[name]) === client),
  );
  if (!names.length) return false;
  const kept = Object.fromEntries(
    Object.entries(servers).filter(([name]) => !names.includes(name)),
  );
  await writeFileAtomic(
    place.file,
    `${JSON.stringify({ ...read.settings, [place.key]: kept }, null, 2)}\n`,
    0o600,
  );
  return true;
}
