/** Bounded, stdio-only Codex app-server transport. Never exposes a listening port. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { z } from 'zod';

import { launch } from '../../lib/proc';

const Message = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
export type RpcMessage = z.infer<typeof Message>;
/**
 * The longest message a connection reads, unless it was started for more: a
 * picture comes back whole in one message (`pictures.ts`, `PICTURE_LINE`).
 */
export const MAX_LINE = 2_000_000;

/** A message longer than its connection reads. Nothing more is read from it. */
export class LineTooLong extends Error {
  constructor(readonly max: number) {
    super('Codex sent a message larger than Conch reads at once.');
  }
}

/**
 * Codex's messages, one per line, from the bytes as they come. Only the line
 * being read is held, as the chunks it came in (joined and decoded once, when
 * it ends), and it stops at `max` bytes: a long message costs its own size,
 * never that again for each chunk. A newline byte is never part of a UTF-8
 * character, so a line ends where one is, whatever the chunks split.
 */
export class Lines {
  #parts: Buffer[] = [];
  #size = 0;
  constructor(readonly max: number = MAX_LINE) {}

  /** The lines `chunk` finished. Throws `LineTooLong` once the line being read passes `max`. */
  push(chunk: Buffer): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let at = chunk.indexOf(0x0a); at >= 0; at = chunk.indexOf(0x0a, start)) {
      this.#take(chunk.subarray(start, at));
      lines.push(Buffer.concat(this.#parts, this.#size).toString('utf8'));
      this.#parts = [];
      this.#size = 0;
      start = at + 1;
    }
    if (start < chunk.length) this.#take(chunk.subarray(start));
    return lines;
  }

  #take(part: Buffer) {
    this.#size += part.length;
    if (this.#size > this.max) {
      this.#parts = [];
      throw new LineTooLong(this.max);
    }
    if (part.length) this.#parts.push(part);
  }
}

/**
 * What Codex said when it refused a request, safe to log and to show: anything
 * that looks like a credential (a bearer token, a key, a JWT, a long opaque
 * string) is blanked, and it's cut short.
 */
export function redact(text: string): string {
  return text
    .replace(/\b(bearer|basic)\s+[^\s,;"']+/gi, '$1 …')
    .replace(/\b(sk|pk|rk|sess)-[A-Za-z0-9_-]{8,}/g, '$1-…')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)*/g, '…')
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** How much of what Codex wrote to stderr is kept to explain a sudden exit. */
const STDERR_KEPT = 4096;

/** The last thing Codex said, redacted and short: enough to tell one failure from the next. */
export function lastWords(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((l) => l.trim())
    .findLast(Boolean);
  if (!line) return '';
  // Beyond credentials: addresses (sign-in links carry codes), emails, device codes and the
  // user's own folders never leave the process, so the line is safe in the log and in a chat.
  return redact(
    line
      .replace(/^error:\s*/i, '')
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<address>')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
      .replace(/\b[A-Z0-9]{3,5}-[A-Z0-9]{3,5}\b/g, '<code>')
      .replace(/(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s"']+/g, '~'),
  ).slice(0, 160);
}

/** Codex answered a request with an error: which request, and why (redacted). */
export class CodexRefusal extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

function refusal(method: string, error: unknown): CodexRefusal {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  const reason = redact(raw);
  // The real reason goes to the gateway's log, so one failure can be told from the next.
  console.error(`[codex] ${method} refused: ${reason || '(no reason given)'}`);
  if (/bwrap:|sandbox helper failed|sandbox-exec:/i.test(raw))
    return new CodexRefusal(
      'Codex could not start its OS sandbox. Check the host sandbox prerequisites in Settings → Health; Conch will not run unrestricted.',
      method,
      reason,
    );
  return new CodexRefusal(
    reason
      ? `Codex refused the request: ${reason}`
      : 'Codex could not complete this request. Check your sign-in or update Codex in Settings.',
    method,
    reason,
  );
}

export class CodexRpc {
  readonly child: ChildProcessWithoutNullStreams;
  #id = 0;
  #closed = false;
  #exited = false;
  #pending = new Map<
    number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #listeners = new Set<(message: RpcMessage) => void>();
  #failures = new Set<(error: Error) => void>();

  constructor(
    executable: string,
    options: {
      cwd: string;
      env: Record<string, string>;
      config?: string[];
      /** The longest message this connection reads (`MAX_LINE` unless it's for a picture). */
      maxLine?: number;
    },
  ) {
    const { command, prefix } = launch(executable);
    this.child = spawn(
      command,
      [
        ...prefix,
        'app-server',
        '--listen',
        'stdio://',
        ...(options.config ?? []).flatMap((v) => ['-c', v]),
      ],
      { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const lines = new Lines(options.maxLine ?? MAX_LINE);
    let overflowed = false;
    this.child.stdout.on('data', (chunk: Buffer) => {
      // Past a message too long to read, the rest is the middle of it: nothing more is read.
      if (overflowed) return;
      let finished: string[];
      try {
        finished = lines.push(chunk);
      } catch (error) {
        overflowed = true;
        this.#fail(error instanceof Error ? error : new LineTooLong(lines.max));
        return;
      }
      for (const line of finished) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = Message.safeParse(JSON.parse(line));
        } catch {
          this.#fail(new Error('Codex sent an unreadable response. Update Codex in Settings.'));
          return;
        }
        if (!parsed.success) {
          this.#fail(new Error('Codex sent an unsupported response. Update Codex in Settings.'));
          return;
        }
        const message = parsed.data;
        if (!message.method && typeof message.id === 'number') {
          const waiting = this.#pending.get(message.id);
          if (waiting) {
            this.#pending.delete(message.id);
            clearTimeout(waiting.timer);
            // Raw provider errors may contain request headers or credential material.
            if (message.error) waiting.reject(refusal(waiting.method, message.error));
            else waiting.resolve(message.result);
          }
        } else for (const listener of this.#listeners) listener(message);
      }
    });
    // Keep the last words Codex said on its way out (redacted before they go anywhere), so a
    // process that dies at once says why instead of leaving "stopped" and nothing to look at.
    let tail = '';
    this.child.stderr.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-STDERR_KEPT);
    });
    this.child.stdin.on('error', () => this.#fail(new Error('The Codex connection closed.')));
    this.child.once('error', () =>
      this.#fail(new Error('Codex could not start. Open Settings → Providers.')),
    );
    this.child.once('close', (code, signal) => {
      this.#exited = true;
      const said = lastWords(tail);
      console.error(
        `[codex] exited (${signal ?? `code ${code ?? '?'}`})${said ? `: ${said}` : ' without saying why'}`,
      );
      this.#fail(
        new Error(
          said
            ? `Codex stopped before the request finished: ${said}`
            : 'Codex stopped before the request finished.',
        ),
      );
    });
  }

  listen(listener: (message: RpcMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  onFailure(listener: (error: Error) => void): () => void {
    this.#failures.add(listener);
    return () => this.#failures.delete(listener);
  }
  send(message: unknown): void {
    if (this.#closed) throw new Error('The Codex connection is closed.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('The Codex connection is closed.'));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('Codex took too long to answer.'));
      }, timeoutMs).unref();
      this.#pending.set(id, { method, resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'conch', title: 'Conch', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
  }
  #fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#failures) listener(error);
    this.child.kill('SIGTERM');
  }
  async close(): Promise<void> {
    this.#fail(new Error('The Codex connection was closed.'));
    if (this.#exited || this.child.exitCode !== null || this.child.signalCode !== null) return;
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 2_000).unref();
    await new Promise<void>((done) => this.child.once('close', () => done()));
    clearTimeout(timer);
  }
}
