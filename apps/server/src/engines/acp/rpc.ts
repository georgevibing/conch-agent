/**
 * The Agent Client Protocol's wire: JSON-RPC 2.0, one message a line, over a
 * program's stdin and stdout (ADR 0053). Both sides ask: Conch asks the agent
 * to start a session or answer a prompt; the agent asks Conch for permission.
 *
 * Bounded like Codex's transport (`codex/rpc.ts`, `lib/json-lines.ts`): the
 * photos an agent sends back are set aside as they're read, a line still too
 * long is skipped (never the connection), nothing the agent writes to stderr
 * is kept, and every pending request ends when the program does.
 */
import type { Readable, Writable } from 'node:stream';

import { z } from 'zod';

import { answeredId, JsonLines } from '../../lib/json-lines';

const Message = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.number(), z.string()]).nullish(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string().optional(), data: z.unknown().optional() })
    .optional(),
});
export type AcpMessage = z.infer<typeof Message>;

/** An error the agent answered with, kept with its code so callers can tell "signed out" apart. */
export class AcpError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = 'AcpError';
  }
}

/** ACP's own codes, and the HTTP status Gemini uses for a rate limit. */
export const ACP_CODES = {
  authRequired: -32000,
  notFound: -32002,
  cancelled: -32800,
  methodNotFound: -32601,
  rateLimited: 429,
} as const;

/** Answers one request from the agent. Throw an `AcpError` to answer with an error. */
export type AcpHandler = (method: string, params: unknown) => Promise<unknown>;

export interface AcpStreams {
  input: Writable;
  output: Readable;
  /** Called once when the connection should end (kill the program). */
  close(): void;
}

export class AcpConnection {
  #id = 0;
  #closed = false;
  #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }
  >();
  #notifications = new Set<(method: string, params: unknown) => void>();
  #failures = new Set<(error: Error) => void>();
  #handler: AcpHandler = async () => {
    throw new AcpError('Conch doesn’t offer that.', ACP_CODES.methodNotFound);
  };

  constructor(
    private readonly streams: AcpStreams,
    private readonly label: string,
  ) {
    // The photos an agent echoes or replays (`session/load`) are set aside as they're read,
    // and a message that's still too long is skipped, never the connection (`json-lines.ts`).
    const lines = new JsonLines();
    streams.output.on('data', (chunk: Buffer | string) => {
      if (this.#closed) return;
      const { lines: finished, skipped } = lines.push(
        typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
      );
      for (const line of skipped) {
        console.error(`[acp] ${label}: skipped a ${Math.ceil(line.size / 1024 / 1024)} MB message`);
        const id = answeredId(line.head);
        const waiting = id === undefined ? undefined : this.#pending.get(id);
        if (id !== undefined && waiting) {
          this.#pending.delete(id);
          if (waiting.timer) clearTimeout(waiting.timer);
          waiting.reject(new Error(`${label}’s answer was too large for Conch to read.`));
        }
      }
      for (const raw of finished) {
        const line = raw.trim();
        if (line) this.#receive(line);
      }
    });
    streams.output.once('end', () => this.fail(new Error(`${label} stopped.`)));
    streams.output.once('error', () => this.fail(new Error(`${label} stopped.`)));
    streams.input.on('error', () => this.fail(new Error(`The connection to ${label} closed.`)));
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Who answers the agent's own requests (permission, mostly). */
  handle(handler: AcpHandler): void {
    this.#handler = handler;
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.#notifications.add(listener);
    return () => this.#notifications.delete(listener);
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.#failures.add(listener);
    return () => this.#failures.delete(listener);
  }

  #write(message: Record<string, unknown>): void {
    if (this.#closed) throw new Error(`The connection to ${this.label} is closed.`);
    this.streams.input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  notify(method: string, params: unknown): void {
    try {
      this.#write({ method, params });
    } catch {
      /* Closed: nothing to tell. */
    }
  }

  /**
   * Ask the agent something. `timeoutMs: 0` waits as long as it takes (a turn
   * can run for minutes); everything else gives up and says so.
   */
  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.#closed)
      return Promise.reject(new Error(`The connection to ${this.label} is closed.`));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.#pending.delete(id);
              reject(new Error(`${this.label} took too long to answer.`));
            }, timeoutMs).unref()
          : undefined;
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#write({ id, method, params });
      } catch (error) {
        this.#pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #receive(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      // Some agents print a banner before they start talking. One bad line
      // early on is noise; the connection only fails on what it can't skip.
      return;
    }
    const parsed = Message.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.method && message.id !== undefined && message.id !== null) {
      const id = message.id;
      void this.#handler(message.method, message.params).then(
        (result) => this.#safeWrite({ id, result: result ?? {} }),
        (error: unknown) =>
          this.#safeWrite({
            id,
            error: {
              code: error instanceof AcpError ? error.code : -32603,
              message: error instanceof Error ? error.message : 'Conch couldn’t answer that.',
            },
          }),
      );
      return;
    }
    if (message.method) {
      for (const listener of this.#notifications) listener(message.method, message.params);
      return;
    }
    if (typeof message.id !== 'number') return;
    const waiting = this.#pending.get(message.id);
    if (!waiting) return;
    this.#pending.delete(message.id);
    if (waiting.timer) clearTimeout(waiting.timer);
    if (message.error) {
      // The agent's own words can carry paths or tokens: only a short, single line is kept.
      const said = (message.error.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      waiting.reject(new AcpError(said || `${this.label} couldn’t do that.`, message.error.code));
    } else waiting.resolve(message.result);
  }

  #safeWrite(message: Record<string, unknown>): void {
    try {
      this.#write(message);
    } catch {
      /* The agent is gone; its question has no one to answer. */
    }
  }

  fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiting of this.#pending.values()) {
      if (waiting.timer) clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#failures) listener(error);
    this.streams.close();
  }

  close(): void {
    this.fail(new Error(`The connection to ${this.label} was closed.`));
  }
}
