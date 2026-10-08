/**
 * Signing in through a cloud's own program (`aws sso login`, `gcloud auth
 * application-default login`, `az login`). The program opens the browser on
 * this computer when it can; Conch shows the page and the short code it
 * prints too, so the same sign-in works from a phone. Conch never sees the
 * password or the token: the program keeps them where it always does.
 */
import type { LoginState } from '@conch/protocol';

import { newId } from '../lib/ids';
import type { LoginHandle } from '../engines/types';
import { clean, type CloudExec, type CloudProgram } from './exec';

const LOGIN_MS = 10 * 60_000;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const URL_RE = /https:\/\/[^\s"'<>)]+/;

/** A sign-in page the program printed, only when it's on the cloud's own hosts. */
export function pageIn(line: string, hosts: RegExp): string | undefined {
  const url = URL_RE.exec(line.replace(ANSI, ''))?.[0]?.replace(/[.,]$/, '');
  if (!url) return undefined;
  try {
    return hosts.test(new URL(url).hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

export interface SignInSpec {
  program: CloudProgram;
  args: string[];
  /** Tried when the program doesn't know `args` (an older version without a flag). */
  fallback?: string[];
  /** The hosts a sign-in page may be on. */
  hosts: RegExp;
  /** The code a device sign-in shows, when there is one. */
  code?: RegExp;
  /** What to say while the browser is open. */
  waiting: string;
  /** Signed in: check it took. */
  verify: () => Promise<boolean>;
  /** Said when it's done. */
  done: string;
}

export function signIn(
  exec: CloudExec,
  spec: SignInSpec,
  update: (state: LoginState) => void,
): LoginHandle {
  const loginId = newId('login');
  let finished = false;
  let state: LoginState = { loginId, phase: 'starting' };
  const emit = (patch: Partial<LoginState>) => {
    if (finished) return;
    state = { ...state, ...patch };
    update(state);
    if (['done', 'failed', 'cancelled'].includes(state.phase)) finished = true;
  };
  let running: ReturnType<CloudExec['spawn']> | undefined;
  const timer = setTimeout(() => {
    running?.kill();
    emit({ phase: 'failed', message: 'Signing in took too long. Start again.' });
  }, LOGIN_MS);
  timer.unref?.();

  const attempt = (args: string[]) => {
    const said: string[] = [];
    let unknownFlag = false;
    running = exec.spawn(spec.program, args, (raw) => {
      const line = raw.replace(ANSI, '');
      said.push(line);
      if (said.length > 40) said.shift();
      if (/unknown option|unrecognized arguments|invalid choice|no such option/i.test(line))
        unknownFlag = true;
      // The first page it names is the sign-in page; later ones only report back.
      const url = state.url ?? pageIn(line, spec.hosts);
      const code = state.code ?? spec.code?.exec(line)?.[1];
      if ((url && url !== state.url) || (code && code !== state.code))
        emit({
          phase: 'waiting-for-browser',
          ...(url && { url }),
          ...(code && { code }),
          message: spec.waiting,
        });
    });
    void running.done.then(async (code) => {
      if (finished) return;
      if (code !== 0 && unknownFlag && spec.fallback && args !== spec.fallback) {
        attempt(spec.fallback);
        return;
      }
      if (code === 127) {
        emit({ phase: 'failed', message: 'Install the cloud’s own program first.' });
        return;
      }
      if (code !== 0) {
        emit({
          phase: 'failed',
          message: clean(said.join('\n')) || 'Signing in didn’t finish. Start again.',
        });
        return;
      }
      emit({ phase: 'verifying' });
      const ok = await spec.verify().catch(() => false);
      emit(
        ok
          ? { phase: 'done', message: spec.done }
          : { phase: 'failed', message: 'You signed in, but it didn’t take yet. Try once more.' },
      );
    });
  };

  queueMicrotask(() => {
    emit({ phase: 'starting' });
    attempt(spec.args);
  });
  return {
    submitCode() {},
    cancel() {
      running?.kill();
      clearTimeout(timer);
      emit({ phase: 'cancelled' });
    },
  };
}
