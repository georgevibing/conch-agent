import { Memory, MemoryIndexStatus, SkillSuggestions, TidyStatus } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** It learns you (ADR 0032). */
export const memoryApi = {
  search: (q: string, signal?: AbortSignal) =>
    request(
      z.object({ results: z.array(Memory) }),
      `/api/memories/search?q=${encodeURIComponent(q)}`,
      {
        signal,
      },
    ),
  /** Keep a memory that waits for your OK. */
  keep: (id: string) =>
    request(Memory, `/api/memories/${encodeURIComponent(id)}/keep`, { method: 'POST', body: {} }),
  exportUrl: (format: 'md' | 'json') =>
    `/api/memories/export${format === 'json' ? '?format=json' : ''}`,
  index: () => request(MemoryIndexStatus, '/api/memory/index'),
  rebuild: () =>
    request(MemoryIndexStatus, '/api/memory/index/rebuild', { method: 'POST', body: {} }),
  getModel: () =>
    request(MemoryIndexStatus, '/api/memory/index/model', { method: 'POST', body: {} }),
  tidy: () => request(TidyStatus, '/api/memory/tidy'),
  tidyNow: () => request(TidyStatus, '/api/memory/tidy', { method: 'POST', body: {} }),
  answer: (runId: string, changeId: string, answer: 'keep' | 'undo' | 'dismiss') =>
    request(TidyStatus, '/api/memory/tidy/answer', {
      method: 'POST',
      body: { runId, changeId, answer },
    }),
  suggestions: (fresh = false) =>
    request(SkillSuggestions, `/api/skills/suggestions${fresh ? '?fresh=1' : ''}`),
  dismissSuggestion: (id: string, forever: boolean) =>
    request(Ok, '/api/skills/suggestions/dismiss', { method: 'POST', body: { id, forever } }),
};

/** Save everything Conch knows: the browser downloads it from the gateway. */
export function downloadMemories(format: 'md' | 'json'): void {
  const link = document.createElement('a');
  link.href = memoryApi.exportUrl(format);
  link.download = '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}
