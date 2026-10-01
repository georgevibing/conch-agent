import type { Memory } from '@conch/protocol';
import { Button, IconButton, MemoryItem, Textarea, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { memoryApi } from './api';
import styles from './Memory.module.css';

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

/** One memory: click to edit, Forget to remove; Keep or Forget while it waits for an OK. */
export function MemoryRow({ memory, showKind = false }: { memory: Memory; showKind?: boolean }) {
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
      if (memory.pending) return;
      toast('Forgotten', {
        description: memory.content,
        action: {
          label: 'Undo',
          onClick: () => void run(() => api.addMemory(memory.content, memory.kind)),
        },
      });
    });

  return (
    <MemoryItem
      source={memory.source}
      time={relativeTime(memory.updatedAt)}
      {...(showKind && { kind: memory.kind })}
      {...(memory.pending && { waiting: memory.untrusted ?? 'It waits for your OK.' })}
      actions={
        memory.pending ? (
          <>
            <Button
              size="sm"
              variant="soft"
              onClick={() => void run(() => memoryApi.keep(memory.id))}
            >
              Keep
            </Button>
            <Button size="sm" variant="ghost" tone="neutral" onClick={forget}>
              Forget
            </Button>
          </>
        ) : (
          <>
            <IconButton size="sm" label="Edit" onClick={() => setEditing(true)}>
              <Pencil />
            </IconButton>
            <IconButton size="sm" label="Forget" onClick={forget}>
              <Trash2 />
            </IconButton>
          </>
        )
      }
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
      ) : memory.pending ? (
        memory.content
      ) : (
        <button
          type="button"
          className={styles.memoryText}
          onClick={() => setEditing(true)}
          aria-label={`Edit: ${memory.content}`}
        >
          {memory.content}
        </button>
      )}
    </MemoryItem>
  );
}
