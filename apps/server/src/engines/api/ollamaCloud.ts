/**
 * Ollama Cloud — big open models on Ollama's servers (ADR 0053), two ways in:
 *
 *  - **A key** from ollama.com: Conch talks to `https://ollama.com/v1` itself.
 *  - **Signing in through the Ollama app** already on this computer: no key to
 *    copy. The app signs each cloud request with this computer's own key, so
 *    Conch sends it through the local Ollama with the model's cloud name
 *    (`gpt-oss:120b-cloud`, `gemma4:cloud`).
 *
 * Details from Ollama's docs and source, checked live on 2026-10-02/03:
 *  - `POST /api/me` (it must be POST) on the local Ollama says whether it's
 *    signed in: 401 with a `signin_url` when not, 200 with the account when it is;
 *  - `ollama signin` only prints that page and exits, so Conch shows the page
 *    itself and watches `/api/me` until it turns 200;
 *  - a cloud model's name gains `-cloud` when it has a tag, `:cloud` when not;
 *  - the cloud's own list (`/api/tags`, `/api/show`) reads without a key.
 */
import type { LoginState } from '@conch/protocol';
import { z } from 'zod';

import type { Completion, LoginHandle } from '../types';
import { newId } from '../../lib/ids';
import { OpenAiWire, type ChatPreset } from './openai';
import type { OllamaLink } from './ollama';
import { PRESETS } from './presets';
import { defaultHome } from './session';
import {
  ApiError,
  type ApiDeps,
  type ApiVariant,
  type FetchLike,
  type WireAccount,
  type WireCompletion,
  type WireEvent,
  type WireMessage,
  type WireModel,
  type WireRequest,
} from './types';
import type { ToolResult, Wire } from './wire';

const LABEL = 'Ollama Cloud';
const LOGIN_MS = 10 * 60_000;
const POLL_MS = 2_000;

const Me = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
  plan: z.string().nullish(),
});
const SignIn = z.object({ signin_url: z.string().url() });

/** A cloud model's name as the local Ollama knows it. */
export function cloudName(model: string): string {
  if (/[-:]cloud$/.test(model)) return model;
  return model.includes(':') ? `${model}-cloud` : `${model}:cloud`;
}

/** The account the local Ollama is signed in to, or the page that signs it in. */
export async function localAccount(
  link: Pick<OllamaLink, 'client'>,
  signal?: AbortSignal,
): Promise<{ signedIn: true; name?: string; plan?: string } | { signedIn: false; url?: string }> {
  const response = await link.client.fetch(link.client.url('/api/me'), {
    method: 'POST',
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(5_000),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    const me = Me.safeParse(body);
    return {
      signedIn: true,
      ...(me.success &&
        (me.data.name || me.data.email) && { name: me.data.name ?? me.data.email ?? undefined }),
      ...(me.success && me.data.plan && { plan: me.data.plan }),
    };
  }
  const page = SignIn.safeParse(body);
  // The page Ollama gives must be its own, over https.
  const url =
    page.success && new URL(page.data.signin_url).hostname === 'ollama.com'
      ? page.data.signin_url
      : undefined;
  return { signedIn: false, ...(url && { url }) };
}

class OllamaCloudWire implements Wire {
  readonly source = LABEL;
  #through: 'key' | 'app' = 'key';

  constructor(
    private readonly direct: OpenAiWire,
    private readonly viaApp: OpenAiWire,
    private readonly link: OllamaLink | undefined,
  ) {}

  #wire() {
    return this.#through === 'app' ? this.viaApp : this.direct;
  }

  async check({ key, signal }: { key: string; signal?: AbortSignal }): Promise<WireAccount> {
    if (key) {
      this.#through = 'key';
      return this.direct.check({ key, ...(signal && { signal }) });
    }
    if (!this.link)
      throw new ApiError('auth', 'Paste an Ollama key, or sign in through the Ollama app.');
    // Only asks: a look at the Providers page never starts Ollama. Signing in does.
    const running = await this.link.client.version().catch(() => undefined);
    if (!running)
      throw new ApiError(
        'auth',
        'Paste an Ollama key, or sign in through the Ollama app: Sign in starts it for you.',
      );
    const account = await localAccount(this.link, signal).catch(() => ({
      signedIn: false as const,
    }));
    if (!account.signedIn)
      throw new ApiError(
        'auth',
        'Sign in to Ollama through the app on this computer, or paste a key.',
      );
    this.#through = 'app';
    const who = [
      account.name,
      account.plan && `${account.plan[0]?.toUpperCase()}${account.plan.slice(1)} plan`,
    ]
      .filter(Boolean)
      .join(' · ');
    return { description: `Through the Ollama app${who ? ` · ${who}` : ''}` };
  }

  models(input: { key?: string; signal?: AbortSignal }): Promise<WireModel[]> {
    // Both ways list the cloud's own models, which read without a key.
    return this.direct.models(input);
  }

  stream(request: WireRequest): AsyncIterable<WireEvent> {
    if (this.#through === 'app' && !request.key)
      return this.viaApp.stream({ ...request, model: cloudName(request.model) });
    return this.direct.stream(request);
  }

  complete(request: WireCompletion): Promise<Completion> {
    if (this.#through === 'app' && !request.key)
      return this.viaApp.complete({ ...request, model: cloudName(request.model) });
    return this.direct.complete(request);
  }

  userMessage(text: string, images?: Parameters<Wire['userMessage']>[1]): WireMessage {
    return this.#wire().userMessage(text, images);
  }

  toolResults(results: ToolResult[]): WireMessage[] {
    return this.#wire().toolResults(results);
  }

  smallModel(): string | undefined {
    return this.direct.smallModel();
  }

  toolsFor(model: string): boolean | undefined {
    return this.direct.toolsFor(model);
  }
}

/** Ollama Cloud, ready for `services.ts`: a key, or the Ollama app's own sign-in. */
export function ollamaCloudVariant(link: OllamaLink | undefined, deps: ApiDeps = {}): ApiVariant {
  const fetchImpl: FetchLike = deps.fetch ?? globalThis.fetch;
  const preset = PRESETS.find((p) => p.id === 'ollama-cloud') as ChatPreset & {
    docsUrl: string;
    keyUrl: string;
  };
  const appPreset: ChatPreset = {
    ...preset,
    get endpoints() {
      return [{ id: 'app', base: link ? link.client.url('/v1') : 'http://127.0.0.1:11434/v1' }];
    },
    key: 'optional',
    plainHttp: true,
  };
  const login = (update: (state: LoginState) => void): LoginHandle => {
    const loginId = newId('login');
    const abort = new AbortController();
    let done = false;
    const emit = (state: Omit<LoginState, 'loginId'>) => {
      if (done) return;
      update({ loginId, ...state });
      if (['done', 'failed', 'cancelled'].includes(state.phase)) done = true;
    };
    const timer = setTimeout(() => {
      emit({ phase: 'failed', message: 'Signing in took too long. Start again.' });
      abort.abort();
    }, LOGIN_MS).unref();
    queueMicrotask(() => {
      void (async () => {
        emit({ phase: 'starting' });
        if (!link || !(await link.ensureRunning({ note: true }).catch(() => false)))
          throw new Error(
            'Signing in goes through the Ollama app. Install it first, or paste a key.',
          );
        const first = await localAccount(link);
        if (!first.signedIn) {
          if (!first.url)
            throw new Error('Ollama didn’t give a sign-in page. Update Ollama, or paste a key.');
          emit({
            phase: 'waiting-for-browser',
            url: first.url,
            message:
              'Sign in to your Ollama account on the page that opens. This updates by itself.',
          });
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            if (abort.signal.aborted) throw new Error('Cancelled.');
            const now = await localAccount(link).catch(() => undefined);
            if (now?.signedIn) break;
          }
        }
        emit({ phase: 'done', message: 'Ollama Cloud is connected through the Ollama app.' });
      })()
        .catch((error: unknown) =>
          emit({
            phase: abort.signal.aborted ? 'cancelled' : 'failed',
            message:
              error instanceof Error && error.message ? error.message : 'Signing in didn’t finish.',
          }),
        )
        .finally(() => clearTimeout(timer));
    });
    return {
      submitCode() {},
      cancel() {
        emit({ phase: 'cancelled' });
        clearTimeout(timer);
        abort.abort();
      },
    };
  };
  return {
    id: 'ollama-cloud',
    label: LABEL,
    docsUrl: preset.docsUrl,
    keyUrl: preset.keyUrl,
    // Signing in is Ollama's own, through the app: offered when the app is here.
    canSignIn: Boolean(link),
    keyOptional: true,
    login,
    wire: new OllamaCloudWire(
      new OpenAiWire(preset, fetchImpl),
      new OpenAiWire(appPreset, link?.client?.fetch ?? fetchImpl),
      link,
    ),
    home: deps.home ?? defaultHome(),
  };
}
