import { Provider, ProviderSignIn, ProvidersList } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** Where the provider's sign-in page opens: a small window, or this tab. */
export type SignInDisplay = 'popup' | 'tab';

export const providersApi = {
  list: (refresh = false) => request(ProvidersList, `/api/providers${refresh ? '?refresh=1' : ''}`),
  use: (id: string) =>
    request(ProvidersList, `/api/providers/${encodeURIComponent(id)}/use`, {
      method: 'POST',
      body: {},
    }),
  check: (id: string) =>
    request(Provider, `/api/providers/${encodeURIComponent(id)}/check`, {
      method: 'POST',
      body: {},
    }),
  setKey: (id: string, value: string) =>
    request(ProvidersList, `/api/providers/${encodeURIComponent(id)}/key`, {
      method: 'PUT',
      body: { value },
    }),
  clearKey: (id: string) =>
    request(ProvidersList, `/api/providers/${encodeURIComponent(id)}/key`, { method: 'DELETE' }),
  signIn: (id: string, display: SignInDisplay = 'popup') =>
    request(ProviderSignIn, `/api/providers/${encodeURIComponent(id)}/signin?display=${display}`, {
      method: 'POST',
      body: {},
    }),
  login: (id: string, method: 'subscription' | 'console') =>
    request(Ok, `/api/providers/${encodeURIComponent(id)}/login`, {
      method: 'POST',
      body: { method },
    }),
};
