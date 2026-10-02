/**
 * Repair everything's look at memory (ADR 0032, ADR 0041): the search index,
 * Conch's own model for meaning, what waits for your OK, the tidy-up.
 */
import type { DoctorItem } from '@conch/protocol';

import type { Doctor } from '../doctor/service';
import type { MemoryIndex } from './index';
import type { OnDeviceModel } from './ondevice';
import type { MemoryStore } from './store';
import type { MemoryTidy } from './tidy';

const GROUP = 'Your data';

export function registerLearningDoctor(
  doctor: Pick<Doctor, 'register'>,
  deps: {
    index: MemoryIndex;
    store: MemoryStore;
    tidy: MemoryTidy;
    model?: Model;
    reindex?: () => Promise<void>;
  },
): void {
  doctor.register({
    id: 'memory',
    group: GROUP,
    title: 'Memory',
    async run({ repair }) {
      const items: DoctorItem[] = [];
      const model = deps.model && (await modelItem(deps.model, repair, deps.reindex));
      if (model) items.push(model);
      const status = await deps.index.status().catch(() => undefined);
      if (!status) {
        if (repair) await deps.index.rebuild().catch(() => undefined);
        items.push({
          id: 'memory:index',
          group: GROUP,
          title: 'Memory search',
          state: repair ? 'fixed' : 'warning',
          message: repair ? 'Conch built memory search again.' : 'Memory search couldn’t be read.',
        });
      } else if (status.mode === 'meaning' && status.indexed < status.total) {
        if (repair) await deps.index.sync();
        const after = repair ? await deps.index.status() : status;
        items.push({
          id: 'memory:index',
          group: GROUP,
          title: 'Memory search',
          state: after.indexed < after.total ? 'warning' : repair ? 'fixed' : 'ok',
          message:
            after.indexed < after.total
              ? `${after.total - after.indexed} memories aren’t searchable by meaning yet.`
              : 'Every memory is searchable by meaning.',
        });
      } else
        items.push({
          id: 'memory:index',
          group: GROUP,
          title: 'Memory search',
          state: 'ok',
          message:
            status.mode === 'meaning'
              ? `Searches by meaning, with ${status.model} on this computer.`
              : 'Searches by words and spellings.',
        });
      const waiting = (await deps.store.list()).filter((m) => m.pending).length;
      if (waiting)
        items.push({
          id: 'memory:pending',
          group: GROUP,
          title: 'Memories to look at',
          state: 'needs-you',
          message:
            waiting === 1
              ? 'One memory waits for your OK: it was learned in a chat that read something from outside.'
              : `${waiting} memories wait for your OK: they were learned in chats that read something from outside.`,
          action: { kind: 'open', label: 'Look at them', place: 'memory' },
        });
      const last = (await deps.tidy.status()).runs[0];
      if (last?.problem)
        items.push({
          id: 'memory:tidy',
          group: GROUP,
          title: 'Memory tidy-up',
          state: 'warning',
          message: last.problem,
          action: { kind: 'open', label: 'Open memory', place: 'memory' },
        });
      return items;
    },
  });
}

type Model = Pick<OnDeviceModel, 'wanted' | 'check' | 'get' | 'status' | 'retryRun' | 'embedder'>;

/**
 * Conch's own model, once the person asked for it: every file as expected,
 * and it runs here. Getting it again is safe to do unasked — they already
 * said yes, and the files are pinned by hash.
 */
async function modelItem(
  model: Model,
  repair: boolean,
  reindex?: () => Promise<void>,
): Promise<DoctorItem | undefined> {
  if (!(await model.wanted()) || model.status().getting !== undefined) return undefined;
  const base = { id: 'memory:model', group: GROUP, title: 'Meaning model' } as const;
  const state = await model.check({ fresh: true });
  if (state === 'ok') {
    const problem = model.status().problem;
    if (!problem) return undefined;
    if (!repair) return { ...base, state: 'warning', message: problem };
    // It wouldn't run: try once more (an update may have fixed it).
    model.retryRun();
    try {
      await (await model.embedder())?.embed(['hello']);
      await reindex?.().catch(() => undefined);
      return { ...base, state: 'fixed', message: 'The meaning model runs again.' };
    } catch {
      return { ...base, state: 'warning', message: model.status().problem ?? problem };
    }
  }
  if (!repair)
    return {
      ...base,
      state: 'warning',
      message: 'Part of the model that lets search understand meaning is missing or damaged.',
    };
  try {
    await model.get([]);
  } catch {
    return {
      ...base,
      state: 'warning',
      message: model.status().problem ?? 'Conch couldn’t get the meaning model again.',
      action: { kind: 'open', label: 'Open memory', place: 'memory' },
    };
  }
  await reindex?.().catch(() => undefined);
  return { ...base, state: 'fixed', message: 'Conch got the meaning model again.' };
}
