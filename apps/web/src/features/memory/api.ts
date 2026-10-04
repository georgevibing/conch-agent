import {
  Memory,
  MemoryIndexStatus,
  SkillSuggestions,
  TidyStatus,
  type KeepMemoryBody,
} from '@conch/protocol';
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
  /** Put back a memory the assistant forgot, exactly as it was. */
  restore: (memory: Memory) =>
    request(Memory, '/api/memories/restore', { method: 'POST', body: { memory } }),
  /**
   * Keep a memory that waits for your OK: as it is, in your words (Edit
   * first), or, one the memory check refused, `anyway` (ADR 0087).
   */
  keep: (id: string, body: KeepMemoryBody = {}) =>
    request(Memory, `/api/memories/${encodeURIComponent(id)}/keep`, { method: 'POST', body }),
  exportUrl: (format: 'md' | 'json') =>
    `/api/memories/export${format === 'json' ? '?format=json' : ''}`,
  index: (languages: readonly string[] = []) =>
    request(
      MemoryIndexStatus,
      `/api/memory/index${languages.length ? `?lang=${encodeURIComponent(languages.join(','))}` : ''}`,
    ),
  rebuild: () =>
    request(MemoryIndexStatus, '/api/memory/index/rebuild', { method: 'POST', body: {} }),
  /** Get it (ADR 0041): the browser's languages choose the model. */
  getModel: (languages: readonly string[] = []) =>
    request(MemoryIndexStatus, '/api/memory/index/model', {
      method: 'POST',
      body: { languages: [...languages].slice(0, 20) },
    }),
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
