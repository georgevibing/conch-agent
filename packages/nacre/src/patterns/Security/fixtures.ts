import type { Device } from './DeviceList';
import type { CheckItem } from './SecurityCheckup';

export const checkupItems: CheckItem[] = [
  {
    id: 'encryption',
    level: 'danger',
    title: 'Your network can see Conch traffic',
    detail:
      'Conch is reachable over plain HTTP, so anyone on the same Wi-Fi could read your conversations — and your password as you sign in. Use Tailscale for an encrypted connection instead.',
    command: 'tailscale serve --bg 4317',
  },
  {
    id: 'full-trust',
    level: 'warn',
    title: 'New chats never ask before acting',
    detail:
      '“Full trust” lets the assistant run any command without asking. A web page or file it reads could trick it.',
  },
  {
    id: 'stale-keys',
    level: 'info',
    title: 'An access key hasn’t been used in 90 days',
    detail: 'Revoke keys you no longer need, so a lost device can’t get back in.',
  },
  {
    id: 'sign-in',
    level: 'ok',
    title: 'Protected by your password',
    detail: 'Every device has to sign in, including this one.',
  },
];

export const devices: Device[] = [
  {
    id: 's_phone',
    name: 'Safari on iPhone',
    kind: 'phone',
    meta: 'Added with a QR code · active 5 minutes ago',
  },
  {
    id: 's_mac',
    name: 'Chrome on Mac',
    kind: 'desktop',
    meta: 'Signed in with a password · active now',
    current: true,
  },
  { id: 's_curl', name: 'curl', kind: 'other', meta: 'Access key “CI” · active yesterday' },
];
