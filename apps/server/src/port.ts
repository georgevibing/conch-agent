/**
 * Starting on a port that's taken (AGENTS.md agreement 11). If it's a Conch,
 * open that one; if it's another program, start on the next free port and
 * say so. A port someone chose on purpose (`CONCH_PORT`) is never swapped
 * silently: Conch says what holds it and what to do instead.
 */
import { execFile } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { Health } from '@conch/protocol';
import { z } from 'zod';

import { writeJson } from './lib/fs';

/** How far past the usual port Conch looks for a free one. */
export const PORT_TRIES = 20;

export type PortProbe = 'free' | 'conch' | 'other';

export type PortChoice =
  /** Start here. `busy`: the port Conch wanted, held by another program. */
  | { kind: 'use'; port: number; busy?: number }
  /** A Conch already answers here: open it rather than start a second one. */
  | { kind: 'running'; port: number }
  /** Can't start: `port` is held by another program. `next` is a free one to suggest. */
  | { kind: 'taken'; port: number; next?: number; explicit: boolean };

/**
 * Where to start. `explicit`: `CONCH_PORT` was set, so a port held by another
 * program is reported, not swapped. `recorded`: where this Conch folder's
 * gateway said it's running (it may have moved there itself).
 */
export async function choosePort(input: {
  port: number;
  explicit: boolean;
  recorded?: number;
  probe: (port: number) => Promise<PortProbe>;
  tries?: number;
}): Promise<PortChoice> {
  const { port, explicit, recorded, probe } = input;
  if (recorded !== undefined && recorded !== port && (await probe(recorded)) === 'conch')
    return { kind: 'running', port: recorded };
  const first = await probe(port);
  if (first === 'free') return { kind: 'use', port };
  if (first === 'conch') return { kind: 'running', port };
  let next: number | undefined;
  for (
    let candidate = port + 1;
    candidate <= Math.min(65535, port + (input.tries ?? PORT_TRIES));
    candidate++
  ) {
    if ((await probe(candidate)) === 'free') {
      next = candidate;
      break;
    }
  }
  if (explicit || next === undefined) return { kind: 'taken', port, next, explicit };
  return { kind: 'use', port: next, busy: port };
}

/** An address that reaches `host` from this computer (a wildcard listens on loopback too). */
function reachable(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1';
  if (host === '::') return '[::1]';
  return host.includes(':') ? `[${host}]` : host;
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Whether what answers on `port` is a Conch: its `/api/health` says so. Sends nothing else. */
async function answersAsConch(host: string, port: number, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${reachable(host)}:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    return response.ok && Health.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}

/** Is `port` free on `host`, held by a Conch, or held by another program? */
export async function probePort(host: string, port: number, timeoutMs = 2_000): Promise<PortProbe> {
  if (await canListen(host, port)) return 'free';
  return (await answersAsConch(host, port, timeoutMs)) ? 'conch' : 'other';
}

// ── What holds a port ──────────────────────────────────────────────────────

/** The process listening on `port` in `netstat -ano -p tcp` output (Windows). */
export function pidFromNetstat(output: string, port: number): number | undefined {
  for (const line of output.split(/\r?\n/)) {
    const [proto, local, , state, pid] = line.trim().split(/\s+/);
    if (proto?.toUpperCase() !== 'TCP' || state !== 'LISTENING' || !local || !pid) continue;
    if (local.endsWith(`:${port}`) && /^\d+$/.test(pid)) return Number(pid);
  }
  return undefined;
}

/** The program name in `tasklist /FO CSV /NH` output: `"node.exe","1234",…`. */
export function nameFromTasklist(output: string): string | undefined {
  const match = /^"([^"]+)"/.exec(output.trim());
  return match?.[1];
}

/** `lsof -Fpc` output: `p1234` then `cnode`. */
export function holderFromLsof(output: string): { pid: number; name?: string } | undefined {
  let pid: number | undefined;
  let name: string | undefined;
  for (const line of output.split('\n')) {
    if (line.startsWith('p') && pid === undefined) pid = Number(line.slice(1));
    else if (line.startsWith('c') && name === undefined) name = line.slice(1);
  }
  return pid !== undefined && Number.isInteger(pid) ? { pid, ...(name && { name }) } : undefined;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 3_000, windowsHide: true }, (error, stdout) =>
      resolve(error ? '' : String(stdout)),
    );
  });
}

/**
 * The program listening on `port`, in words ("node.exe (process 1234)"), when
 * the system will say. Best effort: undefined when it won't.
 */
export async function whoHolds(port: number): Promise<string | undefined> {
  if (process.platform === 'win32') {
    const pid = pidFromNetstat(await run('netstat', ['-ano', '-p', 'tcp']), port);
    if (pid === undefined) return undefined;
    const name = nameFromTasklist(
      await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']),
    );
    return `${name ?? 'a program'} (process ${pid})`;
  }
  const holder = holderFromLsof(
    await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']),
  );
  return holder && `${holder.name ?? 'a program'} (process ${holder.pid})`;
}

// ── Saying so ──────────────────────────────────────────────────────────────

/** What to print when Conch can't start on the port, in plain words with one next step. */
export function takenMessage(
  choice: Extract<PortChoice, { kind: 'taken' }>,
  holder?: string,
): string {
  const who = holder ?? 'another program';
  if (!choice.explicit)
    return [
      `Ports ${choice.port}–${choice.port + PORT_TRIES} are all in use (${choice.port} by ${who}).`,
      'Close a program that uses one of them, or set CONCH_PORT to a free port.',
    ].join('\n');
  return [
    `Port ${choice.port} is in use by ${who}, and CONCH_PORT asks for exactly that port.`,
    choice.next === undefined
      ? 'Close that program, or set CONCH_PORT to a free port.'
      : `Close that program, or set CONCH_PORT=${choice.next} (that one is free).`,
  ].join('\n');
}

// ── Where this Conch is running ────────────────────────────────────────────

/**
 * `~/.conch/gateway.json`: where the gateway using this folder listens, while
 * it runs. `pnpm conch` and the dev server read it to find a Conch that moved
 * to another port, and a second start finds the first.
 */
export const GatewayRecord = z.object({
  pid: z.number().int().positive(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  startedAt: z.number(),
});
export type GatewayRecord = z.infer<typeof GatewayRecord>;

const recordPath = (home: string) => join(home, 'gateway.json');

export function recordGateway(home: string, record: GatewayRecord): Promise<void> {
  return writeJson(recordPath(home), record);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it's just not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The gateway recorded for this folder, if its process is still alive. */
export async function runningGateway(home: string): Promise<GatewayRecord | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(recordPath(home), 'utf8'));
  } catch {
    return undefined; // None, or unreadable: it's rewritten on the next start.
  }
  const parsed = GatewayRecord.safeParse(raw);
  return parsed.success && alive(parsed.data.pid) ? parsed.data : undefined;
}

/** Remove the record on the way out, if it's still ours. Synchronous, for `process.on('exit')`. */
export function forgetGateway(home: string, pid = process.pid): void {
  try {
    const parsed = GatewayRecord.safeParse(JSON.parse(readFileSync(recordPath(home), 'utf8')));
    if (parsed.success && parsed.data.pid === pid) rmSync(recordPath(home), { force: true });
  } catch {
    // Already gone.
  }
}
