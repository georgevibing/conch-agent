/** Bounded, stdio-only Codex app-server transport. Never exposes a listening port. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { z } from 'zod';

import { answeredId, JsonLines, MAX_KEPT } from '../../lib/json-lines';
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
 * The longest message a chat's connection keeps once the pictures in it are
 * set aside (`lib/json-lines.ts`): Codex echoes every photo it was sent, and
 * replays them all when a conversation carries on. A connection reading a
 * picture back keeps it whole instead (`pictures.ts`, `PICTURE_LINE`).
 */
export const MAX_LINE = MAX_KEPT;

/** A message longer than a picture's connection reads. Nothing more is read from it. */
export class LineTooLong extends Error {
  constructor(readonly max: number) {
    super('Codex sent a picture larger than Conch reads at once.');
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
      /** The longest message this connection keeps (`MAX_LINE` unless it's for a picture). */
      maxLine?: number;
      /** Keep long base64 whole, and stop past `maxLine`: this connection reads a picture back. */
      keepPictures?: boolean;
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
    // A chat's connection sets the pictures Codex echoes aside and skips what's still too
    // long; a picture's connection keeps the picture it waits for, and stops past it.
    const keep = Boolean(options.keepPictures);
    const lines = new JsonLines({ max: options.maxLine ?? MAX_LINE, keepLong: keep });
    let overflowed = false;
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      const { lines: finished, skipped } = lines.push(chunk);
      for (const line of skipped) {
        if (keep) {
          overflowed = true;
          this.#fail(new LineTooLong(lines.max));
          return;
        }
        console.error(`[codex] skipped a ${Math.ceil(line.size / 1024 / 1024)} MB message`);
        // The request it answered ends now, rather than waiting for an answer that came.
        const id = answeredId(line.head);
        const waiting = id === undefined ? undefined : this.#pending.get(id);
        if (id !== undefined && waiting) {
          this.#pending.delete(id);
          clearTimeout(waiting.timer);
          waiting.reject(new Error('Codex’s answer was too large for Conch to read.'));
        }
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
