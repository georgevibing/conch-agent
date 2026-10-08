/**
 * How Conch runs a cloud's own program (`aws`, `gcloud`, `az`): found where it
 * really lives, run by its full path with no shell, a deadline, nothing on
 * stdin, and none of Conch's own settings in its environment. Tests replace
 * the whole thing with a pretend program (`CloudExec`).
 *
 * What these programs print can hold a token (`print-access-token`), so their
 * output is never logged; only the short reason a command failed is kept, with
 * anything key-shaped taken out (`clean`).
 */
import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import { agentEnv, findExecutable, launch, run } from '../lib/proc';

export type CloudProgram = 'aws' | 'gcloud' | 'az';

export interface ExecResult {
  /** 127 when the program isn't on this computer. */
  code: number;
  stdout: string;
  stderr: string;
}

/** A long-running sign-in, and a way to stop it. */
export interface Running {
  done: Promise<number>;
  kill(): void;
}

export interface CloudExec {
  /** Where the program is, or undefined when it isn't on this computer. */
  find(program: CloudProgram): Promise<string | undefined>;
  run(
    program: CloudProgram,
    args: string[],
    options?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecResult>;
  /** A sign-in that opens a browser and waits: every line it prints goes to `onLine`. */
  spawn(
    program: CloudProgram,
    args: string[],
    onLine: (line: string) => void,
    options?: { env?: Record<string, string> },
  ): Running;
}

/** The folders each program's installers use beyond `PATH`. */
function extraDirs(program: CloudProgram): string[] {
  const home = homedir();
  if (platform() === 'win32') {
    const files = process.env.ProgramFiles ?? join('C:', 'Program Files');
    const files86 = process.env['ProgramFiles(x86)'] ?? join('C:', 'Program Files (x86)');
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    if (program === 'aws') return [join(files, 'Amazon', 'AWSCLIV2')];
    if (program === 'gcloud')
      return [
        join(local, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'),
        join(files86, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'),
      ];
    return [join(files, 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin')];
  }
  if (program === 'gcloud')
    return [
      join(home, 'google-cloud-sdk', 'bin'),
      '/opt/homebrew/share/google-cloud-sdk/bin',
      '/usr/local/share/google-cloud-sdk/bin',
      '/usr/lib/google-cloud-sdk/bin',
    ];
  return ['/usr/local/aws-cli'];
}

/** Find a cloud's program where its installers put it: for setup's needs, uncached. */
export function findCloudProgram(program: CloudProgram): Promise<string | undefined> {
  return findExecutable(program, { extraDirs: extraDirs(program) });
}

/** Each program's switches for never stopping to ask, never paging, never colouring. */
const QUIET: Record<CloudProgram, Record<string, string>> = {
  aws: { AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' },
  gcloud: { CLOUDSDK_CORE_DISABLE_PROMPTS: '1' },
  az: { AZURE_CORE_NO_COLOR: 'true', AZURE_CORE_ONLY_SHOW_ERRORS: 'true' },
};

/** A program's reason for failing, short, with anything that looks like a secret removed. */
export function clean(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const line =
    lines.find((l) =>
      /error|expired|denied|not |unable|invalid|please|login|log in|sign|refresh/i.test(l),
    ) ??
    lines[0] ??
    '';
  return line
    .replace(/\b(ya29\.|eyJ)[\w.-]+/g, '••••')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}/g, '••••')
    .replace(/(token|secret|password|credential)(s?\s*[=:]\s*)\S+/gi, '$1$2••••')
    .slice(0, 240);
}

/** The real programs on this computer. */
export function systemExec(): CloudExec {
  const found = new Map<CloudProgram, Promise<string | undefined>>();
  const find = (program: CloudProgram) => {
    let hit = found.get(program);
    if (!hit) {
      hit = findCloudProgram(program);
      // A program that isn't here may be installed in a minute: look again then.
      void hit.then((path) => {
        if (!path) found.delete(program);
      });
      found.set(program, hit);
    }
    return hit;
  };
  return {
    find,
    async run(program, args, options = {}) {
      const path = await find(program);
      if (!path) return { code: 127, stdout: '', stderr: `${program}: not found` };
      const result = await run(path, args, {
        timeout: options.timeout ?? 30_000,
        env: agentEnv({ ...QUIET[program], ...options.env }),
        input: '',
      });
      return { code: result.code ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
    spawn(program, args, onLine, options = {}) {
      let child: ReturnType<typeof spawn> | undefined;
      let killed = false;
      const done = find(program).then(
        (path) =>
          new Promise<number>((resolve) => {
            if (!path || killed) {
              if (!path) onLine(`${program}: not found`);
              resolve(127);
              return;
            }
            const { command, prefix } = launch(path);
            const started = spawn(command, [...prefix, ...args], {
              env: agentEnv({ ...QUIET[program], ...options.env }),
              stdio: ['pipe', 'pipe', 'pipe'],
              windowsHide: true,
            });
            child = started;
            let rest = '';
            const read = (chunk: Buffer) => {
              rest += chunk.toString('utf8');
              const lines = rest.split(/\r?\n/);
              rest = lines.pop() ?? '';
              for (const line of lines) if (line.trim()) onLine(line);
            };
            started.stdout?.on('data', read);
            started.stderr?.on('data', read);
            started.on('error', () => resolve(1));
            started.on('exit', (code) => {
              if (rest.trim()) onLine(rest);
              resolve(code ?? 1);
            });
          }),
      );
      return {
        done,
        kill: () => {
          killed = true;
          child?.kill();
        },
      };
    },
  };
}
