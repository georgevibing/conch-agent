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

  describe('the Claude Code that comes with Conch', () => {
    it('is used when none is installed: then only a sign-in is left', async () => {
      const bundled = await fakeClaude({ loggedIn: false });
      const status = await detectClaude({
        find: () => Promise.resolve(undefined),
        bundled: () => bundled.bin,
      });
      expect(status).toMatchObject({
        state: 'signed-out',
        bundled: true,
        executablePath: bundled.bin,
      });
      expect(status.fix).toBeUndefined();
    });

    it('stands in for an installed one that won’t start, and says so once, quietly', async () => {
      const broken = await fakeClaude({ broken: true });
      const bundled = await fakeClaude({ loggedIn: true });
      const notes: string[] = [];
      const status = await detectClaude({
        find: () => Promise.resolve(broken.bin),
        bundled: () => bundled.bin,
        onHeal: (message) => notes.push(message),
      });
      expect(status).toMatchObject({ state: 'ready', bundled: true, executablePath: bundled.bin });
      expect(notes).toEqual(['Used the Claude Code that comes with Conch. Yours wouldn’t start.']);
    });

    it('stands in for one too old to say who’s signed in', async () => {
      const old = await fakeClaude({ old: true, loggedIn: true });
      const bundled = await fakeClaude({ loggedIn: true });
      const notes: string[] = [];
      const status = await detectClaude({
        find: () => Promise.resolve(old.bin),
        bundled: () => bundled.bin,
        onHeal: (message) => notes.push(message),
      });
      expect(status).toMatchObject({ state: 'ready', bundled: true });
      expect(notes[0]).toMatch(/too old/);
    });

    it('keeps the installed one when it works', async () => {
      const installed = await fakeClaude({ loggedIn: true });
      const bundled = await fakeClaude({ loggedIn: true });
      const status = await detectClaude({
        find: () => Promise.resolve(installed.bin),
        bundled: () => bundled.bin,
      });
      expect(status).toMatchObject({ executablePath: installed.bin, bundled: false });
    });

    it('offers to install or update when there’s nothing to fall back on', async () => {
      const none = await detectClaude({
        find: () => Promise.resolve(undefined),
        bundled: () => undefined,
      });
      expect(none).toMatchObject({
        state: 'not-installed',
        fix: { need: 'claude-code', kind: 'install' },
      });
      const broken = await fakeClaude({ broken: true });
      const stuck = await detectClaude({
        find: () => Promise.resolve(broken.bin),
        bundled: () => undefined,
      });
      expect(stuck).toMatchObject({ state: 'error', fix: { need: 'claude-code', kind: 'update' } });
    });

    it('never swaps in for a path you set yourself', async () => {
      const bundled = await fakeClaude({ loggedIn: true });
      const status = await detectClaude({
        explicitPath: '/nonexistent/claude',
        bundled: () => bundled.bin,
      });
      expect(status.state).toBe('not-installed');
      expect(status.fix).toBeUndefined();
    });
  });

  it('treats a stored API key as signed in', async () => {
    const out = await fakeClaude({ loggedIn: false });
    const status = await detectClaude({ explicitPath: out.bin, apiKey: 'sk-test-123456' });
    expect(status.state).toBe('ready');
    expect(status.auth?.method).toBe('api-key');
  });
});
