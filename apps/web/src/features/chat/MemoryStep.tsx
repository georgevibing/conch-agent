import { useMemo, useState } from 'react';

import type { TranscriptItem } from '../../live/reducer';
import { HeldMemory } from '../memory/HeldMemory';
import { memoryCall } from './MemorySteps';
import { RunStories } from './Stories';
import { storiesOf } from './telling';

type Memory = Extract<TranscriptItem, { kind: 'memory' }>;

const NO_ASKS = new Map<string, never>();

/**
 * A memory standing on its own in the chat (an answered memory check, what a
 * chat learned once it went quiet), drawn as the step it was (ADR 0103): the
 * same story row as a tool's, the remember glyph in its well, the memory and
 * Undo once it's opened. Never a pill or a line of its own. One among a run's
 * steps joins the run instead (`MemorySteps`).
 */
export function MemoryStep({ item }: { item: Memory }) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  // Told once for what it says, however often it's drawn (a fresh item each time is the same step).
  const { id, memoryId, content, action, decided, at, memory, held, pending } = item;
  const { tools, stories, memories } = useMemo(() => {
    const step: Memory = {
      kind: 'memory',
      id,
      memoryId,
      content,
      action,
      ...(at !== undefined && { at }),
      ...(decided && { decided }),
      ...(memory && { memory }),
      ...(held && { held }),
      ...(pending && { pending }),
    };
    const call = memoryCall(step, at ?? 0);
    const tools = [call];
    return { tools, stories: storiesOf(tools), memories: new Map([[call.id, step]]) };
  }, [id, memoryId, content, action, decided, at, memory, held, pending]);
  return (
    <RunStories
      tools={tools}
      stories={stories}
      asked={NO_ASKS}
      opened={opened}
      onOpen={(id, open) =>
        setOpened((was) => {
          const next = new Set(was);
          if (open) next.add(id);
          else next.delete(id);
          return next;
        })
      }
      memories={memories}
    />
  );
}

/**
 * A memory the check held, asking (ADR 0087, ADR 0097): one card, saying why.
 * Answered, it is its step at once, as it will be once the chat's log says so
 * (then among the run's, `MemorySteps`). Nothing routine waits here.
 */
export function HeldMemoryItem({ item }: { item: Memory }) {
  return (
    <HeldMemory
      memoryId={item.memoryId}
      content={item.content}
      held={
        item.held ?? {
          verdict: 'ask',
          reasons: [{ code: 'outside', words: 'Conch wasn’t sure about this one.' }],
        }
      }
      {...(item.decided && { decided: item.decided })}
      answered={(decided, content) => <MemoryStep item={{ ...item, decided, content }} />}
    />
  );
}
