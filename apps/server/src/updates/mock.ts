/**
 * Pretend programs for the mock engine, so E2E runs and visual checks can see
 * Updates in every state without asking a real package manager anything. Their
 * versions live in `CONCH_HOME/mock-programs.json`; "updating" one runs a
 * short Node script that prints progress like winget and moves the version on.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type LatestLookup, type NeedSpec, Setup } from '../setup/needs';

const PROGRAMS = [
  { id: 'mock-claude', short: 'Claude Code', installed: '2.1.284', latest: '2.1.284' },
  { id: 'mock-codex', short: 'Codex', installed: '0.159.0', latest: '0.160.0' },
  { id: 'mock-op', short: '1Password CLI', installed: '2.31.0', latest: '2.31.0' },
  { id: 'mock-uv', short: 'uv', installed: '0.8.3', latest: '0.8.4' },
];

/** Moves one program to its newest version over a few seconds, printing progress. */
const updater = (file: string, id: string, latest: string, ms: number) => `
const fs = require('fs');
const file = ${JSON.stringify(file)};
let n = 0;
const tick = setInterval(() => {
  n += 1;
  console.log('  ' + '#'.repeat(n * 2) + ' ' + (n * 10) + '%');
  if (n < 10) return;
  clearInterval(tick);
  let versions = {};
  try { versions = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  versions[${JSON.stringify(id)}] = ${JSON.stringify(latest)};
  fs.writeFileSync(file, JSON.stringify(versions));
  console.log('Successfully installed');
}, ${Math.round(ms / 10)});`;

export function mockPrograms(
  home: string,
  { ms = 4_000 }: { ms?: number } = {},
): { specs: Map<string, NeedSpec>; setup: Setup; lookup: LatestLookup } {
  const file = join(home, 'mock-programs.json');
  const versions = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const specs = new Map<string, NeedSpec>(
    PROGRAMS.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.short,
        short: p.short,
        find: () => Promise.resolve(join(home, 'mock-bin', p.id)),
        version: async () => (await versions())[p.id] ?? p.installed,
        latest: () => Promise.resolve(p.latest),
        update: () => [{ manager: 'npm', args: ['-e', updater(file, p.id, p.latest, ms)] }],
      },
    ]),
  );
  // The "package manager" is Node itself, running the script above.
  const setup = new Setup(specs, { manager: () => Promise.resolve(process.execPath) });
  const none = () => Promise.resolve(undefined);
  return {
    specs,
    setup,
    lookup: { npm: none, winget: none, brew: none, pypi: none, github: none },
  };
}
