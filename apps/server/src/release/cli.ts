/**
 * `pnpm release` from the terminal (ADR 0051, docs/RELEASING.md). The work is
 * in `run.ts`; this asks its one question on the terminal.
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import { HELP, parseArgs, release } from './run';

const options = parseArgs(process.argv.slice(2));
if ('help' in options) {
  process.stdout.write(HELP);
  process.exit(0);
}
if ('error' in options) {
  console.error(options.error);
  process.exit(1);
}

// pnpm runs this in apps/server; the release is of the whole repository.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  encoding: 'utf8',
}).trim();

const lines = createInterface({ input: process.stdin, output: process.stdout });
const code = await release(options, {
  root,
  say: (line) => void process.stdout.write(`${line}\n`),
  ask: (question) => lines.question(question),
});
lines.close();
process.exit(code);
