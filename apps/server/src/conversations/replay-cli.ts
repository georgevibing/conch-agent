/**
 * `pnpm auto:replay`: how often Auto's rules would ask, on this computer's own chats (ADR 0150).
 *
 *   pnpm auto:replay                     every chat under CONCH_HOME (or ~/.conch)
 *   pnpm auto:replay --since 30d         only the last 30 days (also 12h, 2w, or a date)
 *   pnpm auto:replay --home <dir>        another Conch's folder (a copy, a backup unpacked)
 *   pnpm auto:replay --json              the numbers as JSON
 *   pnpm auto:replay --examples          with a few redacted examples of what would ask
 *
 * Read only and offline: no model, no network, nothing written. Numbers and kinds only, unless
 * `--examples`, and those go through the secret scrubbers first.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { replay, sinceFrom, type ReplayReport } from './replay';

const { values: args } = parseArgs({
  options: {
    home: { type: 'string' },
    since: { type: 'string' },
    json: { type: 'boolean', default: false },
    examples: { type: 'boolean', default: false },
  },
});

const out = (line = '') => process.stdout.write(`${line}\n`);
// pnpm runs this from the server's folder; a folder you name is from where you typed it.
const typedIn = process.env.INIT_CWD ?? process.cwd();
const home = resolve(typedIn, args.home ?? process.env.CONCH_HOME ?? join(homedir(), '.conch'));
const since = args.since === undefined ? undefined : sinceFrom(args.since);
if (args.since !== undefined && since === undefined) {
  process.stderr.write(`--since takes 30d, 12h, 2w or a date, not “${args.since}”.\n`);
  process.exit(2);
}

const report = await replay({
  home,
  ...(since !== undefined && { since }),
  examples: args.examples,
});
if (args.json) out(JSON.stringify(report, null, 2));
else print(report);

function print(r: ReplayReport) {
  const n = (x: number) => x.toLocaleString('en');
  const pad = (text: string, width: number) => text.padEnd(width);
  const right = (x: number, width: number) => n(x).padStart(width);
  out(
    `Auto, replayed on ${n(r.chats)} ${r.chats === 1 ? 'chat' : 'chats'}${r.since ? ` since ${new Date(r.since).toISOString().slice(0, 10)}` : ''}`,
  );
  out();
  out(
    `  ${n(r.steps.total)} ${r.steps.total === 1 ? 'step' : 'steps'}: ${n(r.steps.beforeReading)} before the chat read anything from outside, ${n(r.steps.afterReading)} after`,
  );
  out(
    `  The rules would ask ${r.per100.beforeReading} in 100 before reading, ${r.per100.afterReading} in 100 after (${r.per100.overall} overall)`,
  );
  if (r.stops) out(`  ${n(r.stops)} stopped by a pattern in every mode`);
  const modes = Object.entries(r.steps.byMode).sort((a, b) => b[1] - a[1]);
  if (modes.length) out(`  By mode: ${modes.map(([m, c]) => `${m} ${n(c)}`).join(', ')}`);
  if (r.kinds.length) {
    out();
    out(`  ${pad('What would ask', 22)}${'before'.padStart(8)}${'after'.padStart(8)}`);
    for (const k of r.kinds)
      out(`  ${pad(k.reason, 22)}${right(k.beforeReading, 8)}${right(k.afterReading, 8)}`);
  }
  if (r.answers.length) {
    out();
    out(
      `  ${pad('What people answered', 22)}${'asked'.padStart(8)}${'in Auto'.padStart(9)}${'allowed'.padStart(9)}${'denied'.padStart(8)}${'no answer'.padStart(11)}`,
    );
    for (const a of r.answers)
      out(
        `  ${pad(a.reason, 22)}${right(a.asked, 8)}${right(a.inAuto, 9)}${right(a.allowed, 9)}${right(a.denied, 8)}${right(a.unanswered, 11)}`,
      );
  }
  if (r.examples?.length) {
    out();
    out('  Examples (redacted)');
    for (const e of r.examples)
      out(
        `  ${e.reason}, ${e.reading} reading, ${e.tool}: ${e.step}${e.rule ? ` (${e.rule})` : ''}`,
      );
  }
  if (r.lines.unreadable) {
    out();
    out(
      `  ${n(r.lines.unreadable)} of ${n(r.lines.read)} lines couldn’t be read, and were skipped.`,
    );
  }
  if (!r.chats) {
    out();
    out(`  No chats in ${home}. Name another folder with --home.`);
  }
}
