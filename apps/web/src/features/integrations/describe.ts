import {
  awaitsSignIn,
  type CatalogEntry,
  type ExternalIntegration,
  type Integration,
  type IntegrationOrigin,
  type IntegrationProvider,
} from '@conch/protocol';

import { relativeTime } from '../../lib/time';

/** The one line a working integration's card shows. */
export function quietMeta(integration: Integration, now = Date.now()): string {
  const count = integration.tools.filter((t) => t.policy !== 'off').length;
  const tools = count === 1 ? '1 tool' : `${count} tools`;
  const used = integration.lastUsedAt
    ? `used ${relativeTime(integration.lastUsedAt, now)}`
    : 'not used yet';
  return `${tools} · ${used}`;
}

/** The button that fixes a problem, in plain words. */
export function fixLabel(integration: Integration): string | undefined {
  // Found and never signed in to here: there's no "again" about it, whatever the last try left.
  if (awaitsSignIn(integration) && integration.auth === 'oauth') return 'Sign in';
  switch (integration.health.action) {
    case 'reconnect':
      return integration.auth === 'oauth' || integration.transport.type === 'host'
        ? 'Sign in again'
        : 'Reconnect';
    case 'edit':
      return integration.auth === 'token' ? 'Paste a new token' : 'Change settings';
    case 'retry':
      return 'Try again';
    case 'turn-on':
      return 'Turn on';
    case 'setup':
      return 'Finish setup';
    default:
      return undefined;
  }
}

/** Something to fix. An app Conch found that waits for a first sign-in isn't: it's an offer. */
export const needsAttention = (i: Integration) =>
  i.enabled && !awaitsSignIn(i) && ['needs-auth', 'error', 'warning'].includes(i.health.state);

export const isBroken = (i: Integration) =>
  i.enabled && !awaitsSignIn(i) && ['needs-auth', 'error'].includes(i.health.state);

/**
 * Where Conch found an app, in the two or three words a small tile has room
 * for: "engineering plugin", "Your Claude account".
 */
export function originLabel(
  from: IntegrationOrigin,
  provider: IntegrationProvider | undefined,
): string {
  switch (from.source) {
    case 'plugin':
      return from.plugin ? `${from.plugin} plugin` : 'A plugin';
    case 'account':
      return provider?.account ? capitalise(provider.account.label) : 'Your account there';
    case 'project':
      return 'This work folder';
    default:
      return `${from.providerName} settings`;
  }
}

/** Where an external server comes from, in words, for whichever engine is running. */
export function sourceLabel(
  source: ExternalIntegration['source'],
  provider: IntegrationProvider | undefined,
): string {
  const engine = provider?.engine ?? 'your assistant';
  switch (source) {
    case 'account':
      return provider?.account ? capitalise(provider.account.label) : engine;
    case 'engine':
      return `${engine} settings`;
    case 'project':
      return 'This work folder';
    case 'plugin':
      return `A ${engine} plugin`;
    default:
      return engine;
  }
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const categoryLabel: Record<CatalogEntry['category'], string> = {
  productivity: 'Work',
  developer: 'Developer',
  files: 'Files',
  design: 'Design',
  business: 'Business',
  home: 'Home',
  browser: 'Browser',
  other: 'Other',
};
