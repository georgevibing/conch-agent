/**
 * `apps_check`: the model has Conch look at a connected app again before it
 * tells anyone it's broken (working agreement 11, ADR 0049).
 */
import type { Integration, IntegrationHealth } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { type AppsChecker, appsCheckTool } from './tools';

function app(name: string, server: string, health: IntegrationHealth, enabled = true): Integration {
  return {
    id: `id-${server}`,
    name,
    server,
    catalogId: server,
    transport: { type: 'http', url: `https://${server}.example/mcp` },
    auth: 'token',
    enabled,
    policy: 'ask-writes',
    health,
    tools: [
      { name: 'search_code', description: '', access: 'read', destructive: false },
      { name: 'get_file_contents', description: '', access: 'read', destructive: false },
    ],
    values: {},
    secrets: [],
    createdAt: 0,
    updatedAt: 0,
  } as Integration;
}

/** Pretend integrations: a check turns each app into what `after` says. */
function apps(items: Integration[], after: Record<string, IntegrationHealth> = {}) {
  const checked: string[] = [];
  const now = new Map(items.map((i) => [i.id, i]));
  const checker: AppsChecker = {
    list: async () => ({ integrations: [...now.values()] }),
    check: async (id) => {
      checked.push(id);
      const item = now.get(id);
      const health = item && after[item.server];
      if (item && health) now.set(id, { ...item, health });
    },
    get: async (id) => now.get(id) as Integration,
  };
  return { checker, checked };
}

const run = (checker: AppsChecker, app?: string) =>
  appsCheckTool(checker).run(app === undefined ? {} : { app }) as Promise<string>;

describe('apps_check', () => {
  it('looks again, and says an app that came back works and what it offers', async () => {
    const { checker, checked } = apps(
      [app('GitHub', 'github', { state: 'error', message: 'Something went wrong connecting.' })],
      { github: { state: 'ok' } },
    );
    const said = await run(checker, 'GitHub');
    expect(checked).toEqual(['id-github']);
    expect(said).toMatch(/GitHub works \(2 tools, named mcp__github__<tool>: search_code/);
    expect(said).toMatch(/another way/);
  });

  it('finds an app by its server name, any case', async () => {
    const { checker, checked } = apps([app('Cloudflare', 'cloudflare', { state: 'ok' })]);
    await run(checker, 'CLOUDFLARE');
    expect(checked).toEqual(['id-cloudflare']);
  });

  it('with no app named, looks at every one that isn’t working, and only those', async () => {
    const { checker, checked } = apps([
      app('GitHub', 'github', { state: 'error', action: 'retry', retryAt: 1 }),
      app('Supabase', 'supabase', { state: 'ok' }),
    ]);
    const said = await run(checker);
    expect(checked).toEqual(['id-github']);
    expect(said).toMatch(
      /can’t be reached right now.*keeps trying by itself.*command-line program/,
    );
  });

  it('leaves the sign-in to the person, and says to carry on meanwhile', async () => {
    const { checker } = apps([
      app('Supabase', 'supabase', {
        state: 'needs-auth',
        message: 'Sign in again to keep using it.',
      }),
    ]);
    expect(await run(checker, 'supabase')).toMatch(
      /needs the person to sign in again.*Apps → Supabase.*carry on/,
    );
  });

  it('never turns on an app the person turned off', async () => {
    const { checker, checked } = apps([app('GitHub', 'github', { state: 'off' }, false)]);
    expect(await run(checker, 'github')).toMatch(/turned off by the person.*Don’t turn it on/);
    expect(checked).toEqual([]);
  });

  it('points at offer for an app that isn’t connected', async () => {
    const { checker } = apps([app('GitHub', 'github', { state: 'ok' })]);
    expect(await run(checker, 'Linear')).toMatch(
      /No connected app matches “Linear”.*GitHub.*offer/,
    );
  });
});
