/**
 * Pretend clouds for tests: a pretend `aws`, `gcloud` and `az` (`fakeExec`)
 * and a pretend home of files (`files`). Nothing here reaches a real cloud or
 * reads a real `~/.aws`.
 */
import type { CloudExec, CloudProgram, ExecResult } from './exec';

export interface ExecCall {
  program: CloudProgram;
  args: string[];
}

type Answer = Partial<ExecResult> | ((args: string[]) => Partial<ExecResult>);

/**
 * A pretend program per cloud. `answers` maps `program subcommand…` (the
 * start of the arguments) to what it prints; anything else exits 1. A
 * program left out of `present` isn't on this computer (exit 127).
 */
export function fakeExec(
  answers: Record<string, Answer> = {},
  options: {
    present?: CloudProgram[];
    /** What a sign-in prints, line by line, and its exit code. */
    signIn?: { lines: string[]; code?: number };
  } = {},
) {
  const calls: ExecCall[] = [];
  const present = new Set(options.present ?? ['aws', 'gcloud', 'az']);
  const answer = (program: CloudProgram, args: string[]): ExecResult => {
    calls.push({ program, args });
    if (!present.has(program)) return { code: 127, stdout: '', stderr: `${program}: not found` };
    const line = [program, ...args].join(' ');
    const match = Object.keys(answers)
      .filter((prefix) => line.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return { code: 1, stdout: '', stderr: 'unexpected' };
    const found = answers[match];
    const said = typeof found === 'function' ? found(args) : found;
    return { code: said?.code ?? 0, stdout: said?.stdout ?? '', stderr: said?.stderr ?? '' };
  };
  const exec: CloudExec = {
    find: (program) => Promise.resolve(present.has(program) ? `/usr/bin/${program}` : undefined),
    run: (program, args) => Promise.resolve(answer(program, args)),
    spawn: (program, args, onLine) => {
      calls.push({ program, args });
      const sign = options.signIn ?? { lines: [], code: 0 };
      const done = new Promise<number>((resolve) => {
        setTimeout(() => {
          for (const line of sign.lines) onLine(line);
          resolve(present.has(program) ? (sign.code ?? 0) : 127);
        }, 0);
      });
      return { done, kill: () => undefined };
    },
  };
  return { exec, calls };
}

/** A pretend set of files, read as the real reader would: undefined when missing. */
export function files(map: Record<string, string>) {
  return (path: string) => Promise.resolve(map[path]);
}
