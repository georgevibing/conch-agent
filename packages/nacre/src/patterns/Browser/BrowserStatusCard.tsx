import { Wrench } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl, type PearlState } from '../../components/Pearl';
import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import styles from './Browser.module.css';

export type BrowserStatusPhase =
  'off' | 'installing' | 'starting' | 'running' | 'repairing' | 'problem';

export interface BrowserStatusCardProps extends ComponentProps<'div'> {
  phase: BrowserStatusPhase;
  /** Turned off in settings. */
  disabled?: boolean;
  /** "Microsoft Edge". */
  browserName?: string;
  version?: string;
  install?: { percent: number; label: string };
  problem?: { message: string; command?: string };
  /** Shown only while there's a problem (and while its repair runs). */
  onRepair?: () => void;
  repairing?: boolean;
  /** Extra content under the status (e.g. which browser to use). */
  children?: ReactNode;
}

const pearl: Record<BrowserStatusPhase, PearlState> = {
  off: 'idle',
  installing: 'thinking',
  starting: 'thinking',
  repairing: 'thinking',
  running: 'streaming',
  problem: 'error',
};

/**
 * The browser's health in one glance: what's running and what it's doing.
 * Healthy, it says nothing about repairing: Repair everything in Settings →
 * Health looks after the browser with every other part. Only when the
 * browser really has a problem does the card offer one button, Repair, which
 * tries every fix in turn, the same ones Repair everything runs. What Conch
 * already fixed by itself is listed in Settings → Health.
 */
export function BrowserStatusCard({
  phase,
  disabled = false,
  browserName,
  version,
  install,
  problem,
  onRepair,
  repairing = false,
  children,
  className,
  ...props
}: BrowserStatusCardProps) {
  const browser = [browserName, version?.split('.')[0]].filter(Boolean).join(' ');
  const title = disabled
    ? 'Turned off'
    : {
        off: 'Ready',
        installing: 'Getting a browser ready',
        starting: 'Starting…',
        repairing: 'Fixing things…',
        running: 'Running',
        problem: 'Needs a hand',
      }[phase];
  const line = disabled
    ? 'The assistant won’t browse until you turn it back on.'
    : phase === 'problem'
      ? problem?.message
      : phase === 'installing'
        ? 'There was no browser on this computer, so Conch is fetching one. This happens once.'
        : browser
          ? phase === 'running'
            ? `${browser}, on its own profile. Your own browser isn’t touched.`
            : `Uses ${browser}. It starts when it’s needed and stops when it’s idle.`
          : 'Conch finds a browser, or downloads one, the first time it’s needed.';

  return (
    <div className={cx(styles.status, className)} data-phase={disabled ? 'off' : phase} {...props}>
      <div className={styles.statusHead}>
        <Pearl size="lg" state={disabled ? 'idle' : pearl[phase]} label={null} />
        <div className={styles.statusText}>
          <p className={styles.statusTitle} role="status">
            {title}
          </p>
          {line && <p className={styles.statusLine}>{line}</p>}
        </div>
        {onRepair && !disabled && (phase === 'problem' || phase === 'repairing' || repairing) && (
          <Button
            size="sm"
            variant="solid"
            leadingIcon={<Wrench />}
            loading={repairing || phase === 'repairing'}
            onClick={onRepair}
          >
            Repair
          </Button>
        )}
      </div>
      {phase === 'installing' && (
        <Progress
          value={install?.percent ?? null}
          label={install?.label ?? 'Downloading…'}
          showValue
        />
      )}
      {phase === 'problem' && problem?.command && (
        <div className={styles.statusCommand}>
          <span>Run this once in a terminal, then press Repair:</span>
          <code>{problem.command}</code>
        </div>
      )}
      {children}
    </div>
  );
}
