import { RememberedNote, toast } from '@conch/nacre';
import type { ToolLabel } from '@conch/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import { memoryApi } from '../memory/api';

type Memory = Extract<TranscriptItem, { kind: 'memory' }>;
type Tool = Extract<TranscriptItem, { kind: 'tool' }>;

/** One that waited for your OK (the memory check's card, ADR 0087), whatever you answered. */
const asked = (item: Memory) => item.action === 'saved' && Boolean(item.held || item.pending);

/**
 * A memory it kept or forgot, told as a step like every other (ADR 0103):
 * not one still asking, whose card stands alone until you've answered it.
 */
export const isMemoryStep = (item: TranscriptItem): item is Memory =>
  item.kind === 'memory' && (!asked(item) || item.decided !== undefined);

/** The step's words: what it did, and what you said since. */
function labelOf(item: Memory): ToolLabel {
  const forgot = item.action === 'forgotten';
  // Asked and turned down: it was never remembered, so there's nothing to call undone.
  if (asked(item) && item.decided === 'undone')
    return {
      family: 'remember',
      doing: 'Remembering something',
      done: 'Didn’t remember something',
    };
  const outcome =
    item.decided === 'undone' && !forgot
      ? 'Undone'
      : item.decided === 'kept' && forgot
        ? 'Put back'
        : undefined;
  return {
    family: 'remember',
    doing: forgot ? 'Forgetting something' : 'Remembering something',
    done: forgot ? 'Forgot something' : 'Remembered something',
    ...(outcome && { outcome }),
  };
}

/**
 * Conch's own memory calls never reach the chat as calls (`HostToolRows`):
 * their events do. Each is drawn as the call it was, so it takes its place
 * in the run's stories, glyph, timeline and all. Items are replaced, never
 * changed, so one call per item keeps the stories' words from being worked
 * out again.
 */
const calls = new WeakMap<Memory, Tool>();

export function memoryCall(item: Memory, at: number): Tool {
  let call = calls.get(item);
  if (!call) {
    call = {
      kind: 'tool',
      id: item.id,
      name: item.action === 'forgotten' ? 'mcp__conch__forget' : 'mcp__conch__remember',
      input: { content: item.content },
      status: 'success',
      startedAt: item.at ?? at,
      label: labelOf(item),
    };
    calls.set(item, call);
  }
  return call;
}

/**
 * What the step remembered or forgot, under it once it's opened: the memory
 * in full, and Undo. What you pressed shows at once (and goes back if it
 * didn't work); after a reload, the chat's own log says what you chose.
 */
export function MemoryFound({ item }: { item: Memory }) {
  const client = useQueryClient();
  const [pressed, setPressed] = useState<'undone' | 'kept'>();
  const [busy, setBusy] = useState(false);
  const answer = pressed ?? item.decided;
  const forgot = item.action === 'forgotten';
  const act = async () => {
    const before = pressed;
    setPressed(forgot ? 'kept' : 'undone');
    setBusy(true);
    try {
      // One it forgot goes back exactly as it was; one it remembered is forgotten.
      if (forgot) await memoryApi.restore(item.memoryId);
      else await api.deleteMemory(item.memoryId);
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      setPressed(before);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const putBack = forgot && answer === 'kept';
  const state = putBack ? 'kept' : forgot ? 'forgotten' : answer === 'undone' ? 'undone' : 'kept';
  // Undo while there's something to take back: not once undone, put back, or with nothing kept to restore.
  const undoable = forgot ? Boolean(item.memory) && !putBack : answer !== 'undone';
  return (
    <RememberedNote
      text={item.content}
      state={state}
      busy={busy}
      {...(undoable && { onUndo: () => void act() })}
    />
  );
}
