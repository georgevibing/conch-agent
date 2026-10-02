import { describe, expect, it } from 'vitest';

import { CATALOG, connectsItself, publicCatalog } from './catalog';

/**
 * The gallery's promise (ADR 0049): every app in it works with every model,
 * and never depends on how a provider was set up. An entry Conch can't
 * connect by itself — through an MCP server it reaches, or a family of its
 * own tools (Google, Slack) — doesn't belong in the catalog.
 */
describe('every app in the gallery is Conch’s own', () => {
  it.each([...CATALOG.values()].filter((entry) => !entry.retired).map((e) => [e.id, e] as const))(
    '%s connects without a provider',
    (_id, entry) => {
      expect(
        connectsItself(entry),
        `${entry.name} needs a blueprint, or a Conch host-tool family (auth: 'google' | 'slack'). Connecting through a provider's own account isn't allowed: it would only work with that provider.`,
      ).toBe(true);
    },
  );

  it('offers nothing that only a provider’s account reaches', () => {
    expect(publicCatalog().map((c) => c.auth)).not.toContain('account');
    expect(publicCatalog().find((c) => c.id === 'slack')?.auth).toBe('slack');
  });
});
