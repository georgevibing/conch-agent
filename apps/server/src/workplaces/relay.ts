/**
 * Claude Code's own commands, run where the chat's work runs (ADR 0106).
 *
 * Claude Code runs its `Bash` tool itself, so Conch can't hand the command to
 * a place directly. Instead its PreToolUse hook swaps the command for a tiny
 * runner: Conch's own Node, fetching one address on this computer's loopback.
 * The address holds a ticket for exactly the command that was asked about;
 * the gateway runs that command at the place and answers with its output and
 * exit code, which the runner passes on as its own. So the row, the question
 * and the transcript show the command the model wrote, and the command that
 * runs is the one that was judged.
 *
 * The door is this turn's alone: a random port on 127.0.0.1, gone when the
 * turn ends. Each ticket is 256 random bits, kept only as its hash, good once,
 * for 30 minutes (a question may wait for an answer). A request with an
 * `Origin` (a web page) or another `Host` is refused, as at the ACP door.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { shq } from './exec';
import { PlaceUnavailable, type RunRequest, type WorkPlace } from './types';

const TICKET_MS = 30 * 60_000;

/** The runner, as one argument: no single quote in it, so it sits in a shell's quotes unchanged. */
export const RUNNER = [
  'const u=process.argv[1];',
  'const r=await fetch(u,{method:"POST"}).catch(()=>null);',
  'if(!r||!r.ok){process.stderr.write("Conch couldn\\u2019t run this command where the chat\\u2019s work runs.\\n");process.exit(1)}',
  'const t=(await r.text()).trim().split("\\n").pop()||"{}";',
  'let j={};try{j=JSON.parse(t)}catch{}',
  'process.stdout.write(String(j.output??""));',
  'process.exit(typeof j.code==="number"?j.code:1)',
].join('');

const digest = (ticket: string) => createHash('sha256').update(ticket).digest('hex');

export interface RelayJob {
  command: string;
  timeoutMs: number;
  /** The command may leave the sealed box (the person said yes, or Full trust). */
  open: boolean;
}

interface Pending extends RelayJob {
  expires: number;
}

/** The answer the runner reads, from what the place said. */
export function relayAnswer(
  result: { code: number | null; output: string; timedOut: boolean; note?: string },
  timeoutMs: number,
): { code: number; output: string } {
  const note = result.note ? `\n(${result.note})` : '';
  if (result.timedOut)
    return {
      code: 124,
      output: `${result.output}\nThe command took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.${note}`,
    };
  return { code: result.code ?? 1, output: `${result.output}${note}` };
}

export interface Relay {
  /** The command line that runs `job` at the place, for the hook to hand Claude Code. */
  wrap(job: RelayJob): Promise<string>;
  close(): Promise<void>;
}

/** This turn's door. Opened when the first command needs it. */
export function openRelay(options: {
  place: WorkPlace;
  conversationId: string;
  cwd: string;
  forbidden: () => Promise<string[]>;
  /** A command naming a protected place is refused before it goes anywhere. */
  refuses: (command: string, forbidden: string[]) => string | undefined;
  signal: AbortSignal;
  node?: string;
}): Relay {
  const pending = new Map<string, Pending>();
  let server: Promise<{ http: Server; port: number }> | undefined;

  const handle = (http: Server): Server => {
    http.on('request', (req, res) => {
      const address = http.address() as AddressInfo | null;
      const host = address ? `127.0.0.1:${address.port}` : '';
      const deny = (status: number) => {
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end();
      };
      if (req.headers.origin !== undefined || req.headers.host !== host) return deny(403);
      const match = /^\/run\/([A-Za-z0-9_-]{43})$/.exec(req.url ?? '');
      if (req.method !== 'POST' || !match?.[1]) return deny(404);
      const key = digest(match[1]);
      const job = pending.get(key);
      // Good once: taken now, whatever happens next.
      pending.delete(key);
      if (!job || job.expires < Date.now()) return deny(404);
      req.resume();
      const stop = new AbortController();
      const onClose = () => {
        if (!res.writableFinished) stop.abort(new Error('Stopped.'));
      };
      res.on('close', onClose);
      const signal = AbortSignal.any([options.signal, stop.signal]);
      // Headers now, and a blank line now and then, so a long command keeps its runner listening.
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      const beat = setInterval(() => res.write('\n'), 20_000);
      void (async () => {
        let answer: { code: number; output: string };
        try {
          const forbidden = await options.forbidden();
          const refused = options.refuses(job.command, forbidden);
          if (refused) answer = { code: 1, output: refused };
          else {
            const request: RunRequest = {
              command: job.command,
              cwd: options.cwd,
              timeoutMs: job.timeoutMs,
              open: job.open || !options.place.seals,
              signal,
              conversationId: options.conversationId,
              forbidden,
            };
            answer = relayAnswer(await options.place.run(request), job.timeoutMs);
          }
        } catch (error) {
          answer = {
            code: 1,
            output:
              error instanceof PlaceUnavailable
                ? `${error.message} The command didn’t run. Tell the person in one sentence (the “where work runs” chip under the message box has the fix), and don’t run it another way.`
                : signal.aborted
                  ? 'Stopped.'
                  : error instanceof Error
                    ? error.message
                    : 'The command didn’t run.',
          };
        } finally {
          clearInterval(beat);
        }
        res.end(`${JSON.stringify(answer)}\n`);
      })();
    });
    return http;
  };

  const start = () =>
    (server ??= new Promise((resolve, reject) => {
      const http = handle(createServer());
      http.once('error', reject);
      http.listen(0, '127.0.0.1', () =>
        resolve({ http, port: (http.address() as AddressInfo).port }),
      );
      options.signal.addEventListener('abort', () => void close(), { once: true });
    }));

  const close = async () => {
    pending.clear();
    const running = await server?.catch(() => undefined);
    if (!running) return;
    running.http.closeAllConnections?.();
    await new Promise<void>((resolve) => running.http.close(() => resolve()));
  };

  return {
    async wrap(job) {
      const { port } = await start();
      const ticket = randomBytes(32).toString('base64url');
      pending.set(digest(ticket), { ...job, expires: Date.now() + TICKET_MS });
      const node = options.node ?? process.execPath;
      return [
        shq(node),
        '--no-warnings',
        '--input-type=module',
        '-e',
        shq(RUNNER),
        shq(`http://127.0.0.1:${port}/run/${ticket}`),
      ].join(' ');
    },
    close,
  };
}
