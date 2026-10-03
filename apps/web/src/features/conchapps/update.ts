import type { ConchApp, ConchAppFound } from '@conch/protocol';

import { ApiError } from '../../api/client';
import { conchAppsApi } from './api';

/** Updated; or there's something to look at first (a newer version arrived since). */
export type UpdateOutcome = { updated: ConchApp } | { look: ConchAppFound; newer: boolean };

/**
 * **Update** an app to exactly the version the person looked at (ADR 0061).
 * `seen` is the preview they read; without one, the version its card told
 * them about. When what's there now isn't that, nothing changes: the new
 * preview comes back to be shown first.
 */
export async function updateApp(app: ConchApp, seen?: ConchAppFound): Promise<UpdateOutcome> {
  const found = seen ?? (await conchAppsApi.updatePreview(app.id));
  if (!seen && app.update && found.manifest.version !== app.update.version)
    return { look: found, newer: true };
  try {
    return { updated: await conchAppsApi.applyUpdate(app.id, found.hash) };
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'changed' || error.code === 'conflict'))
      return { look: await conchAppsApi.updatePreview(app.id), newer: true };
    throw error;
  }
}
