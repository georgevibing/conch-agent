/**
 * A routine described for another agent to recreate (ADR 0154): `conch
 * routines export`, and **Move to another agent** on a routine's page. What it
 * does, when (with the timezone, and as cron where cron says it exactly),
 * where the result goes and what it uses, read from the routine itself, so an
 * agent never needs to read Conch's files or its source.
 *
 * Never a secret: no hook address, no keys, nothing from Passwords. The
 * instruction is included whole, because it is the routine.
 */
import {
  ROUTINE_EXPORT_FORMAT,
  type ChannelKind,
  type ExportedRoutine,
  type Routine,
  type RoutineExport,
  type Trigger,
} from '@conch/protocol';

import { CHANNEL_NAMES } from '../channels/catalog';
import { nextRuns, toCron } from './schedule';

/** Paths in an instruction: `~/…`, `/Users/…`, `C:\…`, `./…`. */
const PATH = /(?:^|[\s("'`])((?:~|\.{1,2})?\/[\w.@%+~-][\w./@%+~-]*|[A-Za-z]:\\[\w .\\-]+)/g;
const URL_RE = /https?:\/\/[^\s<>"'`)]+/g;

const unique = (list: readonly string[]) => [...new Set(list)];

function pathsIn(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(PATH)) {
    const path = m[1]?.replace(/[.,;:]+$/, '');
    // A bare "/" or a fraction ("1/2") isn't a place.
    if (path && path.length > 2 && !/^\/\d/.test(path)) found.push(path);
  }
  return unique(found);
}

function urlsIn(text: string): string[] {
  return unique([...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, '')));
}

/** A sentence that sends something somewhere: where a chat app's name means delivery. */
const SENDS =
  /\b(?:send|sends|sent|text|message|message_user|post|deliver|notify|tell|ping|dm|email (?:it|me|them))\b/i;

/** The words that name each chat app: its name, and its kind when that's a word people say. */
const CHANNEL_WORDS = (Object.entries(CHANNEL_NAMES) as [ChannelKind, string][])
  .filter(([kind]) => kind !== 'app')
  .map(([kind, name]) => ({
    kind,
    names: unique([name.toLowerCase().split(' / ')[0] ?? name.toLowerCase(), kind]),
  }));

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Chat apps an instruction says to send the result to, by the names people use. */
function channelsIn(text: string): string[] {
  const sending = text
    .split(/(?<=[.!?\n])\s+/)
    .filter((sentence) => SENDS.test(sentence))
    .join(' ');
  return CHANNEL_WORDS.filter(({ kind, names }) =>
    // “line” is an everyday word: only LINE, as the app writes it, means the app.
    kind === 'line'
      ? /\bLINE\b/.test(sending)
      : names.some((name) => new RegExp(`\\b${escape(name)}\\b`, 'i').test(sending)),
  ).map(({ kind }) => kind);
}

/** A trigger without anything that would let someone else knock (a hook's address). */
function portableTrigger(when: Trigger): Trigger {
  if (when.kind === 'hook') return { kind: 'hook' };
  return when;
}

/** Cron that says the schedule exactly, in its own timezone; none for “the last day” or intervals. */
function exactCron(routine: Routine): string | undefined {
  if (routine.schedule.type === 'monthly' && routine.schedule.day === 'last') return undefined;
  return toCron(routine.schedule);
}

export function exportRoutine(routine: Routine, now = Date.now()): ExportedRoutine {
  const when = routine.when ?? undefined;
  const cron = when ? undefined : exactCron(routine);
  const on = routine.status === 'active';
  const next = when
    ? []
    : routine.schedule.type === 'interval'
      ? routine.nextRunAt
        ? [routine.nextRunAt]
        : []
      : on
        ? nextRuns(routine.schedule, routine.timezone, { from: now, count: 3 })
        : [];
  const trigger = when ? portableTrigger(when) : undefined;
  const triggerText = trigger?.kind === 'folder' ? [trigger.path] : [];
  const triggerUrl = trigger?.kind === 'page' ? [trigger.url] : [];
  return {
    id: routine.id,
    name: routine.title,
    summary: routine.summary,
    prompt: routine.prompt,
    status: routine.status,
    ...(routine.pausedBecause && { pausedBecause: routine.pausedBecause }),
    schedule: {
      text: routine.scheduleText,
      timezone: routine.timezone,
      ...(!when && { structured: routine.schedule }),
      ...(cron && { cron }),
      ...(next.length && { next: next.map((t) => new Date(t).toISOString()) }),
    },
    ...(trigger && { when: trigger }),
    ...(routine.onlyIf && { onlyIf: routine.onlyIf }),
    delivery: { conch: true, channels: channelsIn(routine.prompt) },
    uses: {
      paths: unique([...triggerText, ...pathsIn(routine.prompt)]),
      urls: unique([...triggerUrl, ...urlsIn(routine.prompt)]),
      ...(routine.options.engine && { engine: routine.options.engine }),
      ...(routine.options.model && { model: routine.options.model }),
    },
    trust: routine.trust,
    catchUp: routine.catchUp,
  };
}

export function exportRoutines(routines: readonly Routine[], now = Date.now()): RoutineExport {
  return {
    format: ROUTINE_EXPORT_FORMAT,
    exportedAt: new Date(now).toISOString(),
    routines: routines.map((r) => exportRoutine(r, now)),
  };
}

/** The same, for a person to read or paste into another agent: Markdown, one section each. */
export function exportText(exported: RoutineExport): string {
  const blocks = exported.routines.map((r) => {
    const lines = [
      `## ${r.name}`,
      '',
      r.summary,
      '',
      `- When: ${r.schedule.text} (${r.schedule.timezone})${r.schedule.cron ? `, cron \`${r.schedule.cron}\`` : ''}`,
      ...(r.onlyIf ? [`- Only if: ${r.onlyIf}`] : []),
      `- Status: ${r.status}${r.pausedBecause ? ` (${r.pausedBecause.reason})` : ''}`,
      `- Result goes to: Conch's history${r.delivery.channels.length ? `, and ${r.delivery.channels.join(', ')}` : ''}`,
      ...(r.uses.paths.length ? [`- Files: ${r.uses.paths.join(', ')}`] : []),
      ...(r.uses.urls.length ? [`- Pages: ${r.uses.urls.join(', ')}`] : []),
      `- Id in Conch: ${r.id}`,
      '',
      'Instructions:',
      '',
      ...r.prompt.split('\n').map((line) => `> ${line}`),
    ];
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}
