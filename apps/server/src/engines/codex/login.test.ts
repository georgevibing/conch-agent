import type { LoginState } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { fakeCodex } from '../../test/fakeCodex';
import { startCodexLogin } from './login';

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

describe('Codex sign-in', () => {
  it('surfaces the sign-in page, then finishes when Codex exits', async () => {
    const codex = await fakeCodex();
    const states: LoginState[] = [];
    startCodexLogin(codex.bin, 'subscription', (state) => states.push(state));
    await waitFor(states, 'done');
    expect(states.find((s) => s.url)?.url).toContain('http://localhost:1455/');
    expect(states.some((s) => s.phase === 'waiting-for-browser')).toBe(true);
    expect(states.at(-1)?.message).toBe('Signed in.');
    expect(await codex.calls()).toEqual([['login']]);
  });

  it('uses the device-code flow for the other way in, and shows the code', async () => {
    const codex = await fakeCodex({
      loginUrl: 'https://chatgpt.com/device',
      loginCode: 'BDRX-4KQP',
    });
    const states: LoginState[] = [];
    startCodexLogin(codex.bin, 'console', (state) => states.push(state));
    await waitFor(states, 'done');
    expect(await codex.calls()).toEqual([['login', '--device-auth']]);
    // The address and the code can arrive in one chunk or two, so take the
    // last word on it rather than the first.
    const waiting = states.filter((s) => s.phase === 'waiting-for-browser').at(-1);
    expect(waiting?.url).toBe('https://chatgpt.com/device');
    expect(waiting?.message).toContain('BDRX-4KQP');
  });

  it('explains a sign-in that didn’t finish', async () => {
    const codex = await fakeCodex({ loginFails: true });
    const states: LoginState[] = [];
    startCodexLogin(codex.bin, 'subscription', (state) => states.push(state));
    await waitFor(states, 'failed');
    expect(states.at(-1)?.message).toContain('sign-in was not completed');
  });

  it('fails with a plain message when Codex isn’t there', async () => {
    const states: LoginState[] = [];
    startCodexLogin('/nonexistent/codex', 'subscription', (state) => states.push(state));
    await waitFor(states, 'failed');
    expect(states.at(-1)?.message).toContain('Couldn’t start Codex');
  });

  it('sends people to Conch for a key instead of pretending to run one', async () => {
    const states: LoginState[] = [];
    const handle = startCodexLogin('/nonexistent/codex', 'api-key', (state) => states.push(state));
    await waitFor(states, 'failed');
    expect(states.at(-1)?.message).toContain('Save your OpenAI key in Conch');
    // The no-op handle must stay safe to call.
    handle.submitCode('1234');
    handle.cancel();
  });

  it('can be cancelled', async () => {
    const codex = await fakeCodex({ hangSeconds: 1 });
    const states: LoginState[] = [];
    const handle = startCodexLogin(codex.bin, 'subscription', (state) => states.push(state));
    await waitFor(states, 'starting');
    handle.cancel();
    expect(states.at(-1)?.phase).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(states.at(-1)?.phase).toBe('cancelled');
  });
});
