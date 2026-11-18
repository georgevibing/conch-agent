/**
 * `conch routines …` (ADR 0154): your routines from the terminal, for you and
 * for an agent you run here that's taking some over.
 *
 * - `routines [list] [--json]`: each with its schedule, next run and status.
 * - `routines pause <id|name> [--reason "moved to Hermes"]`: the reason shows
 *   on the Routines page. `routines resume <id|name>` turns it back on.
 * - `routines export [id|name] [--json]`: everything another agent needs to
 *   recreate them (`conch.routines/1`), never a key or a secret.
 *
 * `--json` prints exactly one JSON document, for programs; everything else
 * goes through the terminal kit, for people.
 */
import type { Routine } from '@conch/protocol';

import { ROUTINES_SUBCOMMANDS } from '../cliCommands';
import type { Ui } from '../cli/ui';
import { exportText } from './export';
import type { RoutineAnswer, RoutineAsk } from './terminal';

export interface RoutinesIo {
  ui: Ui;
  /** Exactly as given, for machines (`--json`): never coloured. */
  print: (text: string) => void;
  /** What to tell people to type: `conch routines …` (or `pnpm conch` in a checkout). */
  conch: (args: string) => string;
  /** Asked of the running Conch, or done here when none is running. */
  ask: (ask: RoutineAsk) => Promise<RoutineAnswer>;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1]?.trim() || undefined : undefined;
}

/** The words that aren't flags: `--reason` takes the word after it. */
function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--reason') i++;
    else if (!arg.startsWith('--')) out.push(arg);
  }
  return out;
}

/** "Mon 24 Nov, 07:00" in the routine's own timezone: when it next runs. */
function at(time: number, timeZone: string): string {
  try {
    return new Date(time).toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    });
  } catch {
    return new Date(time).toISOString();
  }
}

const STATUS: Record<Routine['status'], string> = {
  active: 'on',
  paused: 'paused',
  draft: 'not turned on yet',
  completed: 'finished',
};

export async function routinesCommand(args: string[], io: RoutinesIo): Promise<number> {
  const { ui, conch } = io;
  const json = args.includes('--json');
  const [first, ...rest] = positional(args);
  const verb = first ?? 'list';
  const ref = rest.join(' ').trim() || undefined;

  /** A failed answer, in words (or as JSON), with the routines a name fitted. */
  const failed = (answer: Extract<RoutineAnswer, { ok: false }>) => {
    if (json) {
      io.print(JSON.stringify(answer, null, 2));
      return 1;
    }
    ui.error(answer.error);
    for (const c of answer.choices ?? []) ui.hint(`${c.id}  ${c.title} (${c.status})`);
    if (!answer.choices) ui.hint(`See them all: ${ui.code(conch('routines'))}`);
    return 1;
  };

  if (verb === 'help') {
    const width = Math.max(...ROUTINES_SUBCOMMANDS.map((s) => s.usage.length)) + 2;
    for (const sub of ROUTINES_SUBCOMMANDS)
      ui.say(`${ui.accent(sub.usage.padEnd(width))}${ui.dim(sub.summary)}`);
    return 0;
  }

  if (verb === 'list') {
    const answer = await io.ask({ op: 'list' });
    if (!answer.ok) return failed(answer);
    if (!('routines' in answer)) return 1;
    if (json) {
      io.print(
        JSON.stringify(
          answer.routines.map((r) => ({
            id: r.id,
            name: r.title,
            schedule: r.scheduleText,
            timezone: r.timezone,
            status: r.status,
            ...(r.nextRunAt && { nextRunAt: new Date(r.nextRunAt).toISOString() }),
            ...(r.pausedBecause && { pausedBecause: r.pausedBecause }),
          })),
          null,
          2,
        ),
      );
      return 0;
    }
    if (!answer.routines.length) {
      ui.say('No routines yet. Ask Conch in any chat: “every weekday at 8, tell me what’s on”.');
      return 0;
    }
    for (const r of answer.routines) {
      const next =
        r.status === 'active' && r.nextRunAt ? `, next ${at(r.nextRunAt, r.timezone)}` : '';
      const why = r.status === 'paused' && r.pausedBecause ? `: ${r.pausedBecause.reason}` : '';
      ui.say(`${ui.bold(r.title)}  ${ui.dim(r.id)}`);
      ui.hint(
        `${r.scheduleText} (${r.timezone.replaceAll('_', ' ')})${next} · ${STATUS[r.status]}${why}`,
      );
    }
    ui.blank();
    ui.hint(
      `Pause one: ${ui.code(conch('routines pause <name> --reason "…"'))} · for another agent: ${ui.code(conch('routines export --json'))}`,
    );
    return 0;
  }

  if (verb === 'export') {
    const answer = await io.ask({ op: 'export', ...(ref && { ref }) });
    if (!answer.ok) return failed(answer);
    if (!('export' in answer)) return 1;
    if (json) io.print(JSON.stringify(answer.export, null, 2));
    else if (!answer.export.routines.length) ui.say('No routines to export.');
    else io.print(`${exportText(answer.export)}\n`);
    return 0;
  }

  if (verb === 'pause' || verb === 'resume') {
    if (!ref) {
      ui.say(`Which routine would you like to ${verb}?`);
      ui.hint(ui.code(conch(`routines ${verb} <id or name>`)));
      return 1;
    }
    const reason = option(args, '--reason');
    const answer = await io.ask(
      verb === 'pause' ? { op: 'pause', ref, ...(reason && { reason }) } : { op: 'resume', ref },
    );
    if (!answer.ok) return failed(answer);
    if (!('routines' in answer)) return 1;
    const routine = answer.routines[0];
    if (json) {
      io.print(
        JSON.stringify({ ok: true, unchanged: Boolean(answer.unchanged), routine }, null, 2),
      );
      return 0;
    }
    if (!routine) return 1;
    if (verb === 'pause')
      ui.ok(
        answer.unchanged
          ? `“${routine.title}” was already paused.`
          : `Paused “${routine.title}”${routine.pausedBecause ? `: ${routine.pausedBecause.reason}` : ''}.`,
      );
    else
      ui.ok(
        answer.unchanged
          ? `“${routine.title}” is already on.`
          : `“${routine.title}” is on again${routine.nextRunAt ? `, next ${at(routine.nextRunAt, routine.timezone)}` : ''}.`,
      );
    if (verb === 'pause' && !answer.unchanged)
      ui.hint(`Turn it back on: ${ui.code(conch(`routines resume ${routine.id}`))}`);
    return 0;
  }

  ui.error(`“${verb}” isn’t something conch routines does.`);
  ui.hint(`See what it does: ${ui.code(conch('routines help'))}`);
  return 1;
}
