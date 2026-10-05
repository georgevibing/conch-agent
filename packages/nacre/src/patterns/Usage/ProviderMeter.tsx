import { Plug } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { ProviderLogo, type ProviderId } from '../ModelPicker/ProviderLogo';
import { describeUsage, headline } from './format';
import type { UsageValue } from './types';
import styles from './Usage.module.css';
import { UsageRing } from './UsageRing';
import { useNow } from './useNow';

export interface ProviderMeterProps extends Omit<ComponentProps<'button'>, 'value' | 'children'> {
  /** The provider answering this chat. Absent: none is connected yet. */
  provider?: { label: string; logo: ProviderId };
  /** Its limits. Shown when there's something to run out of. */
  usage?: UsageValue;
  /** What only the person can fix, in a word or two: "Sign in", "Not ready". */
  attention?: string;
  /** Freeze the clock (stories/tests). Defaults to a live 30 s tick. */
  now?: number;
  /**
   * A narrow header (a phone): the provider's mark and its ring, without the
   * name or "39% left" (they stay on the button for screen readers, and in
   * the panel it opens). What needs the person still says so in words.
   */
  compact?: boolean;
}

/**
 * The chat's provider, at a glance: who answers this chat and how much of
 * their limit is left, in one chip. It follows the chat — pick a model of
 * another provider and it changes with it. It asks for attention only when
 * that provider needs the person (a sign-in), and with no provider at all it
 * offers to connect one. Works as `Popover.Trigger asChild`.
 */
export function ProviderMeter({
  provider,
  usage,
  attention,
  now,
  compact = false,
  className,
  ...props
}: ProviderMeterProps) {
  const current = useNow(30_000, now);
  const head = usage ? headline(usage) : undefined;
  // Pay-as-you-go without a budget has nothing to run out of, and unknown says nothing.
  const gauge =
    usage &&
    head &&
    !attention &&
    usage.kind !== 'unknown' &&
    !(usage.kind === 'metered' && head.percentLeft === undefined);
  const label = !provider
    ? 'Connect a provider'
    : attention
      ? `${provider.label}: ${attention}`
      : gauge && usage
        ? `${provider.label}. ${describeUsage(usage, current)}`
        : provider.label;
  return (
    <button
      type="button"
      data-lustre=""
      data-kind={provider ? 'provider' : 'connect'}
      data-compact={compact || undefined}
      data-attention={attention ? '' : undefined}
      data-severity={attention ? 'warning' : gauge && head ? head.severity : 'normal'}
      aria-label={label}
      className={cx(styles.meter, styles.provider, className)}
      {...props}
    >
      {!provider ? (
        <>
          <Plug aria-hidden className={styles.meterIcon} />
          <span className={styles.providerName}>{compact ? 'Connect' : 'Connect a provider'}</span>
        </>
      ) : (
        <>
          <ProviderLogo provider={provider.logo} size={13} className={styles.providerLogo} />
          <span className={styles.providerName}>{provider.label}</span>
          {attention ? (
            <>
              <span aria-hidden className={styles.providerDivider} />
              <span className={styles.providerAttention}>
                <span aria-hidden className={styles.providerDot} />
                {attention}
              </span>
            </>
          ) : (
            gauge &&
            head && (
              <>
                <span aria-hidden className={styles.providerDivider} />
                <span className={styles.providerUsage}>
                  <UsageRing
                    percentLeft={head.percentLeft}
                    severity={head.severity}
                    size={13}
                    className={styles.meterRing}
                  />
                  <span className={styles.meterText}>{head.text}</span>
                </span>
              </>
            )
          )}
        </>
      )}
    </button>
  );
}
