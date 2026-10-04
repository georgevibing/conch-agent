import type { MemoryHold } from '@conch/protocol';
import { Button, MemoryCheck, Textarea, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { memoryApi } from './api';

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
      aria-label="What to remember, in your words"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSave();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

/**
 * A memory the memory check held, in the chat (ADR 0087): what it wanted to
 * remember, why that looks off, where it came from, and Remember it, Don’t
 * remember or Edit first. A refused one takes Remember anyway. What you
 * choose shows at once, goes back if it didn’t work, and the chat's own log
 * keeps it after a reload.
 */
export function HeldMemory({
  memoryId,
  content,
  held,
  decided,
}: {
  memoryId: string;
  content: string;
  held: MemoryHold;
  decided?: 'kept' | 'undone';
}) {
  const client = useQueryClient();
  const [pressed, setPressed] = useState<{ answer: 'kept' | 'undone'; words: string }>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const editButton = useRef<HTMLButtonElement>(null);
  const refused = held.verdict === 'refuse';
  const answer = pressed?.answer ?? decided;

  const act = async (keep: boolean, words?: string) => {
    const before = pressed;
    setPressed({ answer: keep ? 'kept' : 'undone', words: words ?? content });
    try {
      if (keep)
        await memoryApi.keep(memoryId, {
          ...(words !== undefined && { content: words }),
          ...(refused && words === undefined && { anyway: true }),
        });
      else await api.deleteMemory(memoryId);
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      setPressed(before);
      toast.error((e as Error).message);
    }
  };
  const cancel = () => {
    setEditing(false);
    setDraft(content);
    // Back to where you were.
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const save = () => {
    const words = draft.trim();
    if (!words) return;
    setEditing(false);
    void act(true, words);
  };

  if (answer)
    return (
      <MemoryCheck
        settled={answer === 'kept' ? 'kept' : 'dismissed'}
        content={pressed?.words ?? content}
        reasons={[]}
      />
    );
  return (
    <MemoryCheck
      content={content}
      reasons={held.reasons.map((r) => r.words)}
      {...(held.from && { from: held.from })}
      refused={refused}
      {...(editing && {
        editor: <Editor value={draft} onChange={setDraft} onSave={save} onCancel={cancel} />,
      })}
      actions={
        editing ? (
          <>
            <Button size="sm" variant="soft" onClick={save} disabled={!draft.trim()}>
              Remember this
            </Button>
            <Button size="sm" variant="ghost" tone="neutral" onClick={cancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant={refused ? 'surface' : 'soft'}
              {...(refused && { tone: 'danger' as const })}
              onClick={() => void act(true)}
            >
              {refused ? 'Remember anyway' : 'Remember it'}
            </Button>
            <Button size="sm" variant="ghost" tone="neutral" onClick={() => void act(false)}>
              Don’t remember
            </Button>
            <Button
              ref={editButton}
              size="sm"
              variant="ghost"
              tone="neutral"
              onClick={() => setEditing(true)}
            >
              Edit first
            </Button>
          </>
        )
      }
    />
  );
}
