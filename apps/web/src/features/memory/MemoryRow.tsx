import { headlineOf, type Memory, type MemoryHold } from '@conch/protocol';
import { MemoryCell, memorySourceLabels, Textarea, toast, META_SEP } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import { useAutoFocus } from '../../lib/useAutoFocus';

function Editor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ref = useAutoFocus<HTMLTextAreaElement>();
  return (
    <Textarea
      ref={ref}
      autosize
      minRows={1}
      maxRows={6}
      aria-label="Edit memory"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onSave}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSave();
        }
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

/** Where it came from and when, in a few words. */
export function metaOf(memory: Memory): string {
  const from =
    memory.about === 'environment' ? 'About this computer' : memorySourceLabels[memory.source];
  return `${from}${META_SEP}${relativeTime(memory.updatedAt)}`;
}

/**
 * What a memory that waits shows on the page (ADR 0087): the check's own
 * reasons, or, for one held before the check said why, the sentence it was
 * kept with.
 */
export function holdOf(memory: Memory): MemoryHold {
  return (
    memory.held ?? {
      verdict: 'ask',
      reasons: [
        { code: 'outside', words: memory.untrusted ?? 'Conch wasn’t sure about this one.' },
      ],
    }
  );
}

/**
 * One memory on the page: press the words to change them; Forget (or a
 * swipe on a phone) folds it away, with Undo.
 */
export function MemoryRow({ memory, index }: { memory: Memory; index?: number }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.content);
  const refresh = () => void client.invalidateQueries({ queryKey: keys.memories });
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const save = () => {
    setEditing(false);
    const next = value.trim();
    if (!next || next === memory.content) return setValue(memory.content);
    void run(() => api.updateMemory(memory.id, { content: next }));
  };
  const forget = () =>
    void run(async () => {
      await api.deleteMemory(memory.id);
      toast('Forgotten', {
        // In a few words: a toast is no place for a whole paragraph (ADR 0003 § Headlines).
        description: headlineOf(memory),
        action: {
          label: 'Undo',
          onClick: () => void run(() => api.addMemory(memory.content, memory.kind)),
        },
      });
    });

  return (
    <MemoryCell
      kind={memory.kind}
      label={memory.content}
      meta={metaOf(memory)}
      editing={editing}
      onEdit={() => setEditing(true)}
      onForget={forget}
      {...(index !== undefined && { index })}
    >
      {editing ? (
        <Editor
          value={value}
          onChange={setValue}
          onSave={save}
          onCancel={() => {
            setValue(memory.content);
            setEditing(false);
          }}
        />
      ) : (
        memory.content
      )}
    </MemoryCell>
  );
}
