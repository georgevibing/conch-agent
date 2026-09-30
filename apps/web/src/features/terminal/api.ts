import {
  TerminalInfo,
  TerminalStatus,
  TerminalTicket,
  type CreateTerminalBody,
  type UpdateTerminalSettingsBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });
const path = (id: string) => `/api/terminal/${encodeURIComponent(id)}`;

export const terminalApi = {
  status: () => request(TerminalStatus, '/api/terminal'),
  updateSettings: (body: UpdateTerminalSettingsBody) =>
    request(TerminalStatus, '/api/terminal/settings', { method: 'PATCH', body }),
  create: (body: CreateTerminalBody = {}) =>
    request(TerminalInfo, '/api/terminal', { method: 'POST', body }),
  ticket: (id: string) =>
    request(TerminalTicket, `${path(id)}/ticket`, { method: 'POST', body: {} }),
  close: (id: string) => request(Ok, path(id), { method: 'DELETE' }),
};

export function liveUrl(ticket: string): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/terminal/live?ticket=${encodeURIComponent(ticket)}`;
}
