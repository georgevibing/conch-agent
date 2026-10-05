/** Bounded, stdio-only Codex app-server transport. Never exposes a listening port. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

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
const MAX_LINE = 2_000_000;

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
  return line ? redact(line.replace(/^error:\s*/i, '')) : '';
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
    options: { cwd: string; env: Record<string, string>; config?: string[] },
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
    const decoder = new StringDecoder('utf8');
    let pending = '';
    this.child.stdout.on('data', (chunk: Buffer) => {
      pending += decoder.write(chunk);
      if (Buffer.byteLength(pending) > MAX_LINE) {
        this.#fail(new Error('Codex sent an oversized response.'));
        return;
      }
      let at: number;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
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
