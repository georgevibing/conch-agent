import { Check, RotateCw } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { QRCode } from '../../components/QRCode';
import { cx } from '../../utils/cx';
import styles from './DeviceLinkCard.module.css';

export type DeviceLinkState =
  'starting' | 'showing' | 'finishing' | 'linked' | 'expired' | 'failed';

export interface DeviceLinkCardProps extends Omit<ComponentProps<'section'>, 'title'> {
  /**
   * - `starting`: asking the app for a code;
   * - `showing`: the code is up (it changes by itself);
   * - `finishing`: scanned, the phone is setting it up;
   * - `linked`: done;
   * - `expired` / `failed`: show a new one.
   */
  state: DeviceLinkState;
  /** What the QR code says (the app's own link), while `showing`. */
  qr?: string;
  title: ReactNode;
  /** One or two plain sentences, or the steps on the phone. */
  children?: ReactNode;
  /** Read with the code: "Scan with WhatsApp on your phone". */
  qrLabel?: string;
  /** For `expired` and `failed`: what went wrong, in a sentence. */
  message?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  /** When linked: what to do next. */
  actions?: ReactNode;
}

/**
 * Linking a chat account to Conch by QR code, the way WhatsApp Web and Signal
 * Desktop do. The code sits in a quiet frame whose rim slowly orbits while it
 * waits; it changes by itself, so there's nothing to press. Once the phone
 * has scanned, the code steps back while the phone finishes, then the card
 * turns into a welcome. A code that ran out offers a new one, in place.
 */
export function DeviceLinkCard({
  state,
  qr,
  title,
  children,
  qrLabel = 'Scan with your phone',
  message,
  onRetry,
  retrying,
  retryLabel = 'Show a new code',
  actions,
  className,
  ...props
}: DeviceLinkCardProps) {
  const ended = state === 'expired' || state === 'failed';
  return (
    <section
      className={cx(styles.card, className)}
      data-state={state}
      aria-live="polite"
      aria-busy={state === 'starting' || state === 'finishing' || undefined}
      {...props}
    >
      {state === 'linked' ? (
        <span className={styles.done} aria-hidden>
          <Check size={26} strokeWidth={2.5} />
        </span>
      ) : (
        <div
          className={styles.frame}
          data-lustre=""
          data-lustre-ambient={state === 'showing' || undefined}
        >
          {state === 'showing' && qr ? (
            <QRCode value={qr} size={184} label={qrLabel} />
          ) : (
            <span className={styles.blank} data-ended={ended || undefined} aria-hidden>
              {state === 'finishing' ? (
                <Check size={36} strokeWidth={2.25} className={styles.scanned} />
              ) : !ended ? (
                <Pearl size="sm" state="thinking" label={null} />
              ) : null}
            </span>
          )}
          <span className={styles.frameLabel}>
            {state === 'showing'
              ? qrLabel
              : state === 'finishing'
                ? 'Scanned'
                : state === 'starting'
                  ? 'Getting a code…'
                  : 'No code showing'}
          </span>
        </div>
      )}
      <div className={styles.text}>
        <h3 className={styles.title}>{title}</h3>
        {children && <div className={styles.body}>{children}</div>}
        {state === 'showing' && (
          <p className={styles.waiting}>
            <Pearl size="xs" state="thinking" label={null} />
            Waiting for your phone. The code changes by itself.
          </p>
        )}
        {state === 'finishing' && (
          <p className={styles.waiting}>
            <Pearl size="xs" state="thinking" label={null} />
            Finishing on your phone…
          </p>
        )}
        {ended && message && <p className={styles.message}>{message}</p>}
        {ended && onRetry && (
          <Button variant="solid" leadingIcon={<RotateCw />} onClick={onRetry} loading={retrying}>
            {retryLabel}
          </Button>
        )}
        {state === 'linked' && actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </section>
  );
}
