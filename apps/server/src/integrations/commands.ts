import { basename, delimiter, dirname } from 'node:path';

import { findExecutable } from '../lib/proc';

/** The bare program name a command starts (`uvx`, `npx.cmd` → `npx`), or nothing for a path. */
export function programName(command: string): string | undefined {
  if (/[\\/]/.test(command)) return undefined;
  return basename(command)
    .replace(/\.(exe|cmd|bat|ps1)$/i, '')
    .toLowerCase();
}

/** Programs Conch can install for an integration, by the need that brings them. */
const NEEDS: Record<string, string> = { uvx: 'uv', uv: 'uv', docker: 'docker' };

export function needFor(command: string): string | undefined {
  const name = programName(command);
  return name ? NEEDS[name] : undefined;
}

/** Programs that come with Node, which Conch always has (it runs on it). */
const NODE_PROGRAMS = new Set(['node', 'npx', 'npm', 'corepack']);

/**
 * The environment a server that runs with Node needs when Node isn't on PATH:
 * Conch's own Node folder, first. Nothing changes when the computer has one.
 */
export async function nodeFallback(
  command: string,
  env: Record<string, string>,
  find: (name: string) => Promise<string | undefined> = (name) => findExecutable(name),
): Promise<Record<string, string>> {
  const name = programName(command);
  if (!name || !NODE_PROGRAMS.has(name) || (await find(name))) return env;
  const path = [dirname(process.execPath), process.env.PATH ?? ''].filter(Boolean).join(delimiter);
  // Windows names it `Path` as often as `PATH`; two spellings would be two variables.
  const rest = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH'),
  );
  return { ...rest, PATH: path };
}
