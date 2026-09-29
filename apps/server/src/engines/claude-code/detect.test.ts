import { describe, expect, it } from 'vitest';

import { fakeClaude } from '../../test/fakeClaude';
import { describeAuth, detectClaude, parseAuthStatus } from './detect';

describe('Claude Code detection', () => {
  it('parses auth status JSON even with a banner in front', () => {
    expect(parseAuthStatus('claude: info: hi\n{"loggedIn": true}\n')).toEqual({ loggedIn: true });
    expect(parseAuthStatus('nope')).toBeUndefined();
  });

  it('describes every auth flavour in plain language', () => {
    expect(describeAuth({ apiProvider: 'bedrock' }, false).description).toBe('Amazon Bedrock');
    expect(
      describeAuth({ authMethod: 'claude.ai', subscriptionType: 'pro', email: 'a@b.c' }, false),
    ).toEqual({
      method: 'subscription',
      description: 'Claude Pro · a@b.c',
      email: 'a@b.c',
    });
    expect(describeAuth({ authMethod: 'api_key' }, false).method).toBe('api-key');
    expect(describeAuth({}, true).method).toBe('api-key');
  });

  it('reports not-installed when the executable is missing', async () => {
    const status = await detectClaude({ explicitPath: '/nonexistent/claude' });
    expect(status.state).toBe('not-installed');
    expect(status.install.length).toBeGreaterThan(0);
  });

  it('reports signed-out and ready from the CLI', async () => {
    const out = await fakeClaude({ loggedIn: false, banner: true });
    expect((await detectClaude({ explicitPath: out.bin })).state).toBe('signed-out');

    const signedIn = await fakeClaude({ loggedIn: true });
    const status = await detectClaude({ explicitPath: signedIn.bin });
    expect(status).toMatchObject({
      state: 'ready',
      version: '2.1.284',
      auth: { method: 'subscription', description: 'Claude Max · ada@example.com' },
    });
  });

  it('treats a stored API key as signed in', async () => {
    const out = await fakeClaude({ loggedIn: false });
    const status = await detectClaude({ explicitPath: out.bin, apiKey: 'sk-test-123456' });
    expect(status.state).toBe('ready');
    expect(status.auth?.method).toBe('api-key');
  });
});
