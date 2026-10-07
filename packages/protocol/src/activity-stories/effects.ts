/**
 * What a story or a turn changed, merged for its "What changed" list: what
 * other people see first (a message sent, something bought or deleted, code
 * pushed), then commits, files, installs, events and things published. A file
 * touched many times counts once.
 */
import type { ActivityEffect } from '../activity';
import type { StoryStep } from '../activity-stories';

export type EffectKind = ActivityEffect['kind'];

/** One kind of change, said once: "Changed 4 files", with each file under it. */
export interface EffectGroup {
  kind: EffectKind;
  text: string;
  items: ActivityEffect[];
}

/** Most consequential first. */
export const EFFECT_ORDER: readonly EffectKind[] = [
  'send',
  'purchase',
  'delete',
  'push',
  'commit',
  'file',
  'install',
  'schedule',
  'publish',
  'other',
];

/** Kinds said as one line when there are many; the rest stay one line each. */
const MERGED = new Set<EffectKind>(['file', 'commit', 'install']);

function firstWord(text: string): string {
  return text.trim().split(/\s+/)[0] ?? '';
}

function count(kind: EffectKind, items: readonly ActivityEffect[]): string {
  const n = items.length;
  const verbs = [...new Set(items.map((e) => firstWord(e.text)))];
  const verb = verbs.length === 1 ? verbs[0] : undefined;
  switch (kind) {
    case 'file':
      return `${verb ?? 'Changed'} ${n} files`;
    case 'commit':
      return `Made ${n} commits`;
    case 'push':
      return `Pushed to ${n} places`;
    case 'install':
      return `${verb ?? 'Installed'} ${n} packages`;
    case 'send':
      return `${verb ?? 'Sent'} ${n} messages`;
    case 'purchase':
      return `Made ${n} purchases`;
    case 'delete':
      return `Deleted ${n} things`;
    case 'schedule':
      return `${verb ?? 'Scheduled'} ${n} events`;
    case 'publish':
      return `${verb ?? 'Published'} ${n} files`;
    case 'other':
      return `${n} other changes`;
  }
}

/** The effects every step listed, in order. */
export function stepEffects(steps: readonly StoryStep[]): ActivityEffect[] {
  return steps.flatMap((s) => s.label.effects ?? []);
}

function identity(e: ActivityEffect): string {
  return e.target !== undefined ? `t:${e.target}` : `x:${e.text}`;
}

/**
 * Effects grouped by kind, most consequential first. The same file (or
 * branch, or package) counts once: its latest words stand, except that a file
 * created and then changed is still said to be created.
 */
export function groupEffects(effects: readonly ActivityEffect[]): EffectGroup[] {
  const byKind = new Map<EffectKind, Map<string, ActivityEffect>>();
  for (const e of effects) {
    let items = byKind.get(e.kind);
    if (!items) byKind.set(e.kind, (items = new Map()));
    const id =
      e.kind === 'send' || e.kind === 'purchase' ? `${identity(e)}\u0000${e.text}` : identity(e);
    const was = items.get(id);
    if (!was) {
      items.set(id, e);
      continue;
    }
    // Created, then changed: still created. Changed, then deleted: deleted.
    const keep =
      /^(created|added|wrote)\b/i.test(was.text) && !/^(deleted|removed)\b/i.test(e.text);
    const next = keep ? { ...was } : { ...e };
    const undo = e.undo ?? was.undo;
    if (undo !== undefined) next.undo = undo;
    items.set(id, next);
  }
  return EFFECT_ORDER.flatMap((kind) => {
    const items = [...(byKind.get(kind)?.values() ?? [])];
    if (items.length === 0) return [];
    const text = items.length === 1 ? (items[0] as ActivityEffect).text : count(kind, items);
    return [{ kind, text, items }];
  });
}

/**
 * Effects merged for a short list: many files, commits or installs become one
 * line ("Changed 4 files"); anything other people see stays one line each.
 */
export function mergeEffects(effects: readonly ActivityEffect[]): ActivityEffect[] {
  return groupEffects(effects).flatMap((g): ActivityEffect[] => {
    if (g.items.length === 1 || !MERGED.has(g.kind)) return g.items;
    const undos = [...new Set(g.items.map((e) => e.undo))];
    const targets = [...new Set(g.items.map((e) => e.target))];
    const merged: ActivityEffect = { kind: g.kind, text: g.text };
    if (targets.length === 1 && targets[0] !== undefined) merged.target = targets[0];
    if (undos.length === 1 && undos[0] !== undefined) merged.undo = undos[0];
    return [merged];
  });
}
