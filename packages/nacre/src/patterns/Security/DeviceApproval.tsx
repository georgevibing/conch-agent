import { Check, LogIn, X } from 'lucide-react';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './DeviceApproval.module.css';
import { PasskeyButton } from './PasskeyButton';
import { passkeyName, type PasskeyPlatform } from './passkeyPlatform';

export interface DeviceApprovalProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** `waiting` for the OK; `rejected` when turned down; `approved` for the moment before the app opens. */
  state: 'waiting' | 'rejected' | 'approved';
  /** The code to approve it by, as shown in the terminal: "K7M-Q2X". */
  code: string;
  /** What this device is called there: "Safari on iPhone". */
  device: string;
  /** When the request runs out (epoch ms). */
  expiresAt?: number;
  /** The command to approve it, one line to copy. */
  command?: string;
  /** Stop waiting (signs this device out, back to signing in). */
  onCancel?: () => void;
  /** After a "no": back to signing in, to ask once more. */
  onRetry?: () => void;
  /** Extra words under the steps, e.g. a hint about Settings on that computer. */
  footnote?: ReactNode;
  /**
   * The owner's other devices can approve it too (ADR 0065), not only the
   * computer running Conch: the words say so, and the terminal becomes the
   * second way.
   */
  fromDevices?: boolean;
  /**
   * This device could let itself in with a passkey instead of waiting: a
   * quiet second button under the code.
   */
  passkey?: { platform: PasskeyPlatform; onUse: () => void; loading?: boolean };
}

function left(expiresAt: number, now: number) {
  const s = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What a new device sees after the right password, when Conch approves new
 * devices: the code to approve it by, set in pearl tiles so it reads at a
 * glance across a room, and the one line to run on the computer running Conch.
 * The pearl breathes while it waits; a "no" says so plainly and offers to ask
 * again.
 */
export function DeviceApproval({
  state,
  code,
  device,
  expiresAt,
  command = `pnpm conch devices approve ${code}`,
  onCancel,
  onRetry,
  footnote,
  fromDevices = false,
  passkey,
  className,
  ...props
}: DeviceApprovalProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state !== 'waiting' || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state, expiresAt]);
  const groups = code.split('-');

  return (
    <section className={cx(styles.root, className)} data-state={state} {...props}>
      <div className={styles.mark}>
        {state === 'approved' ? (
          <span className={styles.done} aria-hidden>
            <Check />
          </span>
        ) : (
          <Pearl size="lg" state={state === 'waiting' ? 'thinking' : 'idle'} label={null} />
        )}
      </div>

      <div className={styles.head}>
        <h1 className={styles.title}>
          {state === 'waiting'
            ? 'Approve this device'
            : state === 'rejected'
              ? 'This device wasn’t approved'
              : 'Approved'}
        </h1>
        <p className={styles.lead}>
          {state === 'waiting' ? (
            fromDevices ? (
              <>
                You’re signed in, nearly. For extra protection, <strong>{device}</strong> also needs
                your OK from a device you’re already signed in on, or from the computer running
                Conch.
              </>
            ) : (
              <>
                You’re signed in, nearly. For extra protection, <strong>{device}</strong> also needs
                your OK on the computer running Conch.
              </>
            )
          ) : state === 'rejected' ? (
            fromDevices ? (
              <>
                It was turned down. If that was a mistake, it can still be approved for a few
                minutes, or sign in again to ask anew.
              </>
            ) : (
              <>
                It was turned down on the computer running Conch. If that was a mistake, it can
                still be approved there, or sign in again to ask anew.
              </>
            )
          ) : (
            <>Opening Conch…</>
          )}
        </p>
      </div>

      {state !== 'approved' && (
        <div
          className={styles.code}
          role="group"
          aria-label={`Approval code ${code.split('').join(' ')}`}
          data-lustre=""
          data-lustre-ambient={state === 'waiting' || undefined}
          data-faded={state === 'rejected' || undefined}
        >
          {groups.map((group, g) => (
            <span key={g} className={styles.group} aria-hidden>
              {group.split('').map((c, i) => (
                <span key={i} className={styles.tile}>
                  {c}
                </span>
              ))}
            </span>
          ))}
        </div>
      )}

      {state === 'waiting' && (
        <div className={styles.steps}>
          {fromDevices ? (
            <p className={styles.step}>
              Open Conch on your laptop or phone: it’s asking there now, with this code. Or, in a
              terminal on the computer running Conch:
            </p>
          ) : (
            <p className={styles.step}>
              On that computer, open a terminal in the Conch folder and run:
            </p>
          )}
          <div className={styles.command}>
            <code>{command}</code>
            <CopyButton value={command} label="Copy command" />
          </div>
          {footnote && <p className={styles.footnote}>{footnote}</p>}
        </div>
      )}

      {state === 'waiting' && passkey && (
        <div className={styles.passkey}>
          <span className={styles.or}>or</span>
          <PasskeyButton
            platform={passkey.platform}
            action="sign-in"
            size="md"
            variant="surface"
            loading={passkey.loading}
            onClick={passkey.onUse}
          >
            {passkey.platform === 'phone'
              ? 'Use a passkey from your phone to let yourself in'
              : `Use ${passkeyName(passkey.platform)} to let yourself in`}
          </PasskeyButton>
        </div>
      )}

      <div className={styles.foot}>
        {state === 'waiting' && (
          <p className={styles.status} aria-live="polite">
            <span className={styles.dot} aria-hidden />
            Waiting for approval
            {expiresAt && <span className={styles.time}>· {left(expiresAt, now)} left</span>}
          </p>
        )}
        {state === 'rejected' && onRetry && (
          <Button leadingIcon={<LogIn />} onClick={onRetry}>
            Sign in again
          </Button>
        )}
        {state === 'waiting' && onCancel && (
          <Button variant="ghost" leadingIcon={<X />} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  );
}
