import {
  SkillDescriptionDraft,
  SkillDetail,
  SkillDraft,
  SkillsList,
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
  create: (body: z.input<typeof CreateSkillBody>) =>
    request(SkillDetail, '/api/skills', { method: 'POST', body }),
  update: (id: string, body: UpdateSkillBody) =>
    request(SkillDetail, path(id), { method: 'PATCH', body }),
  remove: (id: string) => request(Ok, path(id), { method: 'DELETE' }),
  /** A description for one of your skills that has none, written from its own words. */
  describe: (id: string) =>
    request(SkillDescriptionDraft, `${path(id)}/describe`, { method: 'POST', body: {} }),
  copy: (id: string) => request(SkillDetail, `${path(id)}/copy`, { method: 'POST', body: {} }),
};
