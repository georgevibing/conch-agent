import { type PickPurpose, PickResult } from '@conch/protocol';

import { request } from '../api/client';

/**
 * Whether the system's Open dialog can show for this page: only on the
 * computer Conch runs on (the gateway checks too).
 */
export function canPickHere(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

/** The system's own Open dialog, for one purpose. Undefined when cancelled. */
export async function pickPath(purpose: PickPurpose): Promise<string | undefined> {
  const result = await request(PickResult, '/api/pick', { method: 'POST', body: { purpose } });
  return result.path;
}
