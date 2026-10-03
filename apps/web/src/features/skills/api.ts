import {
  SkillDescriptionDraft,
  SkillShelf,
  SkillSuggestions,
  SkillDetail,
  SkillDraft,
  SkillWritten,
  SkillsList,
  TrustedPublisher,
  type CreateSkillBody,
  type UpdateSkillBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

const path = (id: string) => `/api/skills/${encodeURIComponent(id)}`;

export const skillsApi = {
  list: (refresh = false) => request(SkillsList, `/api/skills${refresh ? '?refresh=1' : ''}`),
  get: (id: string) => request(SkillDetail, path(id)),
  /** A title, name and description for these instructions, written by a model. */
  draft: (instructions: string, signal?: AbortSignal) =>
    request(SkillDraft, '/api/skills/draft', { method: 'POST', body: { instructions }, signal }),
  /** A whole skill from an idea or rough notes: the steps, a title and a description. */
  write: (idea: string, signal?: AbortSignal) =>
    request(SkillWritten, '/api/skills/write', { method: 'POST', body: { idea }, signal }),
  create: (body: z.input<typeof CreateSkillBody>) =>
    request(SkillDetail, '/api/skills', { method: 'POST', body }),
  update: (id: string, body: UpdateSkillBody) =>
    request(SkillDetail, path(id), { method: 'PATCH', body }),
  remove: (id: string) => request(Ok, path(id), { method: 'DELETE' }),
  /** A description for one of your skills that has none, written from its own words. */
  describe: (id: string) =>
    request(SkillDescriptionDraft, `${path(id)}/describe`, { method: 'POST', body: {} }),
  copy: (id: string) => request(SkillDetail, `${path(id)}/copy`, { method: 'POST', body: {} }),
  /** Whose signed skills you trust (ADR 0031). */
  publishers: () =>
    request(z.object({ publishers: z.array(TrustedPublisher) }), '/api/skills/publishers'),
  /** Trust whoever signed this skill. Needs a recent password or key. */
  trustPublisher: (id: string) =>
    request(SkillDetail, `${path(id)}/trust-publisher`, { method: 'POST', body: {} }),
  /** Skills from work that went well in your chats (ADR 0058): quick, asked after every turn. */
  fromWork: () => request(SkillSuggestions, '/api/skills/suggestions/work'),
  /** Skills Conch put here that sit unused (ADR 0058). */
  shelf: () => request(SkillShelf, '/api/skills/suggestions/shelf'),
  /** Turn them off, or keep them. Only ever what's still on the shelf. */
  tidyShelf: (action: 'off' | 'keep', ids: string[]) =>
    request(z.object({ changed: z.number() }), '/api/skills/suggestions/shelf', {
      method: 'POST',
      body: { action, ids },
    }),
  forgetPublisher: (fingerprint: string) =>
    request(Ok, `/api/skills/publishers/${encodeURIComponent(fingerprint)}`, { method: 'DELETE' }),
};
