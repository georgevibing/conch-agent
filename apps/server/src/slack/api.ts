/**
 * The few Slack Web API calls Conch makes with a person's own token
 * (ADR 0049). One fixed origin, a short list of methods, no redirects, a
 * timeout, a bounded answer, and the token never in a URL or an error.
 */
import { redact } from '../channels/types';

/** Slack's Web API. Only tests and the pretend Slack (`pnpm dev:mock`, E2E) point elsewhere. */
export const SLACK_WEB_API = 'https://slack.com/api';

/** The methods Conch calls, and only these. */
const METHODS = new Set([
  'auth.test',
  'auth.revoke',
  'users.conversations',
  'conversations.info',
  'conversations.history',
  'conversations.replies',
  'search.messages',
  'users.info',
  'chat.postMessage',
]);

/** Writes: a failure after they left may still have happened. */
const WRITES = new Set(['chat.postMessage']);

/** An answer bigger than this is cut off (Slack's own pages are far smaller). */
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'user_removed_from_team',
  'team_disabled',
]);

export type SlackApiErrorKind =
  /** The token is refused: connect again. */
  | 'auth'
  /** The app lacks a permission: reinstall it with the settings Conch gives. */
  | 'scope'
  | 'rate-limit'
  /** Slack couldn't be reached; nothing was done. */
  | 'network'
  /** A write may or may not have happened. */
  | 'ambiguous'
  /** Stopped before it left. */
  | 'not-executed'
  /** Slack said no, for its own reason (a channel you're not in…). */
  | 'refused'
  | 'invalid';

export class SlackApiError extends Error {
  constructor(
    readonly kind: SlackApiErrorKind,
    message: string,
    readonly detail: { code?: string; retryAfterMs?: number; needed?: string } = {},
  ) {
    super(message);
  }
}

export interface SlackAnswer<T> {
  data: T;
  /** What the token may do, from Slack's `x-oauth-scopes` header. */
  scopes?: string[];
}

export interface SlackCallOptions {
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Where the Web API is; `SLACK_WEB_API` unless a test says otherwise. */
  base?: string;
}

/** What Slack's own error codes mean, in words a person (and a model) can act on. */
function refusal(code: string): string {
  switch (code) {
    case 'channel_not_found':
      return 'Slack can’t find that channel, or you’re not in it. List the channels with slack_channels and use one of their ids.';
    case 'not_in_channel':
      return 'You’re not in that channel in Slack, so Conch can’t post there for you.';
    case 'is_archived':
      return 'That channel is archived in Slack, so nothing can be posted to it.';
    case 'msg_too_long':
      return 'That message is too long for Slack. Make it shorter.';
    case 'no_text':
      return 'There’s nothing to send.';
    case 'thread_not_found':
      return 'Slack can’t find that thread. Read the channel again for the right message.';
    case 'restricted_action':
      return 'This workspace doesn’t let you post there.';
    default:
      return `Slack said no (${code}).`;
  }
}

async function bounded(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new SlackApiError('refused', 'Slack’s answer was too large.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new SlackApiError('refused', 'Slack’s answer was too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One Web API call with the person's token. Slack answers 200 with
 * `ok: false` for its own errors; those become a `SlackApiError` whose
 * message says what to do.
 */
export async function slackCall<T extends Record<string, unknown>>(
  token: string,
  method: string,
  params: Record<string, string | number | boolean | undefined> = {},
  options: SlackCallOptions = {},
): Promise<SlackAnswer<T & { ok: true }>> {
  if (!METHODS.has(method)) throw new SlackApiError('invalid', 'Conch doesn’t do that in Slack.');
  if (options.signal?.aborted)
    throw new SlackApiError('not-executed', 'Stopped before anything was sent to Slack.');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) body.set(key, String(value));
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const write = WRITES.has(method);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${options.base ?? SLACK_WEB_API}/${method}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body,
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted && !write)
      throw new SlackApiError('not-executed', 'Stopped before Slack answered.');
    throw write
      ? new SlackApiError(
          'ambiguous',
          'Slack didn’t answer, so the message may or may not have been sent. Look in the channel before sending it again.',
        )
      : new SlackApiError(
          'network',
          redact(`Couldn’t reach Slack (${(error as Error).message}).`, token),
        );
  }
  if (response.status === 429) {
    const after = Number(response.headers.get('retry-after') ?? 2);
    throw new SlackApiError(
      'rate-limit',
      `Slack asked Conch to slow down. Try again in ${Math.max(1, Math.round(after))} seconds.`,
      { retryAfterMs: Math.max(1, after) * 1000 },
    );
  }
  if (response.status >= 500)
    throw write
      ? new SlackApiError(
          'ambiguous',
          'Slack had a problem, so the message may or may not have been sent. Look in the channel before sending it again.',
        )
      : new SlackApiError('network', `Slack had a problem (${response.status}). Try again soon.`);
  let data: { ok?: boolean; error?: string; needed?: string } & Record<string, unknown>;
  try {
    data = JSON.parse(await bounded(response)) as typeof data;
  } catch (error) {
    if (error instanceof SlackApiError) throw error;
    throw new SlackApiError(
      write ? 'ambiguous' : 'network',
      write
        ? 'Slack’s answer didn’t make sense, so the message may have been sent. Look in the channel first.'
        : 'Slack’s answer didn’t make sense. Try again soon.',
    );
  }
  const scopes = response.headers
    .get('x-oauth-scopes')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (data.ok === true) return { data: data as T & { ok: true }, scopes };
  const code = typeof data.error === 'string' ? data.error.slice(0, 80) : 'unknown_error';
  if (AUTH_ERRORS.has(code))
    throw new SlackApiError(
      'auth',
      'Slack doesn’t accept this sign-in any more. Connect Slack again.',
      {
        code,
      },
    );
  if (code === 'missing_scope')
    throw new SlackApiError(
      'scope',
      'The Slack app is missing a permission. Open Slack in Integrations and follow “Give it what it needs”.',
      { code, ...(typeof data.needed === 'string' && { needed: data.needed.slice(0, 80) }) },
    );
  if (code === 'ratelimited')
    throw new SlackApiError(
      'rate-limit',
      'Slack asked Conch to slow down. Try again in a minute.',
      {
        code,
        retryAfterMs: 60_000,
      },
    );
  throw new SlackApiError('refused', refusal(code), { code });
}
