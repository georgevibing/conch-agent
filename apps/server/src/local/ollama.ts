/**
 * Ollama's own HTTP API, the few calls Conch needs — all of them on this
 * computer (`host.ts`), none of them on the internet.
 *
 *  - `GET /api/version`: is it running?
 *  - `GET /api/tags`: which models are here (read from disk by Ollama, offline).
 *  - `POST /api/show`: what one model can do (`capabilities`) and how much it can read.
 *  - `GET /api/ps`: which models are in memory right now.
 *  - `POST /api/pull`: get a model, streamed as NDJSON progress. This is the
 *    only call that makes Ollama reach the internet, and only a person starts it.
 *
 * Every reply is untrusted until Zod agrees with its shape. The chat itself is
 * the wire's (`engines/api/ollama.ts`).
 */
import { z } from 'zod';

import { sseLines } from '../engines/api/sse';
import { ApiError, type FetchLike } from '../engines/api/types';
import { send, text, validate } from '../engines/api/wire';

export const LABEL = 'Ollama';

const Details = z
  .object({
    family: z.string().nullish(),
    families: z.array(z.string()).nullish(),
    parameter_size: z.string().nullish(),
    quantization_level: z.string().nullish(),
    format: z.string().nullish(),
  })
  .nullish();

const Tag = z.object({
  name: z.string(),
  model: z.string().nullish(),
  size: z.number().nullish(),
  digest: z.string().nullish(),
  modified_at: z.string().nullish(),
  details: Details,
  /** Set on a cloud model: Ollama forwards every chat with it to this host. */
  remote_host: z.string().nullish(),
  /** The model's name on that host. */
  remote_model: z.string().nullish(),
});
export type OllamaTag = z.infer<typeof Tag>;

/**
 * A cloud model: listed by Ollama like the others, but every chat with it
 * goes to ollama.com. It never counts as a model on this computer. Ollama
 * says so with `remote_host`/`remote_model`; its names end in `-cloud` or
 * `:cloud` too, which catches an Ollama that doesn't say.
 */
export function isCloudTag(
  tag: Pick<OllamaTag, 'name' | 'model' | 'remote_host' | 'remote_model'>,
) {
  if (tag.remote_host?.trim() || tag.remote_model?.trim()) return true;
  return [tag.name, tag.model ?? ''].some((name) => /[-:]cloud$/i.test(name.trim()));
}

const Tags = z.object({ models: z.array(Tag).nullish() });

const Show = z.object({
  /** "completion", "tools", "vision", "thinking", "embedding", "insert"… */
  capabilities: z.array(z.string()).nullish(),
  model_info: z.record(z.string(), z.unknown()).nullish(),
  details: Details,
});
export type OllamaShow = z.infer<typeof Show>;

const Version = z.object({ version: z.string() });

const Ps = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        model: z.string().nullish(),
        size: z.number().nullish(),
        size_vram: z.number().nullish(),
        context_length: z.number().nullish(),
        expires_at: z.string().nullish(),
      }),
    )
    .nullish(),
});
export type OllamaLoaded = NonNullable<z.infer<typeof Ps>['models']>[number];

const PullLine = z.object({
  status: z.string().nullish(),
  digest: z.string().nullish(),
  total: z.number().nullish(),
  completed: z.number().nullish(),
  error: z.string().nullish(),
});
export type PullLine = z.infer<typeof PullLine>;

const ErrorBody = z.object({ error: z.string() });

/** How long a quick question to Ollama may take before it counts as "not answering". */
const QUICK_MS = 2_500;

/** The context length Ollama reports for a model, from `model_info["<arch>.context_length"]`. */
export function contextLength(show: OllamaShow): number | undefined {
  for (const [key, value] of Object.entries(show.model_info ?? {})) {
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) return value;
  }
  return undefined;
}

/** Ollama's error message, when its body has one. */
export async function errorOf(response: Response): Promise<string> {
  const body = await text(response, LABEL).catch(() => '');
  try {
    const parsed = ErrorBody.safeParse(JSON.parse(body));
    if (parsed.success) return parsed.data.error;
  } catch {
    // Not JSON: fall through to the status.
  }
  return `Ollama answered ${response.status}.`;
}

/** One line of NDJSON at a time, as it arrives. Blank lines are skipped. */
export async function* ndjson(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  for await (const line of sseLines(body, signal)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as unknown;
    } catch {
      // A line Conch can't read is skipped, like an SSE frame.
    }
  }
}

export class OllamaClient {
  constructor(
    /** The loopback address, read each time: `OLLAMA_HOST` can change under a running Conch. */
    private readonly base: () => string,
    readonly fetch: FetchLike = globalThis.fetch,
  ) {}

  url(path: string): string {
    return `${this.base()}${path}`;
  }

  #send(path: string, init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }) {
    return send({
      fetchImpl: this.fetch,
      url: this.url(path),
      method: init.method,
      headers: { 'content-type': 'application/json' },
      ...(init.body !== undefined && { body: init.body }),
      ...(init.signal && { signal: init.signal }),
      label: LABEL,
      local: true,
    });
  }

  async #json<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const response = await this.#send(path, init);
    if (!response.ok) {
      const message = await errorOf(response);
      throw new ApiError(response.status === 404 ? 'not-found' : 'other', message);
    }
    return validate(schema, await text(response, LABEL), LABEL);
  }

  /** Ollama's version when it's running, else undefined. Never throws. */
  async version(signal: AbortSignal = AbortSignal.timeout(QUICK_MS)): Promise<string | undefined> {
    try {
      return (await this.#json('/api/version', Version, { method: 'GET', signal })).version;
    } catch {
      return undefined;
    }
  }

  async tags(signal: AbortSignal = AbortSignal.timeout(10_000)): Promise<OllamaTag[]> {
    return (await this.#json('/api/tags', Tags, { method: 'GET', signal })).models ?? [];
  }

  show(model: string, signal: AbortSignal = AbortSignal.timeout(10_000)): Promise<OllamaShow> {
    return this.#json('/api/show', Show, { method: 'POST', body: { model }, signal });
  }

  async loaded(signal: AbortSignal = AbortSignal.timeout(QUICK_MS)): Promise<OllamaLoaded[]> {
    return (await this.#json('/api/ps', Ps, { method: 'GET', signal })).models ?? [];
  }

  /**
   * Get a model. Each line is Ollama's own progress; an `error` line (a name
   * that doesn't exist, the internet gone mid-way) ends it with an `ApiError`.
   * Stopping the signal stops the download; Ollama keeps what it has, so the
   * next pull of the same model carries on from there.
   */
  async *pull(model: string, signal: AbortSignal): AsyncGenerator<PullLine> {
    const response = await this.#send('/api/pull', {
      method: 'POST',
      body: { model, stream: true },
      signal,
    });
    if (!response.ok) throw new ApiError('other', await errorOf(response));
    if (!response.body) throw new ApiError('network', 'Ollama sent an empty reply.');
    for await (const raw of ndjson(response.body, signal)) {
      const line = PullLine.safeParse(raw);
      if (!line.success) continue;
      if (line.data.error) throw new ApiError('other', line.data.error);
      yield line.data;
    }
  }
}
