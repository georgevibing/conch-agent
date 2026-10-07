import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { LineGroup } from '../LineGroup';
import { groupSteps, type TaskStepLine } from './steps';
import styles from './Tasks.module.css';

export interface TaskStepsProps extends Omit<ComponentProps<'ol'>, 'children'> {
  /** What it did, newest last, as the gateway says it. */
  steps: readonly string[];
  /** Draw a step's words (`code` as code, say). */
  render?: (label: string) => ReactNode;
  /** Only the last few, while it works. */
  last?: number;
}

function Line({ line, render }: { line: TaskStepLine; render: (label: string) => ReactNode }) {
  return (
    <span className={styles.step} data-failed={line.failed || undefined}>
      {line.failed && (
        <>
          <X className={styles.stepFailed} aria-hidden />
          <span className="nc-visually-hidden">Didn’t work: </span>
        </>
      )}
      <span>{render(line.label)}</span>
      {line.times > 1 && (
        <span className={styles.stepTimes} aria-label={`${line.times} times`}>
          ×{line.times}
        </span>
      )}
    </span>
  );
}

/** What a task did, calm: repeats said once, long runs of one kind folded to a line. */
export function TaskSteps({
  steps,
  render = (label) => label,
  last,
  className,
  ...props
}: TaskStepsProps) {
  const groups = groupSteps(steps);
  const shown = last ? groups.slice(-last) : groups;
  if (!shown.length) return null;
  return (
    <ol className={cx(styles.steps, className)} aria-label="What it did" {...props}>
      {shown.map((group, i) =>
        'lines' in group ? (
          <li key={i}>
            <LineGroup
              className={styles.stepGroup}
              summary={
                <Line
                  line={{ label: group.lines[0]?.label ?? '', failed: group.failed, times: 1 }}
                  render={(label) => (
                    <>
                      {render(label)}{' '}
                      <span className={styles.stepMore}>and {group.lines.length - 1} more</span>
                    </>
                  )}
                />
              }
              items={group.lines.map((line, n) => (
                <Line key={n} line={line} render={render} />
              ))}
              label="Steps like it"
            />
          </li>
        ) : (
          <li key={i}>
            <Line line={group} render={render} />
          </li>
        ),
      )}
    </ol>
  );
}
