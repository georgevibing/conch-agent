import { LocalStatus } from '@conch/protocol';

import { request } from '../../api/client';

/** A model on this computer (ADR 0022): Ollama, and the models it runs. */
export const localApi = {
  status: () => request(LocalStatus, '/api/local'),
  /** Needs a recent password or key (sudo mode): it's a big download that stays here. */
  pull: (model: string) =>
    request(LocalStatus, '/api/local/pull', { method: 'POST', body: { model } }),
  pause: () => request(LocalStatus, '/api/local/pull/pause', { method: 'POST', body: {} }),
  cancel: () => request(LocalStatus, '/api/local/pull/cancel', { method: 'POST', body: {} }),
  start: () => request(LocalStatus, '/api/local/start', { method: 'POST', body: {} }),
  choose: (model: string) =>
    request(LocalStatus, '/api/local/model', { method: 'PUT', body: { model } }),
};

export const localKeys = { status: ['local'] as const };
