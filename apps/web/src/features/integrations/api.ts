import {
  ExternalList,
  Integration,
  IntegrationResult,
  IntegrationsList,
  Readiness,
  type AdoptIntegrationBody,
  type CreateIntegrationBody,
  type UpdateIntegrationBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** Where the service's sign-in page opens: a small window, or this tab if popups are blocked. */
export type SignInDisplay = 'popup' | 'tab';

/**
 * Signing in from a chat's offer (ADR 0060): in a tab (a phone), the way
 * back is that chat, which takes the offer by itself when it opens.
 */
export interface SignInReturn {
  conversationId: string;
  offerId: string;
}

const signInQuery = (display: SignInDisplay, back?: SignInReturn) =>
  new URLSearchParams({
    display,
    ...(display === 'tab' && back && { chat: back.conversationId, offer: back.offerId }),
  }).toString();

export const integrationsApi = {
  list: () => request(IntegrationsList, '/api/integrations'),
  external: (refresh = false) =>
    request(ExternalList, `/api/integrations/external${refresh ? '?refresh=1' : ''}`),
  get: (id: string) => request(Integration, `/api/integrations/${id}`),
  create: (
    body: z.input<typeof CreateIntegrationBody>,
    display: SignInDisplay = 'popup',
    back?: SignInReturn,
  ) =>
    request(IntegrationResult, `/api/integrations?${signInQuery(display, back)}`, {
      method: 'POST',
      body,
    }),
  /** Bring a server a provider set up by itself into Conch (it may ask to sign in). */
  adopt: (body: AdoptIntegrationBody, display: SignInDisplay = 'popup') =>
    request(IntegrationResult, `/api/integrations/adopt?display=${display}`, {
      method: 'POST',
      body,
    }),
  update: (id: string, body: UpdateIntegrationBody) =>
    request(Integration, `/api/integrations/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request(Ok, `/api/integrations/${id}`, { method: 'DELETE' }),
  connect: (id: string, display: SignInDisplay = 'popup', back?: SignInReturn) =>
    request(IntegrationResult, `/api/integrations/${id}/connect?${signInQuery(display, back)}`, {
      method: 'POST',
      body: {},
    }),
  cancel: (id: string) =>
    request(Integration, `/api/integrations/${id}/cancel`, { method: 'POST', body: {} }),
  check: (id: string) =>
    request(Integration, `/api/integrations/${id}/check`, { method: 'POST', body: {} }),
  /** What a catalog entry needs from this computer (an app, a program), and whether it's here. */
  needs: (catalogId: string) =>
    request(Readiness, `/api/integrations/catalog/${encodeURIComponent(catalogId)}/needs`),
  installNeed: (catalogId: string, needId: string) =>
    request(
      Readiness,
      `/api/integrations/catalog/${encodeURIComponent(catalogId)}/needs/${encodeURIComponent(needId)}/install`,
      { method: 'POST', body: {} },
    ),
  openNeed: (catalogId: string, needId: string) =>
    request(
      Readiness,
      `/api/integrations/catalog/${encodeURIComponent(catalogId)}/needs/${encodeURIComponent(needId)}/open`,
      { method: 'POST', body: {} },
    ),
};
