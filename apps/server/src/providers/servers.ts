/**
 * Servers you run yourself — llama.cpp, vLLM, Jan, LiteLLM, a gateway at work,
 * or a service with an OpenAI-compatible address (ADR 0053).
 *
 * Each server you add is a provider of its own (`server-xxxxxxxx`), with the
 * name you gave it, in the picker and on its own card. This file is what
 * adding one takes: reading an address the way a person types it, looking at
 * what answers there (and saying what it is, when Conch can tell), and finding
 * the servers already running on this computer so adding one is one press.
 *
 * Safety: an address is only ever reached over https, or over plain http when
 * it stays on this computer or your own network (`isPrivateUrl`). A key goes
 * only to the server it was given for. Nothing here follows a redirect.
 */
import { randomInt } from 'node:crypto';

import type { ServerPreset, ServerProbe } from '@conch/protocol';

import { isLoopbackUrl, isPrivateUrl } from '../local/host';
import { send } from '../engines/api/wire';
import { ApiError, type FetchLike } from '../engines/api/types';

/** A short look: a server on this computer answers in a blink, or isn't there. */
const LOCAL_LOOK_MS = 700;
const PROBE_MS = 8_000;

/** Where the usual servers listen when nobody changed it. */
export const LOCAL_PORTS: readonly { port: number; hint: string }[] = [
  { port: 8080, hint: 'llama.cpp' },
  { port: 8000, hint: 'vLLM' },
  { port: 1337, hint: 'Jan' },
  { port: 4000, hint: 'LiteLLM' },
  { port: 5000, hint: 'text-generation-webui' },
  { port: 5001, hint: 'KoboldCpp' },
  { port: 4891, hint: 'GPT4All' },
  { port: 13305, hint: 'Lemonade' },
];

/** Servers people commonly add: a starting point, never a requirement. */
export const SERVER_PRESETS: readonly ServerPreset[] = [
  {
    id: 'llamacpp',
    name: 'llama.cpp',
    tagline: 'llama-server on this computer',
    url: 'http://127.0.0.1:8080/v1',
    local: true,
  },
  {
    id: 'vllm',
    name: 'vLLM',
    tagline: 'A vLLM server you run',
    url: 'http://127.0.0.1:8000/v1',
    local: true,
  },
  {
    id: 'jan',
    name: 'Jan',
    tagline: 'Jan’s local API server',
    url: 'http://127.0.0.1:1337/v1',
    local: true,
  },
  {
    id: 'litellm',
    name: 'LiteLLM',
    tagline: 'Your LiteLLM proxy',
    url: 'http://127.0.0.1:4000/v1',
    local: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    tagline: 'Open models, low prices',
    url: 'https://api.together.ai/v1',
    local: false,
    keyUrl: 'https://api.together.ai/settings/projects/~current/api-keys',
    color: '#0F6FFF',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    tagline: 'Fast hosting for open models',
    url: 'https://api.fireworks.ai/inference/v1',
    local: false,
    keyUrl: 'https://fireworks.ai/account/api-keys',
    color: '#5019C5',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    tagline: 'Many hosts’ open models, one token',
    url: 'https://router.huggingface.co/v1',
    local: false,
    keyUrl:
      'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained',
    color: '#FF9D00',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    tagline: 'A free sandbox of open models',
    url: 'https://integrate.api.nvidia.com/v1',
    local: false,
    keyUrl: 'https://build.nvidia.com',
    color: '#76B900',
  },
  {
    id: 'venice',
    name: 'Venice',
    tagline: 'Private, uncensored models',
    url: 'https://api.venice.ai/api/v1',
    local: false,
    keyUrl: 'https://venice.ai/settings/api',
    color: '#E74C3C',
  },
];

/**
 * Some services list their models to anyone, so a list proves nothing about a
 * key. For those, a page that only answers a good key — on the same company's
 * own host.
 */
const KEY_CHECKS: readonly { host: RegExp; url: (base: string) => string }[] = [
  { host: /^router\.huggingface\.co$/, url: () => 'https://huggingface.co/api/whoami-v2' },
  { host: /^api\.venice\.ai$/, url: (base) => `${base}/api_keys/rate_limits` },
];

/** The page that proves a key for this server, when its model list can't. */
export function keyCheckFor(base: string): string | undefined {
  try {
    const host = new URL(base).hostname;
    return KEY_CHECKS.find((check) => check.host.test(host))?.url(base);
  } catch {
    return undefined;
  }
}

/** A new server's id. */
export function newServerId(): `server-${string}` {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `server-${Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('')}`;
}

/**
 * The addresses worth trying for what someone typed: `localhost:8080`,
 * `gpu-box:8000/v1`, `https://api.together.ai/v1/chat/completions`. Plain
 * http is assumed only where it stays private; everything else is https.
 */
export function candidates(raw: string): string[] {
  let typed = raw.trim().replace(/\s+/g, '');
  if (!typed) return [];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(typed)) {
    const host = typed.split(/[/:?#]/)[0] ?? '';
    typed = `${isPrivateUrl(`http://${host}`) ? 'http' : 'https'}://${typed}`;
  }
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return [];
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
  url.hash = '';
  url.search = '';
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|completions|models)$/, '');
  const base = `${url.origin}${path}`;
  // An address that already names its version is taken as it is.
  if (/\/v\d+[a-z]*$/i.test(path) || /\/openai$/i.test(path)) return [base];
  return [...new Set([`${base}/v1`, base])];
}

/** Whether Conch may send to this address at all. */
export function reachable(url: string): boolean {
  return url.startsWith('https://') || isPrivateUrl(url);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a model server is, from what it said about itself. */
export function fingerprint(headers: Headers, list: unknown[]): string | undefined {
  if (/llama\.cpp/i.test(headers.get('server') ?? '')) return 'llama.cpp';
  const owners = new Set(list.filter(isRecord).map((m) => String(m.owned_by ?? '')));
  if (owners.has('llamacpp')) return 'llama.cpp';
  if (owners.has('vllm')) return 'vLLM';
  if (owners.has('koboldcpp')) return 'KoboldCpp';
  if (owners.has('humanity')) return 'GPT4All';
  if (owners.has('library') || owners.has('ollama')) return 'Ollama';
  return undefined;
}

async function listAt(
  fetchImpl: FetchLike,
  base: string,
  key: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; headers: Headers; list?: unknown[] }> {
  const response = await send({
    fetchImpl,
    url: `${base}/models`,
    method: 'GET',
    headers: { accept: 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    label: 'That server',
    ...(key && { key }),
    plain: true,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    return { status: response.status, headers: response.headers };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 0, headers: response.headers };
  }
  const list = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : undefined;
  return { status: response.status, headers: response.headers, ...(list && { list }) };
}

/** Ollama and LM Studio have cards of their own, with more than a server can offer. */
async function ownCard(fetchImpl: FetchLike, base: string): Promise<string | undefined> {
  const origin = new URL(base).origin;
  const host = new URL(base).hostname;
  if (host !== 'localhost' && !isLoopbackUrl(`${origin}/`)) return undefined;
  const look = async (path: string) => {
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(LOCAL_LOOK_MS),
      });
      return response.ok ? await response.text() : undefined;
    } catch {
      return undefined;
    }
  };
  if ((await look('/lmstudio-greeting'))?.includes('"lmstudio"')) return 'LM Studio';
  if ((await look('/'))?.includes('Ollama is running')) return 'Ollama';
  return undefined;
}

/**
 * Look at an address before adding it: what answers, what it is, how many
 * models it has, and whether it wants a key. Says why in one sentence when
 * something's wrong.
 */
export async function probeServer(
  fetchImpl: FetchLike,
  raw: string,
  key?: string,
): Promise<ServerProbe> {
  const tries = candidates(raw);
  if (!tries.length) return { ok: false, message: 'That doesn’t look like an address.' };
  if (!tries.some(reachable))
    return {
      ok: false,
      message:
        'Plain http only works on this computer or your own network. Use the server’s https address.',
    };
  let refused: string | undefined;
  for (const base of tries.filter(reachable)) {
    try {
      const own = await ownCard(fetchImpl, base);
      if (own)
        return {
          ok: false,
          url: base,
          kind: own,
          message: `That’s ${own}, which has its own card in Providers — connect it there for the most it can do.`,
        };
      const answer = await listAt(fetchImpl, base, key || undefined, PROBE_MS);
      if (answer.status === 401 || answer.status === 403) {
        refused = base;
        continue;
      }
      if (!answer.list) continue;
      const check = keyCheckFor(base);
      // Its list is anyone's to read; chatting isn't. Without a key, it isn't ready to add.
      if (check && !key)
        return {
          ok: false,
          url: base,
          needsKey: true,
          message: 'This service lists its models to anyone, but chatting needs its key.',
        };
      if (check && key) {
        const proof = await send({
          fetchImpl,
          url: check,
          method: 'GET',
          headers: { authorization: `Bearer ${key}` },
          label: 'That service',
          key,
          signal: AbortSignal.timeout(PROBE_MS),
        });
        void proof.body?.cancel().catch(() => undefined);
        if (proof.status === 401 || proof.status === 403)
          return { ok: false, url: base, needsKey: true, message: 'That key wasn’t accepted.' };
      }
      return {
        ok: true,
        url: base,
        models: answer.list.length,
        ...(fingerprint(answer.headers, answer.list) && {
          kind: fingerprint(answer.headers, answer.list),
        }),
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.kind === 'other' &&
        /https|network/i.test(error.message)
      )
        return { ok: false, message: error.message };
      // Nothing there, or not a chat server: try the next way of reading the address.
    }
  }
  if (refused)
    return {
      ok: false,
      url: refused,
      needsKey: true,
      message: key ? 'That key wasn’t accepted.' : 'This server asks for a key.',
    };
  return {
    ok: false,
    message:
      'Nothing answered like a chat server there. Check the address, and that the server is running.',
  };
}

/** A model server already running on this computer, worth one press to add. */
export interface LocalServer {
  url: string;
  kind?: string;
  port: number;
  models: number;
}

/**
 * The servers running on this computer right now, on the ports they listen
 * on by default. Only this computer is looked at, and only for a moment.
 */
export async function localServers(fetchImpl: FetchLike): Promise<LocalServer[]> {
  const found = await Promise.all(
    LOCAL_PORTS.map(async ({ port }) => {
      const base = `http://127.0.0.1:${port}/v1`;
      try {
        const answer = await listAt(fetchImpl, base, undefined, LOCAL_LOOK_MS);
        if (!answer.list) return undefined;
        return {
          url: base,
          port,
          models: answer.list.length,
          // Said only when the server says so: two kinds share port 8080.
          ...(fingerprint(answer.headers, answer.list) && {
            kind: fingerprint(answer.headers, answer.list),
          }),
        };
      } catch {
        return undefined;
      }
    }),
  );
  return found.filter((s): s is LocalServer => Boolean(s));
}
