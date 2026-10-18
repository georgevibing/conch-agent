import type { LoginState } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { fakeClaude } from '../../test/fakeClaude';
import { detectClaude } from './detect';
import { signInUrl, startClaudeLogin } from './login';

function waitFor(states: LoginState[], phase: LoginState['phase']) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (states.some((s) => s.phase === phase)) return resolve();
      if (Date.now() - started > 5000)
        return reject(new Error(`timed out waiting for ${phase}: ${JSON.stringify(states)}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('signInUrl', () => {
  it('finds the OAuth page and drops trailing punctuation', () => {
    const text =
      'Docs: https://docs.claude.com/en/login.\nVisit https://claude.ai/oauth/authorize?code=true&state=abc).';
    expect(signInUrl(text)).toBe('https://claude.ai/oauth/authorize?code=true&state=abc');
  });

  it('reads an address the pipe delivered in pieces', () => {
    const first = 'If the browser did not open, visit: https://claude.ai/oauth/auth';
    expect(signInUrl(first)).toBe('https://claude.ai/oauth/auth');
    expect(signInUrl(`${first}orize?client_id=1&scope=a%20b\nPaste code here >`)).toBe(
      'https://claude.ai/oauth/authorize?client_id=1&scope=a%20b',
    );
  });

  it('is undefined before any link is printed', () => {
    expect(signInUrl('Opening browser to sign in…')).toBeUndefined();
  });
});

describe('Claude Code sign-in', () => {
  it('surfaces the URL, forwards the code and verifies', async () => {
    const { bin } = await fakeClaude({ loggedIn: false });
    const states: LoginState[] = [];
    const handle = startClaudeLogin({
      executablePath: bin,
      method: 'subscription',
      onUpdate: (s) => states.push(s),
      verify: async () => (await detectClaude({ explicitPath: bin })).state === 'ready',
    });
    await waitFor(states, 'needs-code');
    expect(states.find((s) => s.url)?.url).toContain('https://claude.ai/oauth/authorize');
    handle.submitCode('good-code');
    await waitFor(states, 'done');
  });

  it('fails gracefully on a bad code', async () => {
    const { bin } = await fakeClaude({ loggedIn: false });
    const states: LoginState[] = [];
    const handle = startClaudeLogin({
      executablePath: bin,
      method: 'subscription',
      onUpdate: (s) => states.push(s),
      verify: async () => false,
    });
    await waitFor(states, 'needs-code');
    handle.submitCode('nope');
    await waitFor(states, 'failed');
    expect(states.at(-1)?.message).toContain('Invalid code');
  });

  it('can be cancelled', async () => {
    const { bin } = await fakeClaude({ loggedIn: false });
    const states: LoginState[] = [];
    const handle = startClaudeLogin({
      executablePath: bin,
      method: 'console',
      onUpdate: (s) => states.push(s),
      verify: async () => false,
    });
    await waitFor(states, 'needs-code');
    handle.cancel();
    expect(states.at(-1)?.phase).toBe('cancelled');
  });
});
