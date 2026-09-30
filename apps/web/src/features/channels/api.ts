import {
  Channel,
  ChannelCheck,
  ChannelList,
  type ChannelSecrets,
  type CheckChannelBody,
  type UpdateChannelBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

export const channelsApi = {
  list: () => request(ChannelList, '/api/channels'),
  check: (body: CheckChannelBody, signal?: AbortSignal) =>
    request(ChannelCheck, '/api/channels/check', { method: 'POST', body, signal }),
  create: (body: ChannelSecrets) => request(Channel, '/api/channels', { method: 'POST', body }),
  update: (id: string, body: UpdateChannelBody) =>
    request(Channel, `/api/channels/${id}`, { method: 'PATCH', body }),
  replaceToken: (id: string, body: ChannelSecrets) =>
    request(Channel, `/api/channels/${id}/token`, { method: 'PUT', body }),
  remove: (id: string) => request(z.unknown(), `/api/channels/${id}`, { method: 'DELETE' }),
  pair: (id: string) => request(Channel, `/api/channels/${id}/pair`, { method: 'POST', body: {} }),
  answer: (id: string, personId: string, answer: 'allow' | 'block' | 'dismiss') =>
    request(Channel, `/api/channels/${id}/requests/${encodeURIComponent(personId)}`, {
      method: 'POST',
      body: { answer },
    }),
  removePerson: (id: string, personId: string) =>
    request(Channel, `/api/channels/${id}/people/${encodeURIComponent(personId)}`, {
      method: 'DELETE',
    }),
  repair: (id: string) =>
    request(Channel, `/api/channels/${id}/repair`, { method: 'POST', body: {} }),
  test: (id: string) => request(Ok, `/api/channels/${id}/test`, { method: 'POST', body: {} }),
};
