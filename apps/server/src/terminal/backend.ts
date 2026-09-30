import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { platform } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';

import type { TerminalBackend } from '@conch/protocol';

/**
 * What runs a terminal (ADR 0015, "Self-healing"). A real pseudo-terminal
 * through `node-pty` when it loads; otherwise a small Python PTY bridge on
 * POSIX; otherwise a basic line-mode shell. Everything above sees the same
 * `PtyProcess`, whichever it is.
 */

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** Stop reading output (flow control) until `resume`. */
  pause(): void;
  resume(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exit: { exitCode: number; signal?: number }) => void): void;
}

export interface SpawnOptions {
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export interface PtyBackend {
  kind: Exclude<TerminalBackend, 'none'>;
  spawn(file: string, args: string[], options: SpawnOptions): PtyProcess;
}

interface NodePty {
  spawn(
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
  ): {
    pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    pause(): void;
    resume(): void;
    onData(listener: (data: string) => void): void;
    onExit(listener: (exit: { exitCode: number; signal?: number }) => void): void;
  };
}

const require = createRequire(import.meta.url);

function nodePty(): PtyBackend {
  const pty = require('node-pty') as NodePty;
  return {
    kind: 'pty',
    spawn: (file, args, options) => {
      const child = pty.spawn(file, args, { name: 'xterm-256color', ...options });
      return {
        pid: child.pid,
        write: (data) => child.write(data),
        resize: (cols, rows) => {
          try {
            child.resize(cols, rows);
          } catch {
            // The shell just exited.
          }
        },
        kill: () => {
          try {
            child.kill();
          } catch {
            // Already gone.
          }
        },
        pause: () => child.pause(),
        resume: () => child.resume(),
        onData: (listener) => child.onData(listener),
        onExit: (listener) => child.onExit(listener),
      };
    },
  };
}

/**
 * A real PTY without native code: Python's `pty` module forks the shell, this
 * script copies bytes both ways, and resizes arrive as JSON lines on fd 3.
 */
const BRIDGE = String.raw`
import fcntl, json, os, pty, select, signal, struct, sys, termios
argv = json.loads(sys.argv[1]); cols = int(sys.argv[2]); rows = int(sys.argv[3])
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
def size(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
size(cols, rows)
watch = [fd, 0, 3]; pending = b''
while True:
    try:
        ready, _, _ = select.select(watch, [], [])
    except InterruptedError:
        continue
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            break
        os.write(fd, data)
    if 3 in ready:
        chunk = os.read(3, 4096)
        if not chunk:
            watch.remove(3)
            continue
        pending += chunk
        while b'\n' in pending:
            line, pending = pending.split(b'\n', 1)
            try:
                m = json.loads(line); size(int(m['cols']), int(m['rows'])); os.kill(pid, signal.SIGWINCH)
            except Exception:
                pass
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else status >> 8)
`;

function pipes(child: ReturnType<typeof spawn>) {
  return {
    stdin: child.stdin as Writable,
    stdout: child.stdout as Readable,
    stderr: child.stderr as Readable | null,
  };
}

function pythonBridge(python: string): PtyBackend {
  return {
    kind: 'python',
    spawn: (file, args, options) => {
      const child = spawn(
        python,
        ['-c', BRIDGE, JSON.stringify([file, ...args]), String(options.cols), String(options.rows)],
        {
          cwd: options.cwd,
          env: { ...options.env, TERM: 'xterm-256color' },
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        },
      );
      const { stdin, stdout } = pipes(child);
      const control = child.stdio[3] as Writable | undefined;
      const decoder = new StringDecoder('utf8');
      return {
        pid: child.pid ?? 0,
        write: (data) => stdin.write(data),
        resize: (cols, rows) => control?.write(`${JSON.stringify({ cols, rows })}\n`),
        kill: () => child.kill('SIGHUP'),
        pause: () => stdout.pause(),
        resume: () => stdout.resume(),
        onData: (listener) => stdout.on('data', (chunk: Buffer) => listener(decoder.write(chunk))),
        onExit: (listener) =>
          child.on('exit', (code, signal) =>
            listener({ exitCode: code ?? 0, signal: signal ? 1 : undefined }),
          ),
      };
    },
  };
}

/**
 * The last resort: a shell on plain pipes. Conch does the line editing (echo,
 * backspace, Enter) so typing still works; full-screen programs don't.
 */
export function basicBackend(): PtyBackend {
  return {
    kind: 'basic',
    spawn: (file, args, options) => {
      const child = spawn(file, args, { cwd: options.cwd, env: options.env, stdio: 'pipe' });
      const { stdin, stdout, stderr } = pipes(child);
      const decoder = new StringDecoder('utf8');
      const listeners = new Set<(data: string) => void>();
      const emit = (data: string) => {
        for (const listener of listeners) listener(data);
      };
      stdout.on('data', (chunk: Buffer) => emit(decoder.write(chunk).replace(/\r?\n/g, '\r\n')));
      stderr?.on('data', (chunk: Buffer) => emit(String(chunk).replace(/\r?\n/g, '\r\n')));
      let line = '';
      return {
        pid: child.pid ?? 0,
        write: (data) => {
          for (const char of data) {
            if (char === '\r') {
              emit('\r\n');
              stdin.write(`${line}\n`);
              line = '';
            } else if (char === '\x7f' || char === '\b') {
              if (line) {
                line = line.slice(0, -1);
                emit('\b \b');
              }
            } else if (char === '\x03') {
              child.kill('SIGINT');
              line = '';
              emit('^C\r\n');
            } else if (char >= ' ') {
              line += char;
              emit(char);
            }
          }
        },
        resize: () => undefined,
        kill: () => child.kill(),
        pause: () => stdout.pause(),
        resume: () => stdout.resume(),
        onData: (listener) => listeners.add(listener),
        onExit: (listener) =>
          child.on('exit', (code, signal) =>
            listener({ exitCode: code ?? 0, signal: signal ? 1 : undefined }),
          ),
      };
    },
  };
}

function findPython(): string | undefined {
  for (const name of ['python3', 'python']) {
    const probe = spawnSync(name, ['-c', 'import pty, termios, fcntl'], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    if (probe.status === 0) return name;
  }
  return undefined;
}

/** The best way to run terminals here, noting when it had to fall back. */
export function loadBackend(heal: (message: string) => void): PtyBackend {
  try {
    return nodePty();
  } catch {
    // The native module didn't load (no prebuild for this system, or the build failed).
  }
  if (platform() !== 'win32') {
    const python = findPython();
    if (python) {
      heal(
        'The terminal library couldn’t load here, so Conch runs terminals through Python instead.',
      );
      return pythonBridge(python);
    }
  }
  heal(
    'Conch couldn’t start a full terminal here, so terminals run in basic mode: commands work, full-screen programs don’t.',
  );
  return basicBackend();
}
