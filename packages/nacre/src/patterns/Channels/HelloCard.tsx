import { Check, RotateCw, SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { QRCode } from '../../components/QRCode';
import { cx } from '../../utils/cx';
import styles from './HelloCard.module.css';

export interface HelloCardProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** `waiting`: the link is out, nobody has said hello yet; `done`: someone did; `expired`: make a new one. */
  state: 'waiting' | 'done' | 'expired';
  title: ReactNode;
  /** One or two plain sentences: what to do. */
  children?: ReactNode;
  /** Where the button (and the QR code) go: the bot's chat, with its hello code. */
  link?: string;
  /** "Open Telegram". */
  openLabel: string;
  /** Show the QR code, for moving to the phone. Off on phones themselves. */
  qr?: boolean;
  /** "Scan with your phone's camera". */
  qrLabel?: string;
  /** What we're waiting for, in a few words ("Waiting for you to press Start"). */
  waitingLabel?: string;
  /** When the link stops working (epoch ms). */
  expiresAt?: number;
  onRenew?: () => void;
  renewing?: boolean;
  /** When done: what to do next (a test message, back to the list). */
  actions?: ReactNode;
}

function minutesLeft(expiresAt: number, now: number) {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

/**
 * The last step of connecting a chat app: one link that recognises you. It
 * shows as a button and, on a computer, as a QR code for the phone; while it
 * waits, the code's rim slowly orbits and a pearl breathes beside the words,
 * and the moment you say hello it turns into a welcome.
 */
export function HelloCard({
  state,
  title,
  children,
  link,
  openLabel,
  qr = true,
  qrLabel = 'Scan with your phone’s camera',
  waitingLabel = 'Waiting for your hello',
  expiresAt,
  onRenew,
  renewing,
  actions,
  className,
  ...props
}: HelloCardProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state !== 'waiting' || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [state, expiresAt]);
  const left = expiresAt ? minutesLeft(expiresAt, now) : undefined;

  return (
    <section
      className={cx(styles.card, className)}
      data-state={state}
      aria-live="polite"
      {...props}
    >
      {state !== 'done' && qr && link && (
        <div
          className={styles.qr}
          data-lustre=""
          data-lustre-ambient={state === 'waiting' || undefined}
          data-expired={state === 'expired' || undefined}
        >
          <QRCode value={link} size={148} label={`${qrLabel}: ${openLabel}`} />
          <span className={styles.qrLabel}>{qrLabel}</span>
        </div>
      )}
      {state === 'done' && (
        <span className={styles.done} aria-hidden>
          <Check size={26} strokeWidth={2.5} />
        </span>
      )}
      <div className={styles.text}>
        <h3 className={styles.title}>{title}</h3>
        {children && <div className={styles.body}>{children}</div>}
        {state === 'waiting' && link && (
          <>
            <Button
              asChild
              variant="solid"
              trailingIcon={<SquareArrowOutUpRight />}
              className={styles.open}
            >
              <a href={link} target="_blank" rel="noreferrer noopener">
                {openLabel}
              </a>
            </Button>
            <p className={styles.waiting}>
              <Pearl size="xs" state="thinking" label={null} />
              {waitingLabel}
            </p>
            {left !== undefined && left > 0 && (
              <p className={styles.expiry}>
                The link works for {left === 1 ? '1 more minute' : `${left} more minutes`}, and only
                once.
              </p>
            )}
          </>
        )}
        {state === 'expired' && onRenew && (
          <Button variant="solid" leadingIcon={<RotateCw />} onClick={onRenew} loading={renewing}>
            Make a new link
          </Button>
        )}
        {state === 'done' && actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </section>
  );
}
