import {
  ExternalList,
  Integration,
  IntegrationResult,
  IntegrationsList,
  type CreateIntegrationBody,
  type UpdateIntegrationBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** Where the service's sign-in page opens: a small window, or this tab if popups are blocked. */
export type SignInDisplay = 'popup' | 'tab';

export const integrationsApi = {
  list: () => request(IntegrationsList, '/api/integrations'),
  external: (refresh = false) =>
    request(ExternalList, `/api/integrations/external${refresh ? '?refresh=1' : ''}`),
  get: (id: string) => request(Integration, `/api/integrations/${id}`),
  create: (body: z.input<typeof CreateIntegrationBody>, display: SignInDisplay = 'popup') =>
    request(IntegrationResult, `/api/integrations?display=${display}`, { method: 'POST', body }),
  update: (id: string, body: UpdateIntegrationBody) =>
    request(Integration, `/api/integrations/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request(Ok, `/api/integrations/${id}`, { method: 'DELETE' }),
  connect: (id: string, display: SignInDisplay = 'popup') =>
    request(IntegrationResult, `/api/integrations/${id}/connect?display=${display}`, {
      method: 'POST',
      body: {},
    }),
  cancel: (id: string) =>
    request(Integration, `/api/integrations/${id}/cancel`, { method: 'POST', body: {} }),
  check: (id: string) =>
    request(Integration, `/api/integrations/${id}/check`, { method: 'POST', body: {} }),
};
