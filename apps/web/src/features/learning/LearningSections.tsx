import { Dialog, MemoryCell, MemoryCells, NeverList, Text, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { relativeTime } from '../../lib/time';
import { learningApi, learningKeys, useLearning } from './api';

/** The `memoryIntent` that opens Won't learn again as the page opens (⌘K). */
export const NEVER_INTENT = 'never';

/** "Until August 2026". */
function until(at: number): string {
  return `Until ${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(at)}`;
}

/** One press, then the record again: busy while it runs, a toast if it didn't work. */
function useAct() {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await action();
      void client.invalidateQueries({ queryKey: learningKeys.all });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return { busy, act };
}

/** Things Conch won't learn again (ADR 0088): each you took back once, with Remove. */
export function NeverDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useLearning();
  const { busy, act } = useAct();
  const never = data?.never ?? [];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="sm">
        <Dialog.Header>
          <Dialog.Title>Won’t learn again</Dialog.Title>
          <Dialog.Description>
            You took these back. Remove one to allow it again.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {never.length ? (
            <NeverList
              items={never.map((n) => ({
                id: n.id,
                text: n.text,
                when: `Taken back ${relativeTime(n.at)}`,
              }))}
              onRemove={(id) => void act(id, () => learningApi.removeNever(id))}
              {...(busy && { busy })}
            />
          ) : (
            <Text size="sm" tone="muted">
              Nothing here yet.
            </Text>
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Earlier (ADR 0088): what used to be true, with when it stopped. Only Conch's copy goes. */
export function EarlierDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useLearning();
  const { act } = useAct();
  const past = data?.past ?? [];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="sm">
        <Dialog.Header>
          <Dialog.Title>What used to be true</Dialog.Title>
          <Dialog.Description>
            Out of your chats, but Conch can still answer questions about before.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {past.length ? (
            <MemoryCells aria-label="What used to be true">
              {past.map((m, i) => (
                <MemoryCell
                  key={m.id}
                  index={i}
                  kind={m.kind}
                  label={m.content}
                  meta={until(m.invalidAt ?? m.updatedAt)}
                  onForget={() => void act(m.id, () => learningApi.forgetPast(m.id))}
                >
                  {m.content}
                </MemoryCell>
              ))}
            </MemoryCells>
          ) : (
            <Text size="sm" tone="muted">
              Nothing here yet.
            </Text>
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
