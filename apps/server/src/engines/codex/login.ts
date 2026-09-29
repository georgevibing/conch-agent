/**
 * Signing Codex in from Conch.
 *
 * `codex login` opens a browser and waits on a callback server at
 * localhost:1455; `codex login --device-auth` shows a page and a short code to
 * type there instead, which is the only route that works when Conch runs on a
 * different machine from the browser. Either way the code never comes back to
 * Conch, so the `needs-code` phase is unused — we surface the URL, wait, and
 * report what the process says when it exits.
 */
import { spawn } from 'node:child_process';

import type { LoginMethod, LoginState } from '@conch/protocol';

import { newId } from '../../lib/ids';
import { agentEnv } from '../../lib/proc';
import type { LoginHandle } from '../types';

const URL_RE = /https?:\/\/[^\s"'<>]+/;
/** Device codes look like `ABCD-EFGH`; shown so the user can type it. */
const DEVICE_CODE_RE = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const TIMEOUT_MS = 10 * 60 * 1000;
/** Enough of the tail to explain a failure, not enough to be a log file. */
const TRANSCRIPT_CHARS = 8000;

function finished(state: LoginState): boolean {
  return state.phase === 'done' || state.phase === 'failed' || state.phase === 'cancelled';
}

export function startCodexLogin(
  executablePath: string,
  method: LoginMethod,
  onUpdate: (state: LoginState) => void,
): LoginHandle {
  const loginId = newId('login');
  let state: LoginState = { loginId, phase: 'starting' };
  let done = false;
  const update = (patch: Partial<LoginState>) => {
    state = { ...state, ...patch };
    if (finished(state)) done = true;
    onUpdate(state);
  };

  if (method === 'api-key') {
    // Codex reads a key from stdin (`login --with-api-key`), but Conch keeps
    // provider keys itself and passes them per turn, so there's nothing to run.
    queueMicrotask(() =>
      onUpdate({
        loginId,
        phase: 'failed',
        message: 'Save your OpenAI key in Conch instead — Codex gets it from there.',
      }),
    );
    return { submitCode() {}, cancel() {} };
  }

  // `subscription` is the ordinary browser sign-in. `console` is Conch's
  // "another way in": the device-code flow, which is what you need when the
  // browser can't reach this computer's localhost.
  const args = method === 'console' ? ['login', '--device-auth'] : ['login'];
  const child = spawn(executablePath, args, {
    env: agentEnv(),
    // Nothing is ever typed into Codex: a pipe nobody writes to would hang it.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let transcript = '';
  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString('utf8').replace(ANSI_RE, '');
    transcript = (transcript + text).slice(-TRANSCRIPT_CHARS);
    if (done) return;
    const url = URL_RE.exec(text)?.[0];
    const code = DEVICE_CODE_RE.exec(text)?.[1];
    if (url && !state.url) {
      update({
        phase: 'waiting-for-browser',
        url,
        message: code ? `Enter the code ${code} on that page.` : undefined,
      });
    } else if (code && state.phase === 'waiting-for-browser' && !state.message) {
      update({ message: `Enter the code ${code} on that page.` });
    }
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);

  const timer = setTimeout(() => {
    if (done) return;
    child.kill();
    update({ phase: 'failed', message: 'Sign-in timed out. Please try again.' });
  }, TIMEOUT_MS);

  child.on('error', (error) => {
    if (done) return;
    clearTimeout(timer);
    update({ phase: 'failed', message: `Couldn’t start Codex: ${error.message}` });
  });

  // `close`, not `exit`: it fires once the output has been read, so the last
  // line of an error is already in the transcript below.
  child.on('close', (code) => {
    clearTimeout(timer);
    if (done) return;
    if (code === 0) {
      update({ phase: 'done', message: 'Signed in.' });
      return;
    }
    const last = transcript.trim().split('\n').filter(Boolean).at(-1)?.slice(0, 200);
    update({
      phase: 'failed',
      message: last || `Sign-in stopped with exit code ${code ?? '?'}. Please try again.`,
    });
  });

  // Emit the initial state asynchronously so callers can subscribe first.
  queueMicrotask(() => onUpdate(state));

  return {
    /** Codex asks for its code on the sign-in page, never here. */
    submitCode() {},
    cancel() {
      if (done) return;
      clearTimeout(timer);
      child.kill();
      update({ phase: 'cancelled' });
    },
  };
}
