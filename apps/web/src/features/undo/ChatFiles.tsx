import { Button, FilesChanged } from '@conch/nacre';

import type { TranscriptItem } from '../../live/reducer';
import { askUndo } from './UndoHost';

type FilesItem = Extract<TranscriptItem, { kind: 'files' }>;

/**
 * What the assistant changed, in the chat (ADR 0030): Undo for this change;
 * on the turn's last change, Undo for everything the turn did.
 */
export function ChatFiles({ item, turn }: { item: FilesItem; turn?: FilesItem[] }) {
  const undoable = turn?.filter((t) => t.state === 'applied') ?? [];
  return (
    <FilesChanged
      files={item.files}
      state={item.state}
      aria-label={item.label}
      onUndo={() => askUndo([item.id], 'undo')}
      onRedo={() => askUndo([item.id], 'redo')}
      turn={
        undoable.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => askUndo(undoable.map((t) => t.id))}>
            Undo all {undoable.length} changes from this turn
          </Button>
        )
      }
    />
  );
}

/** Each turn's file changes, keyed by its last one: where "Undo all" goes. */
export function turnChanges(items: TranscriptItem[]): Map<string, FilesItem[]> {
  const out = new Map<string, FilesItem[]>();
  let turn: FilesItem[] = [];
  const close = () => {
    const last = turn.at(-1);
    if (last) out.set(last.id, turn);
    turn = [];
  };
  for (const item of items) {
    if (item.kind === 'user') close();
    else if (item.kind === 'files') turn.push(item);
  }
  close();
  return out;
}
