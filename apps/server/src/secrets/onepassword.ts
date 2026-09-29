/**
 * 1Password, as a place Conch can fetch a secret from instead of keeping it.
 *
 * Conch stores only the reference (`op://Vault/Item/credential`) and asks the
 * `op` command for the value when a turn needs it. Nothing sensitive is written
 * to `~/.conch`, and nothing sensitive is ever passed on a command line: `op`
 * takes the reference as an argument and answers on stdout.
 *
 * Sign-in is 1Password's business, not ours. On a desktop it's the app's own
 * unlock (Touch ID); on a server it's `OP_SERVICE_ACCOUNT_TOKEN`, which we pass
 * through from Conch's own environment if it's set.
 */
import { SecretReference } from '@conch/protocol';

import { agentEnv, findExecutable, run } from '../lib/proc';

const DOCS_URL = 'https://www.1password.dev/cli/secret-reference-syntax/';
export const INSTALL_COMMAND = 'brew install 1password-cli';

/** How long a resolved value is kept in memory, so one turn isn't ten unlock prompts. */
const CACHE_MS = 5 * 60_000;
/** Detection is cheap but not free, and people install `op` mid-session. */
const DETECT_MS = 30_000;
/** An unlock prompt is a human waiting for a fingerprint; give them a while. */
const READ_TIMEOUT_MS = 60_000;

export interface OnePasswordState {
  available: boolean;
  version?: string;
  message?: string;
  installCommand?: string;
  docsUrl?: string;
}

/** Raised with a sentence a person can act on. Never contains the secret. */
export class OnePasswordError extends Error {}

/**
 * `op` must not inherit Conch's own configuration, but it does need its own:
 * a service-account token or Connect host, when the operator set one.
 */
function opEnv(): Record<string, string> {
  return agentEnv();
}

/**
 * Turn `op`'s output into one sentence that says what to do next.
 *
 * 1Password documents no exit codes and doesn't promise message wording, so
 * this matches loosely — which is what 1Password's own sample code does. The
 * prefix is theirs: `[ERROR] YYYY/MM/DD HH:MM:SS <message>`.
 */
function explain(stderr: string, reference: string): string {
  const message = stderr
    .trim()
    .split('\n')[0]
    ?.replace(/^\[ERROR]\s*\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s*/, '')
    .trim();
  const text = (message ?? '').toLowerCase();
  const item = reference.split('/')[3] ?? 'that item';
  if (/signed in|signin|sign-in|locked|unlock|authoriz|authenticat|session|biometric/.test(text))
    return 'Unlock 1Password (open the app, or run `op signin`) and try again.';
  if (/isn't a vault|no vault|vault.*not found/.test(text))
    return `1Password has no vault called “${reference.split('/')[2] ?? ''}”. Check the reference.`;
  if (/isn't an item|no item|item.*not found|doesn't exist/.test(text))
    return `1Password can't find “${item}”. Check the reference, or that this account can see it.`;
  if (/field|section/.test(text) && /not exist|no such|isn't/.test(text))
    return `That item has no field called “${reference.split('/').pop() ?? ''}”.`;
  if (/service account/.test(text))
    return 'This 1Password service account can’t read that item. Give it access to the vault.';
  if (/too many requests|rate limit/.test(text))
    return '1Password is rate-limiting this token. Try again in a few minutes.';
  if (/connect/.test(text)) return '1Password Connect refused the request. Check its token.';
  // Keep 1Password's own words: they're written for people and carry no secret.
  return message ? `1Password said: ${message}` : '1Password didn’t answer.';
}

export class OnePassword {
  #path?: string;
  #state?: { value: OnePasswordState; at: number };
  #detecting?: Promise<OnePasswordState>;
  #cache = new Map<string, { value: string; at: number }>();

  constructor(private readonly deps: { find?: typeof findExecutable; run?: typeof run } = {}) {}

  /** Is `op` here, and which version? Cached briefly; `force` re-checks now. */
  state(options: { force?: boolean } = {}): Promise<OnePasswordState> {
    const cached = this.#state;
    if (cached && !options.force && Date.now() - cached.at < DETECT_MS)
      return Promise.resolve(cached.value);
    this.#detecting ??= this.#detect().finally(() => (this.#detecting = undefined));
    return this.#detecting;
  }

  async #detect(): Promise<OnePasswordState> {
    const find = this.deps.find ?? findExecutable;
    const exec = this.deps.run ?? run;
    const path = await find('op');
    let value: OnePasswordState;
    if (!path) {
      value = {
        available: false,
        message: 'Install the 1Password command line tool to keep keys in 1Password.',
        installCommand: INSTALL_COMMAND,
        docsUrl: DOCS_URL,
      };
    } else {
      const { stdout, code } = await exec(path, ['--version'], { env: opEnv(), timeout: 10_000 });
      const version = /\d+\.\d+\.\d+/.exec(stdout)?.[0];
      value =
        code === 0
          ? { available: true, version, docsUrl: DOCS_URL }
          : {
              available: false,
              message: 'The 1Password command line tool is installed but didn’t start.',
              docsUrl: DOCS_URL,
            };
    }
    this.#path = path;
    this.#state = { value, at: Date.now() };
    return value;
  }

  /**
   * The value behind a secret reference. Cached in memory for a few minutes so a
   * conversation doesn't ask for a fingerprint on every turn.
   */
  async read(reference: string, options: { force?: boolean; signal?: AbortSignal } = {}) {
    const parsed = SecretReference.safeParse(reference);
    if (!parsed.success)
      throw new OnePasswordError(parsed.error.issues[0]?.message ?? 'Bad reference.');
    const ref = parsed.data;

    const hit = this.#cache.get(ref);
    if (hit && !options.force && Date.now() - hit.at < CACHE_MS) return hit.value;

    const state = await this.state();
    if (!state.available || !this.#path)
      throw new OnePasswordError(state.message ?? 'The 1Password command line tool isn’t here.');

    const exec = this.deps.run ?? run;
    const { stdout, stderr, code } = await exec(this.#path, ['read', ref, '--no-newline'], {
      env: opEnv(),
      timeout: READ_TIMEOUT_MS,
      signal: options.signal,
    });
    if (code !== 0 || !stdout.trim()) {
      // A timeout leaves no exit code: that's an unlock prompt nobody answered.
      if (code === undefined && !stderr.trim())
        throw new OnePasswordError('1Password didn’t answer. Unlock it and try again.');
      throw new OnePasswordError(explain(stderr, ref));
    }
    const value = stdout.trim();
    this.#cache.set(ref, { value, at: Date.now() });
    return value;
  }

  /**
   * A value we already have in memory, without asking 1Password for it. Used on
   * paths that must never set off an unlock prompt, such as drawing a page.
   */
  peek(reference: string): string | undefined {
    const hit = this.#cache.get(reference.trim());
    return hit && Date.now() - hit.at < CACHE_MS ? hit.value : undefined;
  }

  /** Forget cached values — after a failure, or when the user changes a reference. */
  forget(reference?: string) {
    if (reference) this.#cache.delete(reference);
    else this.#cache.clear();
  }
}
