import { CircleSlash, KeyRound, TriangleAlert, Zap } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import { formatWhenInline } from '../Routines/time';
import styles from './WatchStatus.module.css';
import { META_SEP } from '../../components/MetaList';

export type WatchStateValue = 'watching' | 'needs-you' | 'trouble' | 'off';

export interface WatchStatusProps extends Omit<ComponentProps<'section'>, 'title'> {
  state: WatchStateValue;
  /** What starts it: "When Anna Smith emails you". */
  text: string;
  /** "Only if it’s about the invoice". */
  onlyIf?: string;
  /** Why it can't look, or why it's waiting, in a sentence. */
  message?: string;
  /** The one thing to do about a problem. */
  action?: { label: string; onClick: () => void };
  noticed?: number;
  woke?: number;
  passed?: number;
  waiting?: number;
  lastNoticedAt?: number;
  /** Another app's address, while the public address is on. */
  address?: string;
  /** Its messages must be signed. */
  signed?: boolean;
  /** Make a new secret for the address; it's shown here once. */
  onNewSecret?: () => Promise<string>;
  /** "Conch only notices things while it’s running." with a way to keep it running. */
  footer?: ReactNode;
  now?: number;
}

const HEADINGS: Record<WatchStateValue, string> = {
  watching: 'Watching',
  'needs-you': 'Can’t look right now',
  trouble: 'Having trouble looking',
  off: 'Not watching',
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * How a routine that starts when something happens is doing (ADR 0056):
 * watching or not and why, what it noticed and what it started, another
 * app's address with a copy button, and a secret shown exactly once.
 */
export function WatchStatus({
  state,
  text,
  onlyIf,
  message,
  action,
  noticed = 0,
  woke = 0,
  passed = 0,
  waiting = 0,
  lastNoticedAt,
  address,
  signed,
  onNewSecret,
  footer,
  now,
  className,
  ...props
}: WatchStatusProps) {
  const [secret, setSecret] = useState<string>();
  const [making, setMaking] = useState(false);
  const [failed, setFailed] = useState<string>();
  const Icon = state === 'watching' ? Zap : state === 'off' ? CircleSlash : TriangleAlert;
  const tally = [
    count(noticed, 'thing noticed', 'things noticed'),
    count(woke, 'run started', 'runs started'),
    ...(passed ? [`${passed} passed over by “only if”`] : []),
    ...(waiting ? [`${waiting} waiting for the next run`] : []),
  ].join(META_SEP);

  const make = async () => {
    if (!onNewSecret) return;
    setMaking(true);
    setFailed(undefined);
    try {
      setSecret(await onNewSecret());
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Couldn’t make a secret.');
    } finally {
      setMaking(false);
    }
  };

  return (
    <section
      aria-label={HEADINGS[state]}
      data-state={state}
      className={cx(styles.watch, className)}
      {...props}
    >
      <p className={styles.heading}>
        <Icon aria-hidden />
        {HEADINGS[state]}
      </p>
      <p className={styles.text}>
        {text}
        {onlyIf && <span className={styles.dim}>, only if {onlyIf}</span>}
      </p>
      {message && (
        <p className={styles.message} role={state === 'needs-you' ? 'status' : undefined}>
          {message}
        </p>
      )}
      {action && (
        <Button size="sm" variant="surface" onClick={action.onClick} className={styles.fit}>
          {action.label}
        </Button>
      )}
      <p className={styles.tally}>
        {tally}
        {lastNoticedAt && (
          <span> · last {formatWhenInline(lastNoticedAt, { ...(now && { now }) })}</span>
        )}
      </p>

      {address && (
        <div className={styles.address}>
          <span className={styles.label}>Its address</span>
          <div className={styles.copyRow}>
            <code className={styles.code}>{address}</code>
            <CopyButton value={address} label="Copy the address" />
          </div>
          <span className={styles.note}>
            {signed
              ? 'It only takes messages signed with its secret.'
              : 'Anyone with this address can start it. Add a secret so only your app can.'}
          </span>
        </div>
      )}
      {onNewSecret &&
        (secret ? (
          <div className={styles.address}>
            <span className={styles.label}>Its secret, shown once</span>
            <div className={styles.copyRow}>
              <code className={styles.code}>{secret}</code>
              <CopyButton value={secret} label="Copy the secret" />
            </div>
            <span className={styles.note}>
              Paste it into the other app as its signing secret. Conch won’t show it again.
            </span>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<KeyRound />}
            loading={making}
            onClick={() => void make()}
            className={styles.fit}
          >
            {signed ? 'Make a new secret' : 'Add a secret'}
          </Button>
        ))}
      {failed && <p className={styles.message}>{failed}</p>}
      {footer && <div className={styles.note}>{footer}</div>}
    </section>
  );
}
