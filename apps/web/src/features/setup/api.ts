import { Readiness } from '@conch/protocol';

import { request } from '../../api/client';

/** Anything Conch knows how to get (ADR 0016): a provider's CLI, the 1Password CLI, uv. */
export const needsApi = {
  get: (id: string) => request(Readiness, `/api/needs/${encodeURIComponent(id)}`),
  act: (id: string, action: 'install' | 'update' | 'open') =>
    request(Readiness, `/api/needs/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: {},
    }),
};

export const needKeys = { one: (id: string) => ['needs', id] as const };
