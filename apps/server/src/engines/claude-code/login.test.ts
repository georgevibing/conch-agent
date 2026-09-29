import type { LoginState } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { fakeClaude } from '../../test/fakeClaude';
import { detectClaude } from './detect';
import { startClaudeLogin } from './login';

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
