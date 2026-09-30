import { Health } from '@conch/protocol';
import { z } from 'zod';

import { ApiError, request } from '../../api/client';
import { useUi } from '../../app/ui';

/** This gateway's boot id, to tell when a restart has finished. */
export async function bootId(): Promise<string | undefined> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    return Health.parse(await response.json()).bootId;
  } catch {
    return undefined;
  }
}

/**
 * Start Conch again (after an update or a restore). The page rests on a calm
 * screen and comes back by itself when Conch does. Returns a sentence to show
 * instead when Conch can't restart itself here (it isn't running under
 * `pnpm start`).
 */
export async function restartConch(title = 'Restarting Conch'): Promise<string | undefined> {
  const from = await bootId();
  try {
    await request(z.object({ ok: z.boolean() }), '/api/gateway/restart', {
      method: 'POST',
      body: {},
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not-restartable') return error.message;
    throw error;
  }
  useUi.getState().setRestarting({ title, from });
  return undefined;
}
