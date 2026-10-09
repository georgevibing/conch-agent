import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { sampleResources, type ResourceSnapshot } from '../recovery/resources';
import { ResourcePace, paceMessage, type WorkloadPace } from '../recovery/pace';

import type { DoctorCheck } from '../doctor/service';
import type { ToolContext } from '../conversations/manager';
import { trustsFully } from '../engines/trust';
import { hostEnvironment } from '../engines/host';
import type { HostTool } from '../engines/types';
import { sandboxSupport, secretPlaces } from '../conversations/sandbox';
import { touchesProtected, PROTECTED_MESSAGE } from '../lib/protect';

/** A managed command as a wait sees it (ADR 0125). */
export interface ProcessPeek {
  command: string;
  status: 'queued' | 'running' | 'exited' | 'stopped' | 'timed-out';
  exitCode: number | null;
  /** What's kept of its output, from `start` to `end` in the whole stream. */
  output: string;
  start: number;
  end: number;
  reason?: string;
}

interface Session {
  id: string;
  owner: string;
  command: string;
  child?: ChildProcessWithoutNullStreams;
  launch: () => void;
  cancel: () => void;
  reason?: string;
  output: string;
  start: number;
  end: number;
  status: 'queued' | 'running' | 'exited' | 'stopped' | 'timed-out';
  exitCode: number | null;
  timer: NodeJS.Timeout;
  at: number;
  unsealed: boolean;
  deadline: number;
}

export class ProcessService {
  readonly #sessions = new Map<string, Session>();
  /** Who waits on a command (ADR 0125): told when it prints or ends, never polled by a model. */
  readonly #listeners = new Map<string, Set<() => void>>();
  #monitor?: NodeJS.Timeout;
  #pumping = false;
  #closed = false;
  #criticalSince?: number;
  #pausedUntil = 0;
  #lastOwner?: string;
  #admissionPaused?: string;
  #sampling?: Promise<ResourceSnapshot>;
  #sample?: { at: number; value: ResourceSnapshot };
  #failedAt?: number;
  readonly #pace: ResourcePace;
  constructor(
    private readonly deps: {
      protectedPaths: string[];
      sealed: () => Promise<boolean>;
      now?: () => number;
      resources?: () => Promise<ResourceSnapshot>;
      healed?: (message: string) => void;
    },
  ) {
    this.#pace = new ResourcePace(deps.now);
  }
  get workload(): WorkloadPace {
    if (this.#admissionPaused || this.#closed)
      return { phase: 'held', cause: 'recovery', concurrency: 0, critical: false };
    return this.#pace.current;
  }
  pauseAdmission(reason = 'Waiting while Conch recovers.') {
    this.#admissionPaused = reason;
    this.#pace.hold('recovery');
    for (const session of this.#sessions.values())
      if (session.status === 'queued') session.reason = reason;
  }
  resumeAdmission() {
    this.#admissionPaused = undefined;
    this.#sample = undefined;
    this.#failedAt = undefined;
    return this.#pump();
  }
  close() {
    this.#closed = true;
    this.pauseAdmission('Conch is closing.');
    this.stopAll();
    clearInterval(this.#monitor);
    this.#monitor = undefined;
  }
  /** Test fixtures replace the raw reader, never the shared admission policy. */
  readResources(): Promise<ResourceSnapshot> {
    return (this.deps.resources ?? sampleResources)();
  }
  resourceSnapshot(): Promise<ResourceSnapshot> {
    // All chats share the gateway's monitor. Tool bursts cannot trigger bursts of OS reads.
    const now = (this.deps.now ?? (() => performance.now()))();
    if (this.#failedAt !== undefined && now >= this.#failedAt && now - this.#failedAt < 1000)
      return Promise.reject(new Error('Resource sampling is waiting before checking again.'));
    if (this.#sample && now >= this.#sample.at && now - this.#sample.at < 1000)
      return Promise.resolve(this.#sample.value);
    this.#sampling ??= (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const sample = await Promise.race([
          Promise.resolve().then(() => this.readResources()),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Resource sampling timed out.')), 2000);
          }),
        ]);
        this.#sample = { at: (this.deps.now ?? (() => performance.now()))(), value: sample };
        this.#failedAt = undefined;
        if (this.#admissionPaused) this.#pace.hold('recovery');
        else this.#pace.observe(sample);
        return sample;
      } catch (error) {
        this.#sample = undefined;
        this.#failedAt = (this.deps.now ?? (() => performance.now()))();
        this.#pace.hold();
        throw error;
      } finally {
        clearTimeout(timer);
        this.#sampling = undefined;
      }
    })();
    return this.#sampling;
  }
  /** Shed only a managed job, never arbitrary host processes. Never replay its command. */
  relievePressure() {
    const now = (this.deps.now ?? Date.now)();
    if (now < this.#pausedUntil)
      return {
        stopped: 0,
        queued: [...this.#sessions.values()].filter((s) => s.status === 'queued').length,
      };
    this.#pausedUntil = now + 30_000;
    this.#pace.hold('memory');
    for (const queued of this.#sessions.values())
      if (queued.status === 'queued')
        queued.reason = this.#admissionPaused ?? 'Waiting briefly for this computer to recover.';
    const running = [...this.#sessions.values()].filter((s) => s.status === 'running');
    const session = running.at(-1);
    if (session) {
      session.reason =
        'Stopped to keep Conch responsive. Check its output before deciding whether to run it again.';
      this.#stop(session);
      this.deps.healed?.('Stopped a heavy command to stay responsive. Its output is kept.');
    }
    return {
      stopped: session ? 1 : 0,
      queued: [...this.#sessions.values()].filter((s) => s.status === 'queued').length,
    };
  }
  #watch() {
    if (!this.#monitor)
      this.#monitor = setInterval(() => {
        void this.#pump();
      }, 5000).unref();
  }
  async #pump() {
    if (this.#pumping || this.#closed) return;
    this.#pumping = true;
    try {
      const active = [...this.#sessions.values()].filter(
        (s) => s.status === 'running' || s.status === 'queued',
      );
      if (!active.length) {
        clearInterval(this.#monitor);
        this.#monitor = undefined;
        this.#criticalSince = undefined;
        return;
      }
      const resources = await this.resourceSnapshot();
      if (this.#closed) return;
      const now = (this.deps.now ?? Date.now)();
      if (resources.level === 'critical') {
        this.#criticalSince ??= now;
        if (now - this.#criticalSince >= 15_000 && now >= this.#pausedUntil) this.relievePressure();
      } else this.#criticalSince = undefined;
      const running = [...this.#sessions.values()].filter((s) => s.status === 'running');
      const queued = [...this.#sessions.values()].filter((s) => s.status === 'queued');
      const pace = this.workload;
      for (const s of queued)
        s.reason =
          this.#admissionPaused ??
          (now < this.#pausedUntil
            ? 'Waiting briefly for this computer to recover.'
            : pace.concurrency === 0
              ? paceMessage(pace)
              : 'Waiting for another managed command to finish.');
      if (this.#admissionPaused || now < this.#pausedUntil) return;
      while (running.length < pace.concurrency) {
        const eligible = queued.filter(
          (s) => s.status === 'queued' && running.filter((r) => r.owner === s.owner).length < 2,
        );
        const next = eligible.find((s) => s.owner !== this.#lastOwner) ?? eligible[0];
        if (!next) break;
        this.#lastOwner = next.owner;
        next.launch();
        if (next.status === 'running') running.push(next);
      }
    } catch {
      // A failed sample must not admit more work. Existing deadlines still apply.
      for (const s of this.#sessions.values())
        if (s.status === 'queued') s.reason = 'Checking available resources before starting.';
    } finally {
      this.#pumping = false;
    }
  }
  doctorCheck(): DoctorCheck {
    return {
      id: 'processes',
      group: 'Tasks',
      title: 'Managed commands',
      run: async ({ repair }) => {
        const now = (this.deps.now ?? Date.now)();
        const overdue = [...this.#sessions.values()].filter(
          (s) => (s.status === 'running' || s.status === 'queued') && s.deadline <= now,
        );
        if (repair) for (const session of overdue) this.#stop(session, 'timed-out');
        const running = [...this.#sessions.values()].filter((s) => s.status === 'running').length;
        const queued = [...this.#sessions.values()].filter((s) => s.status === 'queued').length;
        const resources = await this.resourceSnapshot();
        const pace = this.workload;
        return [
          {
            id: 'processes',
            group: 'Tasks',
            title: 'Managed commands',
            // Running fewer at once on a busy computer is Conch seeing to it: news.
            state: overdue.length
              ? repair
                ? 'fixed'
                : 'warning'
              : resources.level === 'healthy' && pace.phase === 'normal'
                ? 'ok'
                : 'info',
            ...(overdue.length && !repair && { repairable: true }),
            message: overdue.length
              ? repair
                ? 'Stopped commands that had exceeded their time limit.'
                : 'Some commands have exceeded their time limit. Repair stops them.'
              : pace.phase !== 'normal'
                ? `Conch is ${pace.phase === 'constrained' ? 'slowing heavy work before this computer gets overloaded' : pace.phase === 'recovering' ? 'gradually restoring heavy work after resource pressure' : 'holding heavy work until this computer has room'}. ${running} commands running; ${queued} waiting. Current limit: ${pace.concurrency} at a time.`
                : `${running} commands running; ${queued} waiting. Current limit: ${pace.concurrency} at a time.`,
          },
        ];
      },
    };
  }
  #own(owner: string, id: string) {
    const session = this.#sessions.get(id);
    if (!session || session.owner !== owner)
      throw new Error('That process is not available in this chat.');
    return session;
  }
  #stop(session: Session, status: 'stopped' | 'timed-out' = 'stopped') {
    if (session.status !== 'running' && session.status !== 'queued') return;
    session.status = status;
    clearTimeout(session.timer);
    session.cancel();
    this.#changed(session.id);
    if (!session.child) {
      void this.#pump();
      return;
    }
    // The supervisor kills its shell tree. On POSIX, also signal the whole group directly.
    session.child.stdin.end(JSON.stringify({ stop: true }) + '\n');
    if (process.platform !== 'win32') {
      try {
        if (session.child.pid) process.kill(-session.child.pid, 'SIGKILL');
      } catch {
        /* Already gone. */
      }
    }
  }
  stopAll(owner?: string) {
    for (const session of this.#sessions.values())
      if (!owner || session.owner === owner) this.#stop(session);
  }
  #view(session: Session, offset = session.start) {
    const from = Math.min(Math.max(offset, session.start), session.end);
    const text = session.output.slice(from - session.start, from - session.start + 20_000);
    return {
      id: session.id,
      command: session.command,
      status: session.status,
      exitCode: session.exitCode,
      output: text,
      offset: from,
      nextOffset: from + text.length,
      discardedBefore: session.start,
      unsealed: session.unsealed,
      ...(session.reason && { reason: session.reason }),
    };
  }
  /**
   * A command of this chat as it stands, for a wait (ADR 0125): its status and
   * everything kept of its output. Undefined when it isn't this chat's.
   */
  peek(owner: string, id: string): ProcessPeek | undefined {
    const session = this.#sessions.get(id);
    if (!session || session.owner !== owner) return undefined;
    return {
      command: session.command,
      status: session.status,
      exitCode: session.exitCode,
      output: session.output,
      start: session.start,
      end: session.end,
      ...(session.reason && { reason: session.reason }),
    };
  }
  /** Called whenever the command prints or changes state; returns how to stop listening. */
  onChange(id: string, listener: () => void): () => void {
    let set = this.#listeners.get(id);
    if (!set) this.#listeners.set(id, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.#listeners.delete(id);
    };
  }
  #changed(id: string) {
    for (const listener of this.#listeners.get(id) ?? []) listener();
  }
  tools(ctx: ToolContext): HostTool[] {
    const commandAccess = async (
      toolName: string,
      args: Record<string, unknown>,
      command: string,
      unsealed: boolean,
    ) => {
      if (ctx.permissionMode === 'plan')
        throw new Error('Leave plan mode before running or sending input to a command.');
      const restricted = await ctx.restricted?.('commands', command);
      if (!trustsFully(ctx) || ctx.untrusted?.() || restricted) {
        const answer = await ctx.ask({
          toolName,
          input: args,
          summary:
            toolName === 'process_start'
              ? `Run “${command.slice(0, 160)}”${unsealed ? ' with your computer’s access' : ' in the sealed work folder'}`
              : 'Send input to a running command',
          ...((restricted || ctx.untrusted?.()) && { taint: restricted || ctx.untrusted?.() }),
        });
        if (answer === 'deny') throw new Error('The user declined this command.');
      }
      ctx.signal.throwIfAborted();
    };
    return [
      {
        name: 'process_start',
        row: true,
        description:
          'Start or queue a managed shell command in this chat’s work folder and return its id immediately. Queued commands start when resources are available; read status and reason with process_read. The time limit includes queue time. Use for builds, tests and development servers. Logs can be read with process_read and it can be stopped with process_stop. A process lasts at most 30 minutes, belongs only to this chat, and stops when the chat is stopped or Conch closes. Network access needs dangerouslyDisableSandbox when commands are sealed. Never enter passwords or secrets through stdin.',
        input: {
          command: z.string().min(1).max(32_000),
          timeout_ms: z.number().int().min(1000).max(1_800_000).default(600_000),
          dangerouslyDisableSandbox: z.boolean().default(false),
        },
        run: async (args) => {
          if (this.#closed)
            throw new Error('Conch is closing. Start this command after it returns.');
          const command = String(args.command);
          if (
            touchesProtected({ command }, [
              ...this.deps.protectedPaths,
              ...secretPlaces().map((p) => p.path),
            ])
          )
            throw new Error(PROTECTED_MESSAGE);
          const unsealed =
            args.dangerouslyDisableSandbox === true ||
            !(await this.deps.sealed()) ||
            !sandboxSupport().available;
          await commandAccess('process_start', args, command, unsealed);
          const cwd = await ctx.workspace?.();
          if (!cwd) throw new Error('This chat does not have a work folder.');
          ctx.signal.throwIfAborted();
          if (this.#closed)
            throw new Error('Conch is closing. Start this command after it returns.');
          // Queued/running work is never evicted. Retained results and admission are bounded.
          for (const [id, s] of this.#sessions)
            if (s.status !== 'running' && s.status !== 'queued' && Date.now() - s.at > 3_600_000)
              this.#sessions.delete(id);
          const queued = [...this.#sessions.values()].filter((s) => s.status === 'queued');
          if (
            queued.length >= 32 ||
            queued.filter((s) => s.owner === ctx.conversationId).length >= 8
          )
            throw new Error(
              'This chat or computer already has enough commands waiting. Let them finish or stop a queued command first.',
            );
          if (this.#sessions.size >= 128) {
            const old = [...this.#sessions.values()].find(
              (s) => s.status !== 'running' && s.status !== 'queued',
            );
            if (old) this.#sessions.delete(old.id);
          }
          const onAbort = () => this.#stop(session);
          const session: Session = {
            id: randomUUID(),
            owner: ctx.conversationId,
            command,
            output: '',
            start: 0,
            end: 0,
            status: 'queued',
            exitCode: null,
            at: Date.now(),
            deadline: (this.deps.now ?? Date.now)() + Number(args.timeout_ms),
            unsealed,
            reason: 'Checking available resources before starting.',
            cancel: () => ctx.signal.removeEventListener('abort', onAbort),
            launch: () => {
              if (session.status !== 'queued') return;
              if (ctx.signal.aborted) {
                this.#stop(session);
                return;
              }
              if (session.deadline <= (this.deps.now ?? Date.now)()) {
                this.#stop(session, 'timed-out');
                return;
              }
              const child = spawn(
                process.execPath,
                [fileURLToPath(new URL('./worker.mjs', import.meta.url))],
                {
                  cwd,
                  env: hostEnvironment(),
                  detached: process.platform !== 'win32',
                  windowsHide: true,
                  stdio: ['pipe', 'pipe', 'pipe'],
                },
              );
              session.child = child;
              session.status = 'running';
              session.reason = undefined;
              const collect = (text: string) => {
                session.end += text.length;
                session.output = (session.output + text).slice(-64_000);
                session.start = session.end - session.output.length;
                this.#changed(session.id);
              };
              for (const stream of [child.stdout, child.stderr]) {
                const decoder = new StringDecoder('utf8');
                stream.on('data', (chunk: Buffer) => collect(decoder.write(chunk)));
                stream.on('end', () => collect(decoder.end()));
              }
              child.stdin.on('error', () => {});
              child.once('error', () => {
                collect('The command supervisor could not start.');
                if (session.status === 'running') session.status = 'exited';
                session.exitCode = 1;
                clearTimeout(session.timer);
                session.cancel();
                this.#changed(session.id);
                void this.#pump();
              });
              child.once('close', (code) => {
                if (session.status === 'running') session.status = 'exited';
                session.exitCode = code ?? session.exitCode;
                clearTimeout(session.timer);
                session.cancel();
                this.#changed(session.id);
                void this.#pump();
                if (process.platform !== 'win32' && child.pid) {
                  try {
                    process.kill(-child.pid, 'SIGKILL');
                  } catch {
                    /* Gone. */
                  }
                }
              });
              child.stdin.write(
                JSON.stringify({
                  command,
                  cwd,
                  ...(!unsealed && {
                    module: import.meta.resolve('@anthropic-ai/sandbox-runtime'),
                    sandbox: {
                      network: { allowedDomains: [], deniedDomains: [] },
                      filesystem: {
                        allowWrite: [cwd],
                        denyWrite: [...this.deps.protectedPaths, resolve(cwd, '.git')],
                        denyRead: [
                          ...this.deps.protectedPaths,
                          ...secretPlaces().map((p) => p.path),
                        ],
                      },
                    },
                  }),
                }) + '\n',
              );
            },
            timer: setTimeout(
              () => this.#stop(session, 'timed-out'),
              Number(args.timeout_ms),
            ).unref(),
          };
          this.#sessions.set(session.id, session);
          ctx.signal.addEventListener('abort', onAbort, { once: true });
          this.#watch();
          await this.#pump();
          return JSON.stringify(this.#view(session));
        },
      },
      {
        name: 'process_read',
        effect: 'read',
        row: true,
        description:
          'Read the status and incremental logs of a command started in this chat. Use nextOffset from the previous result. With id and wait_ms (up to 30000), wait for new output or completion. Output older than discardedBefore has been dropped. Without id, list this chat’s managed processes; wait_ms waits for resource conditions to change. Prefer waiting to rapid polling while Conch holds heavy work.',
        input: {
          id: z.string().uuid().optional(),
          offset: z.number().int().min(0).optional(),
          wait_ms: z.number().int().min(0).max(30_000).default(0),
        },
        run: async (args) => {
          if (!args.id && Number(args.wait_ms) > 0) {
            const until = performance.now() + Math.min(30_000, Number(args.wait_ms));
            const before = JSON.stringify(this.workload);
            do {
              await delay(Math.max(1, Math.min(5000, until - performance.now())), undefined, {
                signal: ctx.signal,
              });
              await this.resourceSnapshot().catch(() => undefined);
            } while (
              !this.#closed &&
              performance.now() < until &&
              JSON.stringify(this.workload) === before
            );
          }
          if (args.id && Number(args.wait_ms) > 0) {
            const session = this.#own(ctx.conversationId, String(args.id));
            const offset = args.offset === undefined ? session.end : Number(args.offset);
            const until = Date.now() + Number(args.wait_ms);
            while (
              (session.status === 'running' || session.status === 'queued') &&
              session.end <= offset &&
              Date.now() < until
            )
              await delay(Math.min(100, until - Date.now()), undefined, { signal: ctx.signal });
          }
          ctx.taint?.({ kind: 'download', label: 'command output' });
          return JSON.stringify(
            args.id
              ? this.#view(
                  this.#own(ctx.conversationId, String(args.id)),
                  args.offset as number | undefined,
                )
              : [...this.#sessions.values()]
                  .filter((s) => s.owner === ctx.conversationId)
                  .map((s) => this.#view(s, s.end)),
          );
        },
      },
      {
        name: 'process_write',
        row: true,
        description:
          'Send text to stdin of a running command in this chat. Include a newline to submit a line. This can run commands in an interactive program and requires command permission. Never send credentials; use the user handoff for secrets.',
        input: { id: z.string().uuid(), text: z.string().min(1).max(8192) },
        run: async (args) => {
          const session = this.#own(ctx.conversationId, String(args.id));
          if (
            touchesProtected({ command: String(args.text) }, [
              ...this.deps.protectedPaths,
              ...secretPlaces().map((p) => p.path),
            ])
          )
            throw new Error(PROTECTED_MESSAGE);
          await commandAccess('process_write', args, '', session.unsealed);
          if (session.status !== 'running' || !session.child)
            throw new Error(
              session.status === 'queued'
                ? 'This command is waiting to start.'
                : 'This command has finished.',
            );
          session.child.stdin.write(JSON.stringify({ data: args.text }) + '\n');
          return 'Input sent.';
        },
      },
      {
        name: 'process_stop',
        row: true,
        description:
          'Stop a managed command and its subprocesses. Only processes started in this chat can be stopped. Repeated stops are safe.',
        input: { id: z.string().uuid() },
        run: async (args) => {
          const session = this.#own(ctx.conversationId, String(args.id));
          this.#stop(session);
          return JSON.stringify(this.#view(session));
        },
      },
    ];
  }
}
