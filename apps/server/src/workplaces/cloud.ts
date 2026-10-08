/**
 * A sandbox in the cloud (ADR 0106): Daytona, chosen because it sleeps by
 * itself when idle (15 minutes) and wakes with its files where they were, is
 * reached with one key, and speaks plain JSON over HTTPS, so Conch needs no
 * one's SDK. Each chat has its own sandbox, labelled with the chat, made the
 * first time a command needs it; the work folder is carried there and back as
 * for an SSH machine (`mirror.ts`).
 *
 * The key is sealed with Conch's other keys and goes only to Daytona's own
 * addresses, in a header, never in a URL, a log or an error.
 */
import { randomBytes } from 'node:crypto';

import { shq, type ExecResult } from './exec';
import { Mirror, MirrorError, type Remote } from './mirror';
import { backNote } from './ssh';
import { PlaceUnavailable, type RunRequest, type RunResult, type WorkPlace } from './types';

export const DAYTONA_API = 'https://app.daytona.io/api';
/** Where Daytona's own answers may point Conch: its own hosts, over HTTPS, nothing else. */
const DAYTONA_HOST = /^(?:[a-z0-9-]+\.)*daytona\.(?:io|work)$/;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface Sandbox {
  id: string;
  state?: string;
  toolboxProxyUrl?: string;
}

/** Minutes: asleep after 15 idle, put away after a week asleep, removed after 30 days unused. */
export const LIFETIME = {
  autoStopInterval: 15,
  autoArchiveInterval: 7 * 24 * 60,
  autoDeleteInterval: 30 * 24 * 60,
};

export interface CloudDeps {
  key: () => Promise<string | undefined>;
  fetch?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
  /** How long a sandbox may take to wake. */
  wakeMs?: number;
}

/** A Daytona answer's address, if it's Daytona's own. */
export function daytonaUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && DAYTONA_HOST.test(url.hostname)
      ? url.href.replace(/\/$/, '')
      : undefined;
  } catch {
    return undefined;
  }
}

/** Every chat's sandbox at Daytona. */
export class CloudSandboxes {
  readonly #fetch: Fetcher;
  readonly #sandboxes = new Map<string, Promise<Sandbox>>();
  readonly #mirrors = new Map<string, Mirror>();

  constructor(private readonly deps: CloudDeps) {
    this.#fetch = deps.fetch ?? ((url, init) => fetch(url, init));
  }

  async #call(
    url: string,
    init: RequestInit & { signal?: AbortSignal } = {},
    tries = 3,
  ): Promise<Response> {
    const key = await this.deps.key();
    if (!key)
      throw new PlaceUnavailable(
        'The cloud needs your Daytona key first. Add it in Settings → Security.',
      );
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${key}` },
          redirect: 'error',
        });
      } catch {
        init.signal?.throwIfAborted();
        if (attempt >= tries)
          throw new PlaceUnavailable('Daytona isn’t answering. Check the internet connection.');
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (response.status === 401 || response.status === 403)
        throw new PlaceUnavailable(
          'Daytona didn’t accept the key. Add a new one in Settings → Security.',
        );
      // A blip or a busy moment passes by itself: tried again, lighter each time.
      if ((response.status === 429 || response.status >= 500) && attempt < tries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return response;
    }
  }

  async #json<T>(url: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
    const response = await this.#call(url, init);
    if (!response.ok) {
      const said = await response.text().catch(() => '');
      throw new PlaceUnavailable(
        `Daytona said no (${response.status})${said ? `: ${said.replace(/\s+/g, ' ').slice(0, 160)}` : ''}.`,
      );
    }
    return (await response.json()) as T;
  }

  /** The chat's sandbox, found by its label or made, and awake. */
  async #sandbox(conversationId: string, signal: AbortSignal): Promise<Sandbox> {
    let pending = this.#sandboxes.get(conversationId);
    if (!pending) {
      pending = this.#find(conversationId, signal);
      this.#sandboxes.set(conversationId, pending);
      pending.catch(() => this.#sandboxes.delete(conversationId));
    }
    const box = await pending;
    return this.#awake(box, signal);
  }

  async #find(conversationId: string, signal: AbortSignal): Promise<Sandbox> {
    const labels = encodeURIComponent(JSON.stringify({ 'conch-chat': conversationId }));
    const listed = await this.#json<Sandbox[] | { items?: Sandbox[] }>(
      `${DAYTONA_API}/sandbox?labels=${labels}`,
      {
        signal,
      },
    );
    const found = Array.isArray(listed) ? listed[0] : listed.items?.[0];
    if (found) return found;
    return this.#json<Sandbox>(`${DAYTONA_API}/sandbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labels: { 'conch-chat': conversationId, app: 'conch' }, ...LIFETIME }),
      signal,
    });
  }

  /** Asleep or put away: woken, and waited for. */
  async #awake(box: Sandbox, signal: AbortSignal): Promise<Sandbox> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const until = Date.now() + (this.deps.wakeMs ?? 180_000);
    let current = box;
    let started = false;
    while (current.state !== 'started') {
      signal.throwIfAborted();
      if (
        current.state === 'error' ||
        current.state === 'build_failed' ||
        current.state === 'destroyed'
      )
        throw new PlaceUnavailable(
          'This chat’s cloud sandbox broke. Repair everything makes a new one.',
        );
      if (!started && (current.state === 'stopped' || current.state === 'archived')) {
        await this.#json(`${DAYTONA_API}/sandbox/${encodeURIComponent(current.id)}/start`, {
          method: 'POST',
          signal,
        });
        started = true;
      }
      if (Date.now() > until)
        throw new PlaceUnavailable(
          'The cloud sandbox is taking too long to wake. Try again in a minute.',
        );
      await sleep(1_500);
      current = await this.#json<Sandbox>(
        `${DAYTONA_API}/sandbox/${encodeURIComponent(current.id)}`,
        { signal },
      );
    }
    return current;
  }

  async #toolbox(box: Sandbox, signal: AbortSignal): Promise<string> {
    const base =
      daytonaUrl(box.toolboxProxyUrl) ??
      daytonaUrl(
        (
          await this.#json<{ url?: string }>(
            `${DAYTONA_API}/sandbox/${encodeURIComponent(box.id)}/toolbox-proxy-url`,
            { signal },
          )
        ).url,
      );
    if (!base)
      throw new PlaceUnavailable('Daytona gave an address that isn’t its own, so Conch stopped.');
    return `${base}/${encodeURIComponent(box.id)}`;
  }

  /** The chat's sandbox as a `Remote`: a script run there, its input and output carried as files. */
  remote(conversationId: string): Remote {
    return {
      sh: async (script, options): Promise<ExecResult> => {
        const box = await this.#sandbox(conversationId, options.signal);
        const toolbox = await this.#toolbox(box, options.signal);
        const tag = randomBytes(8).toString('hex');
        const input = `/tmp/conch-${tag}.in`;
        const output = `/tmp/conch-${tag}.out`;
        if (options.stdin) {
          const put = await this.#call(
            `${toolbox}/files/upload-v2?path=${encodeURIComponent(input)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream' },
              body: new Uint8Array(options.stdin),
              signal: options.signal,
            },
          );
          if (!put.ok)
            throw new PlaceUnavailable(
              `Couldn’t send the work folder to the cloud (${put.status}).`,
            );
        }
        const wrapped = [
          `sh -c ${shq(script)} < ${options.stdin ? input : '/dev/null'}${options.binary ? ` > ${output}` : ''}`,
          'code=$?',
          `rm -f ${input}`,
          'exit $code',
        ].join('\n');
        // Carried as base64, so no quoting on the way can change a byte of it.
        const command = `sh -c "echo ${Buffer.from(wrapped).toString('base64')} | base64 -d | sh"`;
        const limit = AbortSignal.timeout(options.timeoutMs + 60_000);
        let ran: { exitCode?: number; result?: string };
        try {
          ran = await this.#json(`${toolbox}/process/execute`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command, timeout: Math.ceil(options.timeoutMs / 1000) }),
            signal: AbortSignal.any([options.signal, limit]),
          });
        } catch (error) {
          options.signal.throwIfAborted();
          if (!limit.aborted) throw error;
          return {
            code: null,
            output: '',
            stdout: Buffer.alloc(0),
            stderr: '',
            timedOut: true,
            overflow: false,
          };
        }
        const code = typeof ran.exitCode === 'number' ? ran.exitCode : null;
        const text = (ran.result ?? '').slice(-64_000);
        let stdout = Buffer.from(ran.result ?? '');
        if (options.binary) {
          const got = await this.#call(
            `${toolbox}/files/download?path=${encodeURIComponent(output)}`,
            {
              signal: options.signal,
            },
          );
          stdout = got.ok ? Buffer.from(await got.arrayBuffer()) : Buffer.alloc(0);
        }
        return {
          code,
          output: text,
          stdout,
          stderr: code === 0 ? '' : text,
          timedOut: false,
          overflow: false,
        };
      },
    };
  }

  #mirror(conversationId: string): Mirror {
    let mirror = this.#mirrors.get(conversationId);
    if (!mirror) {
      mirror = new Mirror(this.remote(conversationId), '"$HOME"/work');
      this.#mirrors.set(conversationId, mirror);
    }
    return mirror;
  }

  /** Whether the key opens Daytona: one cheap look, for Settings and Repair everything. */
  async check(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await this.#call(
        `${DAYTONA_API}/sandbox?limit=1`,
        { signal: AbortSignal.timeout(15_000) },
        1,
      );
      return response.ok
        ? { ok: true }
        : { ok: false, message: `Daytona said no (${response.status}).` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** A chat's sandbox broke: forget it, so the next command makes a new one. */
  forget(conversationId?: string): void {
    if (conversationId) {
      this.#sandboxes.delete(conversationId);
      this.#mirrors.get(conversationId)?.forget();
    } else {
      this.#sandboxes.clear();
      for (const mirror of this.#mirrors.values()) mirror.forget();
    }
  }

  async run(request: RunRequest): Promise<RunResult> {
    const mirror = this.#mirror(request.conversationId);
    return mirror.serial(async () => {
      try {
        await mirror.push(request.cwd, request.forbidden, request.signal);
        let result: ExecResult | undefined;
        let failure: unknown;
        try {
          result = await this.remote(request.conversationId).sh(
            `cd ${mirror.root} && sh -c ${shq(request.command)}`,
            {
              timeoutMs: request.timeoutMs,
              signal: request.signal,
            },
          );
        } catch (error) {
          failure = error;
        }
        const back =
          request.signal.aborted || failure instanceof PlaceUnavailable
            ? undefined
            : await mirror.pull(request.cwd, request.forbidden, request.signal);
        if (failure || !result) throw failure;
        const note = back && backNote(back);
        return {
          code: result.code,
          output: result.output,
          timedOut: result.timedOut,
          ...(note && { note }),
        };
      } catch (error) {
        if (error instanceof MirrorError) throw new PlaceUnavailable(error.message);
        if (error instanceof PlaceUnavailable && /broke/.test(error.message))
          this.forget(request.conversationId);
        throw error;
      }
    });
  }
}

export function cloudPlace(sandboxes: CloudSandboxes): WorkPlace {
  return {
    id: 'cloud',
    kind: 'cloud',
    where: { kind: 'cloud', name: 'the cloud' },
    seals: false,
    about:
      'Commands run in this chat’s own sandbox in the cloud (Daytona: Linux, which sleeps when idle and wakes with its files), in a copy of the work folder (~/work). The copy is brought up to date before each command and what a command changes comes back after it (except dependency folders like node_modules and .venv, which stay there: install them there). Use paths relative to the work folder. The sandbox has the network, and its commands are asked about as if they left the sealed box. None of the person’s keys are there.',
    run: (request) => sandboxes.run(request),
  };
}
