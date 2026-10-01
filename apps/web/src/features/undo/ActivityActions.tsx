import type { ActivityEntry, Memory } from '@conch/protocol';
import { Button, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Redo2, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { askUndo } from './UndoHost';

/**
 * The one thing to do about an Activity row (ADR 0030): Undo or Redo what it
 * changed in your files, or Forget (or bring back) what it remembered.
 */
export function ActivityAction({ entry, memories }: { entry: ActivityEntry; memories?: Memory[] }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const where = entry.title;
  if (entry.undo) {
    if (entry.undo.state === 'expired') return null;
    const undone = entry.undo.state === 'undone';
    return (
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={undone ? <Redo2 /> : <Undo2 />}
        aria-label={`${undone ? 'Redo' : 'Undo'}: ${where}`}
        onClick={() => askUndo([entry.undo?.changeSetId ?? ''], undone ? 'redo' : 'undo')}
      >
        {undone ? 'Redo' : 'Undo'}
      </Button>
    );
  }
  const memory = entry.memory;
  if (!memory || !memories) return null;
  const kept = memories.some((m) => m.id === memory.id || m.content === memory.content);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await client.invalidateQueries({ queryKey: keys.memories });
    } catch {
      toast.error('That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  if (memory.action === 'saved' && kept) {
    const current = memories.find((m) => m.id === memory.id || m.content === memory.content);
    return (
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        aria-label={`Forget: ${memory.content}`}
        onClick={() => void run(() => api.deleteMemory(current?.id ?? memory.id), 'Forgotten')}
      >
        Forget
      </Button>
    );
  }
  if (!kept)
    return (
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        aria-label={`Remember again: ${memory.content}`}
        onClick={() => void run(() => api.addMemory(memory.content), 'Remembered again')}
      >
        Remember again
      </Button>
    );
  return null;
}
