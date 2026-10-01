import { BadgeCheck, BadgeQuestionMark, BadgeX, ShieldAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './SkillTrust.module.css';

export interface SkillSignatureBadgeProps extends Omit<ComponentProps<'section'>, 'title'> {
  state: 'unsigned' | 'verified' | 'untrusted' | 'invalid';
  /** The name the signer gave. Only the key says who it really is. */
  publisher?: string;
  /** The key's fingerprint: "3F9A 21C0 7B44 E1D2". */
  fingerprint?: string;
  /** Why the signature doesn't hold, in a sentence. */
  problem?: string;
  /** Another key giving the name of a publisher you trust. */
  lookalike?: boolean;
  /** "Trust this publisher…", for a signature that holds from someone you don't know yet. */
  action?: ReactNode;
}

/**
 * Who made a skill, provably (ADR 0031). "Verified: signed by Ada" when the
 * signature holds and you trust the key; who signed it and the key's
 * fingerprint when you don't (yet); a plain warning when the signature
 * doesn't hold — such a skill is off. Unsigned is a quiet line: most skills
 * are, and they still work.
 */
export function SkillSignatureBadge({
  state,
  publisher,
  fingerprint,
  problem,
  lookalike,
  action,
  className,
  ...props
}: SkillSignatureBadgeProps) {
  const titleId = useId();
  const who = publisher ?? 'someone';
  const title =
    state === 'verified'
      ? `Verified: signed by ${who}`
      : state === 'untrusted'
        ? lookalike
          ? `Signed with a key that isn’t ${who}’s`
          : `Signed by ${who}, who you haven’t said you trust`
        : state === 'invalid'
          ? 'Its signature doesn’t hold'
          : 'Not signed';
  const Icon =
    state === 'verified'
      ? BadgeCheck
      : state === 'invalid'
        ? BadgeX
        : lookalike
          ? ShieldAlert
          : BadgeQuestionMark;
  const tone =
    state === 'invalid' || lookalike ? 'danger' : state === 'untrusted' ? 'caution' : state;
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.signature, className)}
      data-state={tone}
      {...props}
    >
      <div className={styles.signatureHead}>
        <Icon aria-hidden className={styles.signatureIcon} />
        <p className={styles.heading} id={titleId}>
          {title}
        </p>
      </div>
      {state === 'unsigned' && (
        <p className={styles.fine}>
          Conch can’t say who made it. It works the same; it just can’t carry a name.
        </p>
      )}
      {state === 'untrusted' && (
        <p className={styles.fine}>
          {lookalike
            ? `You trust a publisher called ${who}, but this was signed with another key. Someone may be pretending to be them.`
            : `The signature holds, so nothing changed since ${who} signed it. Trust them to see “Verified” on their skills, and let their signed updates carry on.`}
        </p>
      )}
      {state === 'invalid' && problem && <p className={styles.fine}>{problem}</p>}
      {fingerprint && state !== 'unsigned' && (
        <p className={styles.fine}>
          Key <code className={styles.fingerprint}>{fingerprint}</code>
        </p>
      )}
      {action && <div className={styles.signatureAction}>{action}</div>}
    </section>
  );
}
