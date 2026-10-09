import type { McpChoice, McpClient, McpClientApp, McpScope } from '@conch/protocol';
import type { McpScopeChoice } from '@conch/nacre';

import { relativeTime } from '../../lib/time';

/** How each app's logo is drawn: Claude's own mark; a monogram on its colour for the rest. */
export const APP_LOOK: Record<McpClientApp, { brand?: string; color?: string }> = {
  'claude-desktop': { brand: 'anthropic-api', color: '#d97757' },
  cursor: { color: '#1e1e1e' },
  vscode: { color: '#007acc' },
  other: {},
};

/** A scope in a few words, for a sentence that lists them. */
const SHORT: Record<string, string> = {
  'memory.read': 'your memory',
  'memory.write': 'suggesting memories',
  skills: 'your skills',
  browser: 'the browser',
};

/** "Your memory, Gmail and the browser". */
export function usesWords(scopes: readonly McpScope[], choices: readonly McpChoice[]): string {
  const named = new Map(choices.map((c) => [c.scope, c.title]));
  // Another agent let talk to yours (ADR 0112): said once, however many of yours.
  const agents = scopes.some((s) => s.startsWith('agent:')) ? ['talking to your agents'] : [];
  const words = [
    ...scopes
      .filter((s) => !s.startsWith('agent:'))
      .map((s) => SHORT[s] ?? named.get(s) ?? 'an app that’s gone'),
    ...agents,
  ];
  if (!words.length) return 'Nothing yet';
  const joined =
    words.length === 1
      ? (words[0] ?? '')
      : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** "Used 2 minutes ago · paired 3 Oct": when it last did something comes first. */
export function pairedWords(client: McpClient, now = Date.now()): string {
  const paired = new Date(client.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const used = client.lastUsedAt ? `Used ${relativeTime(client.lastUsedAt, now)}` : 'Not used yet';
  return `${used} · paired ${paired}`;
}

/** The pairing card's choices, in Nacre's shape. */
export function scopeChoices(choices: readonly McpChoice[]): McpScopeChoice[] {
  return choices.map((c) => ({
    scope: c.scope,
    title: c.title,
    ...(c.detail && { detail: c.detail }),
    kind: c.scope.startsWith('app:') ? 'app' : 'conch',
    brand: c.brand ?? c.catalogId,
    ...(c.color && { color: c.color }),
  }));
}
