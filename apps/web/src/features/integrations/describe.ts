import type {
  CatalogEntry,
  ExternalIntegration,
  Integration,
  IntegrationProvider,
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
  switch (integration.health.action) {
    case 'reconnect':
      return integration.auth === 'oauth' ? 'Sign in again' : 'Reconnect';
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

export const needsAttention = (i: Integration) =>
  i.enabled && ['needs-auth', 'error', 'warning'].includes(i.health.state);

export const isBroken = (i: Integration) =>
  i.enabled && ['needs-auth', 'error'].includes(i.health.state);

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

/** Provider-account connectors (e.g. from a Claude account) that the engine reports, by catalog id. */
export function accountConnected(external: ExternalIntegration[] | undefined, entry: CatalogEntry) {
  return external?.find((s) => s.source === 'account' && s.catalogId === entry.id);
}

export const categoryLabel: Record<CatalogEntry['category'], string> = {
  productivity: 'Work',
  developer: 'Developer',
  files: 'Files',
  home: 'Home',
  browser: 'Browser',
  other: 'Other',
};
