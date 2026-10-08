import { Check, Cloud, KeyRound, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './CloudAccountPicker.module.css';

/** Mirrors `CloudAccountState` in `@conch/protocol`. */
export type CloudAccountStateValue = 'ready' | 'expired' | 'signed-out' | 'unknown';

/** One account found on this computer: an AWS profile, a Google Cloud project, an Azure resource. */
export interface CloudAccountItem {
  id: string;
  /** "work-dev", "Acme ML", "acme-openai". */
  label: string;
  /** "Single sign-on · BedrockDeveloper · account …3333". */
  detail: string;
  state: CloudAccountStateValue;
  /** It can do everything in its account: a narrower one is safer, and offered first. */
  broad?: boolean;
  /** This computer's own default. */
  isDefault?: boolean;
}

export interface CloudAccountPickerProps {
  /** The list's name for screen readers: "AWS accounts on this computer". */
  label: string;
  accounts: CloudAccountItem[];
  /** The account in use. */
  chosen?: string;
  /** Being chosen right now: Conch is asking the cloud which models it can use. */
  pending?: string;
  /** What the chosen account turned out to be ("eu-west-1 · 8 models"), once it's ready. */
  ready?: string;
  /** The models the chosen account can use, shown as they're found. */
  models?: string[];
  /** Why the chosen account isn't ready: one sentence. */
  problem?: string;
  /** Signing this account in again, right now. */
  signingIn?: string;
  /** What the cloud's words are for single sign-on ("Sign in to AWS again"). */
  signInLabel?: string;
  onChoose: (id: string) => void;
  /** Offered for an account whose sign-in ended. */
  onSignIn?: (id: string) => void;
  /** Said when nothing was found. */
  empty?: ReactNode;
  className?: string;
}

const STATE_WORDS: Record<
  CloudAccountStateValue,
  { label: string; tone: 'success' | 'warning' | 'neutral' }
> = {
  ready: { label: 'Signed in', tone: 'success' },
  expired: { label: 'Sign-in ended', tone: 'warning' },
  'signed-out': { label: 'Not signed in', tone: 'neutral' },
  unknown: { label: 'Ready to try', tone: 'neutral' },
};

/**
 * The cloud accounts already on this computer, as a pick list (ADR 0109): one
 * press uses an account; a sign-in that ended has its own press to sign in
 * again, right there. The first signed-in account that isn't an
 * administrator is recommended, because Conch only needs to ask for models.
 *
 * Choosing one is the moment: the row is lit while Conch asks the cloud what
 * it can use, then the models it found arrive one after another, so a person
 * sees exactly what their account gives them. With reduced motion they're
 * simply there.
 */
export function CloudAccountPicker({
  label,
  accounts,
  chosen,
  pending,
  ready,
  models = [],
  problem,
  signingIn,
  signInLabel = 'Sign in again',
  onChoose,
  onSignIn,
  empty,
  className,
}: CloudAccountPickerProps) {
  const recommended = accounts.find((a) => a.state === 'ready' && !a.broad)?.id;
  if (!accounts.length)
    return empty ? (
      <div className={cx(styles.empty, className)} role="status">
        <Cloud aria-hidden className={styles.emptyIcon} />
        <div>{empty}</div>
      </div>
    ) : null;
  return (
    <ul className={cx(styles.list, className)} aria-label={label}>
      {accounts.map((account, index) => {
        const inUse = account.id === chosen;
        const checking = account.id === pending;
        const words = STATE_WORDS[account.state];
        const canSignIn =
          Boolean(onSignIn) && (account.state === 'expired' || account.state === 'signed-out');
        const settled = inUse && !checking && Boolean(ready) && !problem;
        return (
          <li
            key={account.id}
            className={styles.row}
            data-chosen={inUse || undefined}
            data-checking={checking || undefined}
            data-lustre=""
            style={{ '--ca-i': Math.min(index, 8) } as CSSProperties}
          >
            <span className={styles.tile} aria-hidden>
              {settled ? <Check className={styles.tick} /> : <Cloud />}
            </span>
            <div className={styles.text}>
              <div className={styles.heading}>
                <span className={styles.name}>{account.label}</span>
                {account.id === recommended && !inUse && <Badge tone="accent">Recommended</Badge>}
                {account.isDefault && <Badge tone="neutral">This computer’s default</Badge>}
              </div>
              <p className={styles.detail}>{account.detail}</p>
              <p className={styles.state} data-tone={words.tone}>
                <span className={styles.dot} aria-hidden />
                {words.label}
                {account.broad && (
                  <span className={styles.broad}>
                    <ShieldAlert aria-hidden />
                    Full access. A narrower role is safer.
                  </span>
                )}
              </p>
              {inUse && (checking || ready || problem) && (
                <div className={styles.result} aria-live="polite">
                  {checking ? (
                    <span className={styles.asking}>Asking which models it can use…</span>
                  ) : problem ? (
                    <span className={styles.problem}>
                      <TriangleAlert aria-hidden />
                      {problem}
                    </span>
                  ) : (
                    <>
                      <span className={styles.ready}>{ready}</span>
                      {models.length > 0 && (
                        <ul className={styles.models} aria-label="Models it can use">
                          {models.map((model, i) => (
                            <li
                              key={model}
                              className={styles.model}
                              style={{ '--ca-m': Math.min(i, 12) } as CSSProperties}
                            >
                              {model}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className={styles.actions}>
              {canSignIn && (
                <Button
                  size="sm"
                  variant={inUse ? 'solid' : 'surface'}
                  loading={signingIn === account.id}
                  onClick={() => onSignIn?.(account.id)}
                  aria-label={`${signInLabel}: ${account.label}`}
                >
                  <KeyRound aria-hidden className={styles.keyIcon} />
                  {signInLabel}
                </Button>
              )}
              {inUse ? (
                <span className={styles.using}>{checking ? 'Checking' : 'In use'}</span>
              ) : (
                <Button
                  size="sm"
                  variant={account.id === recommended ? 'solid' : 'surface'}
                  loading={checking}
                  disabled={Boolean(pending)}
                  onClick={() => onChoose(account.id)}
                  aria-label={`Use ${account.label}`}
                >
                  Use this
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
