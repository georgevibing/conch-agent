import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { DoctorCheck } from '../doctor/service';
import type { ToolContext } from '../conversations/manager';
import { hostEnvironment } from '../engines/host';
import type { HostTool } from '../engines/types';
import { sandboxSupport, secretPlaces } from '../conversations/sandbox';
import { touchesProtected, PROTECTED_MESSAGE } from '../lib/protect';

interface Session {
  id: string;
  owner: string;
  command: string;
  child: ChildProcessWithoutNullStreams;
  output: string;
  start: number;
  end: number;
  status: 'running' | 'exited' | 'stopped' | 'timed-out';
  exitCode: number | null;
  timer: NodeJS.Timeout;
  at: number;
  unsealed: boolean;
  deadline: number;
}

export class ProcessService {
  readonly #sessions = new Map<string, Session>();
  constructor(
    private readonly deps: {
      protectedPaths: string[];
      sealed: () => Promise<boolean>;
      now?: () => number;
    },
  ) {}
  doctorCheck(): DoctorCheck {
    return {
      id: 'processes',
      group: 'Tasks',
      title: 'Managed commands',
      run: async ({ repair }) => {
        const now = (this.deps.now ?? Date.now)();
        const overdue = [...this.#sessions.values()].filter(
          (s) => s.status === 'running' && s.deadline <= now,
        );
        if (repair) for (const session of overdue) this.#stop(session, 'timed-out');
        const running = [...this.#sessions.values()].filter((s) => s.status === 'running').length;
        return [
          {
            id: 'processes',
            group: 'Tasks',
            title: 'Managed commands',
            state: overdue.length ? (repair ? 'fixed' : 'warning') : 'ok',
            message: overdue.length
              ? repair
                ? 'Stopped commands that had exceeded their time limit.'
                : 'Some commands have exceeded their time limit. Repair stops them.'
              : running
                ? `${running} commands are running within their time limits.`
                : 'No commands are running.',
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
    if (session.status !== 'running') return;
    session.status = status;
    clearTimeout(session.timer);
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
    };
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
      if (
        ctx.permissionMode !== 'bypassPermissions' ||
        ctx.unattended ||
        ctx.untrusted?.() ||
        restricted
      ) {
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
          'Start a managed shell command in this chat’s work folder and return its id immediately. Use for builds, tests and development servers. Logs can be read with process_read and it can be stopped with process_stop. A process lasts at most 30 minutes, belongs only to this chat, and stops when the chat is stopped or Conch closes. Network access needs dangerouslyDisableSandbox when commands are sealed. Never enter passwords or secrets through stdin.',
        input: {
          command: z.string().min(1).max(32_000),
          timeout_ms: z.number().int().min(1000).max(1_800_000).default(600_000),
          dangerouslyDisableSandbox: z.boolean().default(false),
        },
        run: async (args) => {
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
          // Expired results are removed on the next start. Running commands are never evicted.
          for (const [id, s] of this.#sessions)
            if (s.status !== 'running' && Date.now() - s.at > 3_600_000) this.#sessions.delete(id);
          const running = [...this.#sessions.values()].filter((s) => s.status === 'running');
          if (
            running.length >= 16 ||
            running.filter((s) => s.owner === ctx.conversationId).length >= 4
          )
            throw new Error('Too many commands are running. Stop one before starting another.');
          if (this.#sessions.size >= 128) {
            const old = [...this.#sessions.values()].find((s) => s.status !== 'running');
            if (old) this.#sessions.delete(old.id);
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
          const session: Session = {
            id: randomUUID(),
            owner: ctx.conversationId,
            command,
            child,
            output: '',
            start: 0,
            end: 0,
            status: 'running',
            exitCode: null,
            at: Date.now(),
            deadline: (this.deps.now ?? Date.now)() + Number(args.timeout_ms),
            unsealed,
            timer: setTimeout(
              () => this.#stop(session, 'timed-out'),
              Number(args.timeout_ms),
            ).unref(),
          };
          this.#sessions.set(session.id, session);
          const collect = (text: string) => {
            session.end += text.length;
            session.output = (session.output + text).slice(-64_000);
            session.start = session.end - session.output.length;
          };
          for (const stream of [child.stdout, child.stderr]) {
            const decoder = new StringDecoder('utf8');
            stream.on('data', (chunk: Buffer) => collect(decoder.write(chunk)));
            stream.on('end', () => collect(decoder.end()));
          }
          child.stdin.on('error', () => {});
          child.once('error', () => {
            collect('The command supervisor could not start.');
            session.status = 'exited';
            session.exitCode = 1;
            clearTimeout(session.timer);
          });
          child.once('close', (code) => {
            if (session.status === 'running') session.status = 'exited';
            session.exitCode = code;
            clearTimeout(session.timer);
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
                    denyRead: [...this.deps.protectedPaths, ...secretPlaces().map((p) => p.path)],
                  },
                },
              }),
            }) + '\n',
          );
          return JSON.stringify(this.#view(session));
        },
      },
      {
        name: 'process_read',
        row: true,
        description:
          'Read the status and incremental logs of a command started in this chat. Use nextOffset from the previous result. With id and wait_ms (up to 30000), wait for new output or completion. Output older than discardedBefore has been dropped. Without id, list this chat’s managed processes.',
        input: {
          id: z.string().uuid().optional(),
          offset: z.number().int().min(0).optional(),
          wait_ms: z.number().int().min(0).max(30_000).default(0),
        },
        run: async (args) => {
          if (args.id && Number(args.wait_ms) > 0) {
            const session = this.#own(ctx.conversationId, String(args.id));
            const offset = args.offset === undefined ? session.end : Number(args.offset);
            const until = Date.now() + Number(args.wait_ms);
            while (session.status === 'running' && session.end <= offset && Date.now() < until)
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
          if (session.status !== 'running') throw new Error('This command has finished.');
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
