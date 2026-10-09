/**
 * `pnpm release` from the terminal (ADR 0127, docs/RELEASING.md). The work
 * is in `commands.ts`; this answers its questions on the terminal.
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';

import { main } from './commands';

// pnpm runs this in apps/server; releases are of the whole repository.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  encoding: 'utf8',
}).trim();

const lines = createInterface({ input: process.stdin, output: process.stdout });
const code = await main(process.argv.slice(2), {
  root,
  say: (line) => void process.stdout.write(`${line}\n`),
  ask: (question) => lines.question(question),
  home: homedir(),
  env: process.env,
});
lines.close();
process.exit(code);
