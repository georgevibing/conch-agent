import {
  CloudPicker,
  Provider,
  ProviderSignIn,
  ProvidersList,
  ServerProbe,
  type AddServerBody,
  type ChooseCloudBody,
  type ClaudeCloudBody,
  type CloudProviderId,
  type UpdateServerBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });
const AddedServer = z.object({ id: z.string(), list: ProvidersList });

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
  /** Look at an address before adding it. */
  probeServer: (url: string, key?: string) =>
    request(ServerProbe, '/api/providers/servers/probe', {
      method: 'POST',
      body: { url, ...(key && { key }) },
    }),
  addServer: (body: AddServerBody) =>
    request(AddedServer, '/api/providers/servers', { method: 'POST', body }),
  updateServer: (id: string, body: UpdateServerBody) =>
    request(ProvidersList, `/api/providers/servers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    }),
  removeServer: (id: string) =>
    request(ProvidersList, `/api/providers/servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  /** Use something found on this computer: a key in the environment, a running server. */
  useFound: (id: string) =>
    request(ProvidersList, `/api/providers/found/${encodeURIComponent(id)}/use`, {
      method: 'POST',
      body: {},
    }),
  /** The cloud accounts found on this computer for a provider (ADR 0109). */
  cloud: (id: CloudProviderId, via?: 'bedrock' | 'vertex') =>
    request(CloudPicker, `/api/clouds/${id}${via ? `?via=${via}` : ''}`),
  /** Use one of them. */
  chooseCloud: (id: Exclude<CloudProviderId, 'claude-code'>, body: ChooseCloudBody) =>
    request(CloudPicker, `/api/clouds/${id}`, { method: 'PUT', body }),
  /** Where Claude Code runs: Anthropic's own sign-in, Bedrock or Vertex. */
  claudeCloud: (body: ClaudeCloudBody) =>
    request(CloudPicker, '/api/clouds/claude-code', { method: 'PUT', body }),
  login: (id: string, method: 'subscription' | 'console') =>
    request(Ok, `/api/providers/${encodeURIComponent(id)}/login`, {
      method: 'POST',
      body: { method },
    }),
};
