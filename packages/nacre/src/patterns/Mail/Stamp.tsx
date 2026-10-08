import { cx } from '../../utils/cx';
import styles from './Mail.module.css';

/**
 * How the email stands, on its stamp: `writing` (being looked over),
 * `sending` (the plane is in the air), `sent` (postmarked, with a tick),
 * `draft` (a pencil: kept, not posted), `uncertain` (a postmark with a
 * question in it), `failed` (the plane came back).
 */
export type StampState = 'writing' | 'sending' | 'sent' | 'draft' | 'uncertain' | 'failed';

export interface StampProps {
  state: StampState;
  /** It happened just now, in front of the person: the postmark lands. History is still. */
  arriving?: boolean;
  className?: string;
}

/**
 * A postage stamp, drawn: a perforated tile with a paper plane on it. It's
 * decoration (the card's words say what happened), so it's hidden from
 * assistive tech. Only transform and opacity move, and only when something
 * is in flight or has just landed.
 */
export function Stamp({ state, arriving, className }: StampProps) {
  const posted = state === 'sent' || state === 'uncertain';
  return (
    <span
      className={cx(styles.stamp, className)}
      data-state={state}
      data-arriving={arriving || undefined}
      aria-hidden
    >
      <svg viewBox="0 0 36 42" className={styles.stampArt} focusable="false">
        {/* The paper, its perforated edge bitten out by the card behind it. */}
        <rect className={styles.stampPaper} x="2" y="2" width="32" height="38" rx="2.5" />
        <rect
          className={styles.stampTeeth}
          x="2"
          y="2"
          width="32"
          height="38"
          rx="2.5"
          pathLength={140}
        />
        <rect className={styles.stampFrame} x="6" y="6" width="24" height="30" rx="1.5" />
        {state === 'draft' ? (
          <g className={styles.stampPencil}>
            <path d="M22.4 13.6a1.9 1.9 0 0 1 2.7 2.7l-8.6 8.6-3.6.9.9-3.6z" />
            <path d="m20.9 15.1 2.7 2.7" />
            <path d="M12 29h12" className={styles.stampLine} />
          </g>
        ) : (
          <g className={styles.stampPlane}>
            <path d="M19.9 29.1a.4.4 0 0 0 .75-.02l4.4-12.9a.4.4 0 0 0-.51-.51l-12.9 4.4a.4.4 0 0 0-.02.75l5.4 2.16a1.6 1.6 0 0 1 .89.89z" />
            <path d="m24.9 15.8-7.9 7.9" />
          </g>
        )}
      </svg>
      {(posted || state === 'failed') && (
        <svg viewBox="0 0 36 42" className={styles.postmark} focusable="false">
          {/* The cancellation across the stamp: it's been used, the letter went. */}
          {posted && (
            <g className={styles.postmarkWaves}>
              <path d="M1.5 12.5c2.6-1.8 4.6 1.8 7.2 0s4.6 1.8 7.2 0 4.6 1.8 7.2 0 4.6 1.8 7.2 0" />
              <path d="M1.5 18.5c2.6-1.8 4.6 1.8 7.2 0s4.6 1.8 7.2 0 4.6 1.8 7.2 0 4.6 1.8 7.2 0" />
            </g>
          )}
          {/* The seal on its corner: a tick, a question, or a cross. */}
          <g className={styles.postmarkSeal}>
            <circle cx="28.5" cy="33.5" r="8.25" className={styles.postmarkRing} />
            {state === 'sent' && (
              <path className={styles.postmarkTick} d="m25 33.7 2.4 2.4 4.6-4.8" pathLength={1} />
            )}
            {state === 'uncertain' && (
              <g className={styles.postmarkAsk}>
                <path d="M26.6 31.4a2 2 0 0 1 3.9.6c0 1.35-1.95 1.8-1.95 2.85" />
                <path d="M28.5 36.6h.01" />
              </g>
            )}
            {state === 'failed' && (
              <path className={styles.postmarkAsk} d="m25.9 30.9 5.2 5.2m0-5.2-5.2 5.2" />
            )}
          </g>
        </svg>
      )}
    </span>
  );
}
