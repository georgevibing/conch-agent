/**
 * Running a program for a place (ADR 0106): bytes in on stdin, bytes out,
 * bounded, stopped with its whole process group. One seam (`Exec`) so tests
 * can pretend to be Docker or `ssh` without either being installed.
 */
import { spawn } from 'node:child_process';

export interface ExecOptions {
  stdin?: Buffer | string;
  /** Kept tail of stdout and stderr together, in bytes. */
  maxOutput?: number;
  /** Raw stdout is kept whole (up to `maxStdout`) for programs whose output is data (a tar). */
  maxStdout?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  cwd?: string;
}

export interface ExecResult {
  code: number | null;
  /** stdout and stderr as they came, the tail kept. */
  output: string;
  /** stdout alone, whole, for data. */
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  /** stdout was longer than `maxStdout` and was cut. */
  overflow: boolean;
}

export type Exec = (program: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

const KEEP = 64_000;

export const exec: Exec = (program, args, options = {}) =>
  new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) return reject(signal.reason ?? new Error('Stopped.'));
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? {},
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    let output = '';
    let stderr = '';
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    let timedOut = false;
    const maxStdout = options.maxStdout ?? 0;
    const maxOutput = options.maxOutput ?? KEEP;
    const stop = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* Already gone. */
      }
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, options.timeoutMs).unref()
      : undefined;
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (maxStdout) {
        if (size + chunk.length > maxStdout) {
          overflow = true;
          stop();
        } else {
          chunks.push(chunk);
          size += chunk.length;
        }
      }
      output = (output + chunk.toString('utf8')).slice(-maxOutput);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr = (stderr + text).slice(-maxOutput);
      output = (output + text).slice(-maxOutput);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin ?? '');
    child.once('error', (error) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(error);
    });
    child.once('close', (code) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) return reject(signal.reason ?? new Error('Stopped.'));
      resolve({ code, output, stdout: Buffer.concat(chunks), stderr, timedOut, overflow });
    });
  });

/** Quoted for a POSIX shell, whatever it holds. */
export const shq = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
