/** One thing a task did, said once however many times it did it. */
export interface TaskStepLine {
  label: string;
  /** It didn't work. */
  failed: boolean;
  /** Done this many times in a row ("Read command progress" while waiting). */
  times: number;
}

/** A step, or a run of steps alike enough to be said as one ("Read a.ts and 4 more"). */
export type TaskStepGroup = TaskStepLine | { lines: TaskStepLine[]; failed: boolean };

/** Runs this long or longer of the same kind of step are said as one. */
const RUN = 3;

const verb = (label: string) => label.split(/\s/, 1)[0]?.toLowerCase() ?? '';

/**
 * A task's steps, calm: the gateway's "Tool returned:" / "Tool failed:" said
 * as a mark, the same step again and again said once, and long runs of one
 * kind ("Read …", "Read …", "Read …") folded into a line that opens.
 */
export function groupSteps(labels: readonly string[]): TaskStepGroup[] {
  const lines: TaskStepLine[] = [];
  for (const raw of labels) {
    const failed = /^Tool failed:\s*/i.test(raw);
    const label = raw.replace(/^Tool (returned|failed):\s*/i, '').trim();
    const last = lines.at(-1);
    if (last && last.label === label && last.failed === failed) last.times++;
    else lines.push({ label, failed, times: 1 });
  }
  const out: TaskStepGroup[] = [];
  let run: TaskStepLine[] = [];
  const flush = () => {
    if (run.length >= RUN) out.push({ lines: run, failed: run[0]?.failed ?? false });
    else out.push(...run);
  };
  for (const line of lines) {
    const head = run[0];
    if (head && head.failed === line.failed && verb(head.label) === verb(line.label))
      run.push(line);
    else {
      flush();
      run = [line];
    }
  }
  flush();
  return out;
}
