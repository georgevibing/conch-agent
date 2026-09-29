import { spawn } from 'node:child_process';

import type { LoginMethod, LoginState } from '@conch/protocol';

import { newId } from '../../lib/ids';
import { launch } from '../../lib/proc';
import type { LoginHandle } from '../types';
import { childEnv } from './env';

const URL_RE = /https:\/\/[^\s"'<>]+/;
const CODE_PROMPT_RE = /paste|enter (the )?(authori[sz]ation )?code|code:/i;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Drives `claude auth login` non-interactively. Claude Code opens the browser
 * itself when it can; we surface the sign-in URL as a fallback (and for remote
 * use) and forward a pasted code to its stdin when it asks for one.
 */
export function startClaudeLogin(options: {
  executablePath: string;
  method: LoginMethod;
  onUpdate: (state: LoginState) => void;
  verify: () => Promise<boolean>;
}): LoginHandle {
  const loginId = newId('login');
  let state: LoginState = { loginId, phase: 'starting' };
  let finished = false;
  const update = (patch: Partial<LoginState>) => {
    state = { ...state, ...patch };
    options.onUpdate(state);
  };

  const args = ['auth', 'login'];
  if (options.method === 'console') args.push('--console');
  const { command, prefix } = launch(options.executablePath);
  const child = spawn(command, [...prefix, ...args], {
    env: childEnv({ BROWSER: process.env.BROWSER }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let transcript = '';
  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString('utf8').replace(ANSI_RE, '');
    transcript = (transcript + text).slice(-8000);
    const url = URL_RE.exec(text)?.[0];
    if (url && !state.url) update({ phase: 'waiting-for-browser', url });
    if (CODE_PROMPT_RE.test(text)) update({ phase: 'needs-code' });
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);

  const timer = setTimeout(() => {
    if (finished) return;
    child.kill();
    update({ phase: 'failed', message: 'Sign-in timed out. Please try again.' });
    finished = true;
  }, TIMEOUT_MS);

  child.on('error', (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    update({ phase: 'failed', message: `Couldn't start Claude Code: ${error.message}` });
  });

  child.on('exit', async (code) => {
    clearTimeout(timer);
    if (finished) return;
    finished = true;
    if (code !== 0) {
      const last = transcript.trim().split('\n').filter(Boolean).at(-1);
      update({ phase: 'failed', message: last ?? `Sign-in exited with code ${code}.` });
      return;
    }
    update({ phase: 'verifying' });
    const ok = await options.verify().catch(() => false);
    update(
      ok
        ? { phase: 'done', message: 'Signed in.' }
        : {
            phase: 'failed',
            message: 'Sign-in finished, but Claude Code still reports signed out.',
          },
    );
  });

  // Emit the initial state asynchronously so callers can subscribe first.
  queueMicrotask(() => options.onUpdate(state));

  return {
    submitCode(code: string) {
      if (finished) return;
      child.stdin.write(`${code.trim()}\n`);
      update({ phase: 'verifying' });
    },
    cancel() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      update({ phase: 'cancelled' });
    },
  };
}
