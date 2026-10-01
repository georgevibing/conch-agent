import { BackgroundStatus, SetBackgroundResult } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

/** Always on (ADR 0026): starting at login, running with no window. */
export const backgroundApi = {
  status: () => request(BackgroundStatus, '/api/background'),
  set: (on: boolean) =>
    request(SetBackgroundResult, '/api/background', { method: 'PUT', body: { on } }),
  addShortcut: () =>
    request(BackgroundStatus, '/api/background/shortcut', { method: 'POST', body: {} }),
  quit: () =>
    request(z.object({ ok: z.boolean() }), '/api/gateway/quit', { method: 'POST', body: {} }),
};

export const backgroundKeys = { status: ['background'] as const };
