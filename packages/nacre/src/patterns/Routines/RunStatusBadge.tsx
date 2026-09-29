import { AlertTriangle, Check, CircleDashed, Clock, Hand, SkipForward, Square } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Badge, type BadgeTone } from '../../components/Badge';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import styles from './RunStatusBadge.module.css';
import type { RunStatusValue } from './types';

export interface RunStatusMeta {
  label: string;
  tone: BadgeTone;
  icon: ReactNode;
  /** A short sentence for screen readers and tooltips. */
  description: string;
}

/** Friendly words for every state a run can be in. */
export const runStatusMeta: Record<RunStatusValue, RunStatusMeta> = {
  running: {
    label: 'Running…',
    tone: 'info',
    icon: <Spinner size="xs" label={null} />,
    description: 'This run is happening now.',
  },
  'needs-you': {
    label: 'Needs you',
    tone: 'warning',
    icon: <Hand />,
    description: 'Paused until you answer a question.',
  },
  succeeded: {
    label: 'Done',
    tone: 'success',
    icon: <Check />,
    description: 'Finished successfully.',
  },
  'nothing-to-do': {
    label: 'Nothing to do',
    tone: 'neutral',
    icon: <CircleDashed />,
    description: 'Ran fine, but there was nothing to do this time.',
  },
  failed: {
    label: 'Didn’t finish',
    tone: 'danger',
    icon: <AlertTriangle />,
    description: 'Something went wrong during this run.',
  },
  skipped: {
    label: 'Skipped',
    tone: 'neutral',
    icon: <SkipForward />,
    description: 'Skipped because the previous run was still going.',
  },
  missed: {
    label: 'Missed',
    tone: 'neutral',
    icon: <Clock />,
    description: 'Conch wasn’t running at the scheduled time.',
  },
  stopped: {
    label: 'Stopped',
    tone: 'neutral',
    icon: <Square />,
    description: 'Stopped before it finished.',
  },
};

export interface RunStatusBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  status: RunStatusValue;
  size?: 'sm' | 'md';
}

/** A run's state in one or two friendly words, with an icon and colour. */
export function RunStatusBadge({ status, size = 'sm', className, ...props }: RunStatusBadgeProps) {
  const meta = runStatusMeta[status];
  return (
    <Badge
      tone={meta.tone}
      size={size}
      icon={meta.icon}
      title={meta.description}
      data-status={status}
      className={cx(styles.badge, className)}
      {...props}
    >
      {meta.label}
    </Badge>
  );
}
