import { UpdatesStatus } from '@conch/protocol';

import { request } from '../../api/client';

/** Updates for Conch and the programs it uses (ADR 0019). Every call answers at once. */
export const updatesApi = {
  status: () => request(UpdatesStatus, '/api/updates'),
  check: () => request(UpdatesStatus, '/api/updates/check', { method: 'POST', body: {} }),
  updateConch: () => request(UpdatesStatus, '/api/updates/conch', { method: 'POST', body: {} }),
  updateAll: () => request(UpdatesStatus, '/api/updates/programs', { method: 'POST', body: {} }),
  updateProgram: (id: string) =>
    request(UpdatesStatus, `/api/updates/programs/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: {},
    }),
  setAuto: (auto: boolean) =>
    request(UpdatesStatus, '/api/updates/settings', { method: 'PATCH', body: { auto } }),
};

export const updateKeys = { status: ['updates'] as const };
