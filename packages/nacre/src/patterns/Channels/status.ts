import type { IntegrationStateValue } from '../Integrations/status';

/** How a channel is, as a card shows it. `hello` means connected, but nobody has said hello yet. */
export type ChannelStateValue =
  | 'online'
  | 'hello'
  | 'connecting'
  | 'reconnecting'
  | 'needs-token'
  | 'conflict'
  | 'access'
  | 'off'
  | 'error';

export const channelStateMeta: Record<
  ChannelStateValue,
  {
    label: string;
    tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
    dot: IntegrationStateValue;
  }
> = {
  online: { label: 'Online', tone: 'success', dot: 'ok' },
  hello: { label: 'Waiting for your hello', tone: 'info', dot: 'connecting' },
  connecting: { label: 'Connecting', tone: 'info', dot: 'connecting' },
  reconnecting: { label: 'Reconnecting', tone: 'warning', dot: 'connecting' },
  'needs-token': { label: 'Needs a new key', tone: 'warning', dot: 'needs-auth' },
  conflict: { label: 'Used elsewhere', tone: 'warning', dot: 'warning' },
  // A switch only you can turn on in System Settings (iMessage).
  access: { label: 'Needs your OK on this Mac', tone: 'warning', dot: 'needs-auth' },
  off: { label: 'Off', tone: 'neutral', dot: 'off' },
  error: { label: 'Not working', tone: 'danger', dot: 'error' },
};

/** States that need a person (a card shows them first, with their one fix). */
export const channelNeedsYou = (state: ChannelStateValue) =>
  state === 'needs-token' ||
  state === 'conflict' ||
  state === 'access' ||
  state === 'error' ||
  state === 'hello';
