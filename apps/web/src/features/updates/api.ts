import { UpdatesStatus, type UpdatesSettingsBody } from '@conch/protocol';

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
  /** The channel, every change on main, and what's been put away (ADR 0051). */
  setSettings: (body: UpdatesSettingsBody) =>
    request(UpdatesStatus, '/api/updates/settings', { method: 'PATCH', body }),
  /** Back to the version before, at once. */
  goBack: () => request(UpdatesStatus, '/api/updates/conch/back', { method: 'POST', body: {} }),
};

export const updateKeys = { status: ['updates'] as const };
