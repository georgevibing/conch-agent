import type { LearningStatus } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';

import { learningApi, learningKeys, useLearning } from './api';

/**
 * "Don't learn from this chat" (ADR 0087), from the chat's menu or ⌘K: shown
 * at once, put back if it didn't save.
 */
export function useQuietChat() {
  const { data } = useLearning();
  const client = useQueryClient();
  const quiet = new Set(data?.quiet ?? []);
  const mark = (id: string, next: boolean) =>
    client.setQueryData<LearningStatus>(learningKeys.all, (s) =>
      s ? { ...s, quiet: next ? [...s.quiet, id] : s.quiet.filter((q) => q !== id) } : s,
    );
  const setQuiet = async (id: string, next: boolean) => {
    mark(id, next);
    try {
      await learningApi.quiet(id, next);
      toast(next ? 'Conch won’t learn from this chat' : 'Conch learns from this chat again', {
        description: next
          ? 'It still remembers what you ask it to.'
          : 'What lasts is kept once it goes quiet, with Undo.',
      });
    } catch (e) {
      mark(id, !next);
      toast.error((e as Error).message);
    }
  };
  return { isQuiet: (id: string) => quiet.has(id), setQuiet };
}
