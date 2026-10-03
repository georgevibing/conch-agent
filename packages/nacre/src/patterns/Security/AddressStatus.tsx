import { ArrowRight, GlobeLock, Globe, TriangleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './AddressStatus.module.css';

export type AddressState = 'off' | 'ready' | 'getting' | 'problem';

export interface AddressProblem {
  /** What's wrong, in one sentence: "conch.example.com points somewhere else now." */
  message: ReactNode;
  /** The one thing that fixes it here. */
  action?: { label: string; onClick: () => void; loading?: boolean };
  /** Or, when only a person can, the one line to copy. */
  command?: string;
}

export interface AddressStatusProps extends Omit<ComponentProps<'section'>, 'children'> {
  state: AddressState;
  /** The name: "conch.example.com". */
  address?: string;
  /** When the certificate runs out, in words: "2 January 2027". */
  until?: string;
  /** What it's doing while it gets one: "Asking Let’s Encrypt…". */
  progress?: string;
  problem?: AddressProblem;
  /** Stop answering at this address. */
  onTurnOff?: () => void;
  turningOff?: boolean;
  /** Choose an address (when it's off). */
  onSetUp?: () => void;
}

/**
 * Settings → Security → Your address (ADR 0064): the address Conch answers at,
 * whether its certificate is good, and the one thing to do when it isn't. A
 * healthy address is one quiet line; getting a certificate wears the orbiting
 * rim, as anything alive does; a problem is said in a sentence with its fix.
 */
export function AddressStatus({
  state,
  address,
  until,
  progress = 'Getting a certificate from Let’s Encrypt…',
  problem,
  onTurnOff,
  turningOff,
  onSetUp,
  className,
  ...props
}: AddressStatusProps) {
  if (state === 'off' || !address) {
    return (
      <section
        aria-label="Your address"
        className={cx(styles.root, className)}
        data-state="off"
        {...props}
      >
        <div className={styles.head}>
          <span className={styles.icon} aria-hidden>
            <Globe />
          </span>
          <div className={styles.body}>
            <p className={styles.title}>Open Conch from anywhere</p>
            <p className={styles.meta}>
              At an address you own, like conch.yourname.com. Conch gets the certificate and renews
              it by itself.
            </p>
          </div>
          {onSetUp && (
            <Button size="sm" variant="surface" trailingIcon={<ArrowRight />} onClick={onSetUp}>
              Set up
            </Button>
          )}
        </div>
      </section>
    );
  }

  const url = `https://${address}`;
  return (
    <section
      aria-label="Your address"
      className={cx(styles.root, className)}
      data-state={state}
      data-lustre={state === 'getting' ? '' : undefined}
      data-lustre-ambient={state === 'getting' || undefined}
      {...props}
    >
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden>
          {state === 'problem' ? <TriangleAlert /> : <GlobeLock />}
        </span>
        <div className={styles.body}>
          <p className={styles.url}>
            <span className={styles.urlText}>{url}</span>
            <CopyButton value={url} label="Copy address" />
          </p>
          <p className={styles.status} aria-live="polite">
            {state === 'ready' && (
              <>
                <span className={styles.dot} aria-hidden />
                Secure · renews by itself
                {until && <span className={styles.until}>· certificate good until {until}</span>}
              </>
            )}
            {state === 'getting' && (
              <>
                <Pearl size="xs" state="thinking" label={null} />
                {progress}
              </>
            )}
            {state === 'problem' && <>Needs a look</>}
          </p>
        </div>
        {onTurnOff && (
          <Button size="sm" variant="ghost" loading={turningOff} onClick={onTurnOff}>
            Turn off
          </Button>
        )}
      </div>

      {state === 'problem' && problem && (
        <div className={styles.problem}>
          <p className={styles.problemText}>{problem.message}</p>
          {problem.command && (
            <div className={styles.command}>
              <code>{problem.command}</code>
              <CopyButton value={problem.command} label="Copy command" />
            </div>
          )}
          {problem.action && (
            <div>
              <Button size="sm" loading={problem.action.loading} onClick={problem.action.onClick}>
                {problem.action.label}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
