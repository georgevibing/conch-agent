import {
  BrowserStatus,
  type SetBrowserBackendBody,
  type UpdateBrowserSettingsBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

export const browserApi = {
  status: () => request(BrowserStatus, '/api/browser'),
  updateSettings: (body: UpdateBrowserSettingsBody) =>
    request(BrowserStatus, '/api/browser/settings', { method: 'PATCH', body }),
  /** Where it runs (ADR 0080). Anything but its own needs a recent sign-in. */
  setBackend: (body: SetBrowserBackendBody) =>
    request(BrowserStatus, '/api/browser/backend', { method: 'PUT', body }),
  forgetBackend: (kind: 'browserbase' | 'steel' | 'cdp') =>
    request(BrowserStatus, `/api/browser/backend/${kind}`, { method: 'DELETE' }),
  revokeSite: (site: string) =>
    request(BrowserStatus, `/api/browser/sites/${encodeURIComponent(site)}`, { method: 'DELETE' }),
  repair: () => request(BrowserStatus, '/api/browser/repair', { method: 'POST', body: {} }),
  wipe: () => request(BrowserStatus, '/api/browser/wipe', { method: 'POST', body: {} }),
  /** Take the wheel or hand it back without the live view open. */
  control: (conversationId: string, to: 'user' | 'agent') =>
    request(Ok, `/api/browser/${encodeURIComponent(conversationId)}/control`, {
      method: 'POST',
      body: { to },
    }),
};

/** A step's thumbnail. */
export function shotUrl(conversationId: string, shot: string | undefined): string | undefined {
  return shot
    ? `/api/browser/shots/${encodeURIComponent(conversationId)}/${encodeURIComponent(shot)}`
    : undefined;
}
