import type { Device } from './DeviceList';
import type { DeviceRequestItem } from './DeviceRequests';
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

const later = () => new Promise<void>((resolve) => setTimeout(resolve, 1200));

/** Every kind of fix the checkup offers: a change made here, a place to go, a line to copy. */
export const checkupWithFixes: CheckItem[] = [
  {
    id: 'encryption',
    level: 'danger',
    title: 'Your network can see Conch traffic',
    detail:
      'Conch is reachable over plain HTTP, so anyone on the same Wi-Fi could read your conversations — and your password as you sign in. Use Tailscale for an encrypted connection instead.',
    command: 'tailscale serve --bg 4317',
    fix: { kind: 'open', label: 'Show me how', onFix: () => undefined },
  },
  {
    id: 'full-trust',
    level: 'warn',
    title: 'New chats never ask before acting',
    detail:
      '“Full trust” lets the assistant run any command and change any file without asking. A web page or file it reads could trick it. Go back to asking first — or choose “Auto” in Settings › Models.',
    fix: { kind: 'act', label: 'Ask first', onFix: later },
  },
  {
    id: 'trusted-integrations',
    level: 'warn',
    title: 'Gmail acts without asking',
    detail:
      'Gmail can send, change and delete things on your behalf without checking with you. An email or page the assistant reads could trick it into doing that. Have it ask you before changes instead.',
    fix: { kind: 'act', label: 'Ask before changes', onFix: later },
  },
  {
    id: 'browser-local',
    level: 'warn',
    title: 'The browser can open local apps',
    detail:
      'The assistant’s browser can reach pages on this computer and your network, like a router or a dev server. If you don’t need it, turn it off.',
    fix: { kind: 'act', label: 'Turn off', onFix: later },
  },
  {
    id: 'env-token',
    level: 'warn',
    title: 'An access key is set in CONCH_TOKEN',
    detail:
      'Keys in environment variables end up in shell history and crash reports, and can’t be revoked one device at a time. Your own sign-in already protects Conch, so remove CONCH_TOKEN and restart Conch:',
    command: "sed -i.bak '/CONCH_TOKEN/d' ~/.zshrc",
  },
  {
    id: 'stale-keys',
    level: 'info',
    title: 'An access key hasn’t been used in 90 days',
    detail: 'Revoke keys you no longer need, so a lost device can’t get back in.',
    fix: { kind: 'open', label: 'Review keys', onFix: () => undefined },
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

/** Remembered devices with approval on: signed in, signed out, and one long unused. */
export const approvedDevices: Device[] = [
  {
    id: 'dev_mac',
    name: 'Chrome on Mac',
    kind: 'desktop',
    meta: 'Signed in now · approved on this computer',
    current: true,
  },
  {
    id: 'dev_phone',
    name: 'Ada’s iPhone',
    kind: 'phone',
    meta: 'Signed in · active 5 minutes ago · approved in the terminal',
  },
  {
    id: 'dev_ipad',
    name: 'Safari on iPad',
    kind: 'tablet',
    meta: 'Signed out · last seen 3 days ago · added with a sign-in link',
    signedIn: false,
  },
  {
    id: 'dev_old',
    name: 'Firefox on Windows',
    kind: 'desktop',
    meta: 'Signed out · last seen 4 months ago',
    signedIn: false,
    stale: true,
  },
];

export const requests: DeviceRequestItem[] = [
  {
    code: 'K7M-Q2X',
    device: 'Safari on iPhone',
    kind: 'phone',
    meta: 'From 100.64.0.7 · with your password · just now',
  },
  {
    code: 'H4P-W9R',
    device: 'Scripts using “Home server”',
    kind: 'other',
    meta: 'From 100.64.0.20 · with the key “Home server” · 3 minutes ago',
    rejected: true,
  },
];
