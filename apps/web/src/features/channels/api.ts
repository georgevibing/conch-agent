import {
  Channel,
  ChannelCheck,
  ChannelLink,
  FeishuScan,
  type LinkableKind,
  ChannelDoor,
  ChannelHookSecrets,
  ChannelList,
  type ChannelSecrets,
  type CheckChannelBody,
  ImessageSetup,
  type OpenImessageBody,
  type ReplaceChannelTokenBody,
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
  replaceToken: (id: string, body: ReplaceChannelTokenBody) =>
    request(Channel, `/api/channels/${id}/token`, { method: 'PUT', body }),
  remove: (id: string) => request(z.unknown(), `/api/channels/${id}`, { method: 'DELETE' }),
  pair: (id: string) => request(Channel, `/api/channels/${id}/pair`, { method: 'POST', body: {} }),
  answer: (id: string, personId: string, answer: 'allow' | 'block' | 'dismiss') =>
    request(Channel, `/api/channels/${id}/requests/${encodeURIComponent(personId)}`, {
      method: 'POST',
      body: { answer },
    }),
  /** Answer in a group when mentioned, or stop (ADR 0075). */
  setGroup: (id: string, groupId: string, on: boolean) =>
    request(Channel, `/api/channels/${id}/groups/${encodeURIComponent(groupId)}`, {
      method: 'PUT',
      body: { on },
    }),
  forgetGroup: (id: string, groupId: string) =>
    request(Channel, `/api/channels/${id}/groups/${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    }),
  removePerson: (id: string, personId: string) =>
    request(Channel, `/api/channels/${id}/people/${encodeURIComponent(personId)}`, {
      method: 'DELETE',
    }),
  /** Gmail the app's sign-in, offered for talking by email too (ADR 0052): only its address. */
  gmailOffer: () =>
    request(z.object({ address: z.string().optional() }), '/api/channels/email/gmail'),
  /** Talk by email with the app password Gmail already has: only when a person says so. */
  fromGmail: () => request(Channel, '/api/channels/email/gmail', { method: 'POST', body: {} }),
  repair: (id: string) =>
    request(Channel, `/api/channels/${id}/repair`, { method: 'POST', body: {} }),
  /** Show a code to link WhatsApp or Signal (`channelId`: link that channel again). */
  link: (kind: LinkableKind, channelId?: string) =>
    request(ChannelLink, '/api/channels/link', {
      method: 'POST',
      body: { kind, ...(channelId && { channelId }) },
    }),
  linkStatus: (id: string) => request(ChannelLink, `/api/channels/link/${id}`),
  stopLink: (id: string) => request(z.unknown(), `/api/channels/link/${id}`, { method: 'DELETE' }),
  /** Make a Feishu or Lark bot by scanning a code (ADR 0120): whoever scans it is the owner. */
  feishuScan: (region: 'feishu' | 'lark') =>
    request(FeishuScan, '/api/channels/feishu/scan', { method: 'POST', body: { region } }),
  feishuScanStatus: (id: string) => request(FeishuScan, `/api/channels/feishu/scan/${id}`),
  stopFeishuScan: (id: string) =>
    request(z.unknown(), `/api/channels/feishu/scan/${id}`, { method: 'DELETE' }),
  test: (id: string) => request(Ok, `/api/channels/${id}/test`, { method: 'POST', body: {} }),
  imessage: (signal?: AbortSignal) => request(ImessageSetup, '/api/channels/imessage', { signal }),
  openImessage: (place: OpenImessageBody['place']) =>
    request(Ok, '/api/channels/imessage/open', { method: 'POST', body: { place } }),
  /** What to paste in WeChat's server settings (its Token and EncodingAESKey). */
  hook: (id: string) => request(ChannelHookSecrets, `/api/channels/${id}/hook`),
  /** The Teams app to upload, made for this bot. */
  teamsAppUrl: (id: string) => `/api/channels/${id}/teams-app`,
  door: () => request(ChannelDoor, '/api/channels/door'),
  doorTailscale: () =>
    request(ChannelDoor, '/api/channels/door/tailscale', { method: 'POST', body: {} }),
  /** Use Conch's own address for the door (ADR 0064). */
  doorAddress: () =>
    request(ChannelDoor, '/api/channels/door/address', { method: 'POST', body: {} }),
  doorOwn: (url: string) =>
    request(ChannelDoor, '/api/channels/door', { method: 'PUT', body: { url } }),
  doorCheck: () => request(ChannelDoor, '/api/channels/door/check', { method: 'POST', body: {} }),
  doorOff: () => request(ChannelDoor, '/api/channels/door', { method: 'DELETE' }),
};
