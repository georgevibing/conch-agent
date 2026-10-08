import type { EffectGroup } from '@conch/protocol';
import { WhatChanged } from '@conch/nacre';

import { undoIds } from '../chat/telling';
import { askUndo } from './UndoHost';

let asking: { ids: Set<string>; direction: 'undo' | 'redo' } | undefined;

/**
 * Undo (or Redo) these change sets, through the one dialog that shows what
 * will change (ADR 0030). Asked together in the same moment ("Undo all"),
 * they open as one.
 */
function ask(key: string, direction: 'undo' | 'redo'): Promise<void> {
  if (asking && asking.direction !== direction) asking = undefined;
  if (!asking) {
    const batch = (asking = { ids: new Set<string>(), direction });
    queueMicrotask(() => {
      if (asking === batch) asking = undefined;
      askUndo([...batch.ids], batch.direction);
    });
  }
  for (const id of undoIds(key)) asking.ids.add(id);
  // The dialog takes it from here; the line says "Undone" once the files are back.
  return Promise.resolve();
}

/**
 * What a turn changed (ADR 0103), at the end of its reply: one quiet line
 * that opens to each change, with Undo and Redo for what a change set can
 * put back. Nothing at all when the turn changed nothing.
 */
export function TurnChanges({
  groups,
  undone,
}: {
  groups: EffectGroup[];
  /** Undo keys (`undoIds`) whose change sets are all undone. */
  undone: ReadonlySet<string>;
}) {
  if (groups.length === 0) return null;
  return (
    <WhatChanged
      groups={groups}
      undone={undone}
      onUndo={(key) => ask(key, 'undo')}
      onRedo={(key) => ask(key, 'redo')}
    />
  );
}
