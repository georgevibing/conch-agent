import { Check, CircleAlert, Download, KeyRound, TriangleAlert } from 'lucide-react';
import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { Badge, type BadgeTone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import { AppMadeBadge } from '../ConchApps/AppMadeBadge';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './ProviderCard.module.css';

/** Mirrors `EngineState` in `@conch/protocol`. */
export type ProviderStateValue = 'checking' | 'not-installed' | 'signed-out' | 'ready' | 'error';

export interface ProviderStateMeta {
  /** What the state is called, in plain words. */
  label: string;
  tone: BadgeTone;
  icon: ReactNode;
  /** Whether something is needed from the user before this can be used. */
  attention: boolean;
}

/**
 * Plain words for every state a provider can be in. "Connected" rather than
 * "authenticated": this is the word a person would use.
 */
export const providerStateMeta: Record<ProviderStateValue, ProviderStateMeta> = {
  checking: {
    label: 'Looking…',
    tone: 'info',
    icon: <Spinner size="xs" label={null} />,
    attention: false,
  },
  // Not set up yet isn't a problem — it's an invitation. Only something that
  // broke earns the warm hairline.
  'not-installed': {
    label: 'Not on this computer',
    tone: 'neutral',
    icon: <Download />,
    attention: false,
  },
  'signed-out': {
    label: 'Needs connecting',
    tone: 'neutral',
    icon: <KeyRound />,
    attention: false,
  },
  ready: { label: 'Connected', tone: 'success', icon: <Check />, attention: false },
  error: { label: 'Not working', tone: 'danger', icon: <CircleAlert />, attention: true },
};

export interface ProviderAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
}

export interface ProviderCardProps extends Omit<ComponentProps<'article'>, 'title' | 'children'> {
  name: string;
  /** Provider id, for the bundled logo. */
  brand?: string;
  color?: string;
  /** Four or five words: "Claude, on this computer". */
  tagline: string;
  state: ProviderStateValue;
  /**
   * Words for the state when the usual ones don't fit it: a model on this
   * computer that's waiting for a model says "Needs a model", not "Not on this
   * computer". Read by screen readers too.
   */
  stateLabel?: string;
  /**
   * The default for new chats. Every connected provider can be picked in the
   * model picker; exactly one is the default, and says so.
   */
  active?: boolean;
  /** Quiet facts when it's connected: "Amazon Bedrock · 2.1.284". */
  meta?: ReactNode;
  /** What's wrong, or what's needed — one sentence, when the state needs explaining. */
  message?: string;
  /** Two or three things it's good at. Shown only while it isn't connected. */
  highlights?: string[];
  /** Early support: said out loud rather than discovered. */
  experimental?: boolean;
  /**
   * A Conch app brings it (ADR 0119): **Made by you**, or **Added from a
   * link**, beside its name, so a provider of your own never passes for one
   * Conch ships.
   */
  origin?: 'made' | 'link';
  /** The one thing to do: "Connect", "Make default", "Install". */
  action?: ProviderAction;
  /** A quieter second action: "Check again", "Remove key". */
  secondary?: ProviderAction;
  /** Position in the grid, to stagger the entrance. */
  index?: number;
}

/**
 * A provider at a glance: what it is, whether it's connected, and the one
 * button that moves it forward. Every connected provider is available at
 * once; the default for new chats wears a quiet badge.
 */
export function ProviderCard({
  name,
  brand,
  color,
  tagline,
  state,
  stateLabel,
  active,
  meta,
  message,
  highlights = [],
  experimental,
  origin,
  action,
  secondary,
  index = 0,
  className,
  style,
  ...props
}: ProviderCardProps) {
  const titleId = useId();
  const statusId = useId();
  const info = providerStateMeta[state];
  const label = stateLabel ?? info.label;
  const stagger = { '--pc-i': Math.min(index, 8), ...style } as CSSProperties;
  const connected = state === 'ready';

  return (
    <article
      aria-labelledby={titleId}
      aria-describedby={statusId}
      data-state={state}
      data-active={active || undefined}
      data-attention={info.attention ? info.tone : undefined}
      data-lustre=""
      className={cx(styles.card, className)}
      style={stagger}
      {...props}
    >
      <IntegrationLogo
        brand={brand}
        name={name}
        color={color}
        size="lg"
        status={connected ? 'ok' : state === 'checking' ? 'checking' : undefined}
        decorative
      />

      <div className={styles.text}>
        <div className={styles.heading}>
          <h3 id={titleId} className={styles.title}>
            {name}
          </h3>
          {active && (
            <Badge tone="accent" size="sm">
              Default
            </Badge>
          )}
          {experimental && (
            <Badge tone="neutral" size="sm">
              Early support
            </Badge>
          )}
          {origin && <AppMadeBadge kind={origin === 'made' ? 'made' : 'link'} />}
        </div>
        <p className={styles.tagline}>{tagline}</p>

        <p id={statusId} className={styles.status} data-tone={info.tone}>
          <span className={styles.statusIcon} aria-hidden>
            {info.icon}
          </span>
          <span className={styles.statusText}>
            <span className="nc-visually-hidden">{label}. </span>
            {message ?? (connected ? (meta ?? label) : label)}
          </span>
        </p>

        {!connected && highlights.length > 0 && (
          <ul className={styles.highlights}>
            {highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        )}

        {(action ?? secondary) && (
          <div className={styles.actions}>
            {action && (
              <Button
                size="sm"
                variant={active ? 'surface' : connected ? 'solid' : 'surface'}
                onClick={action.onClick}
                loading={action.loading}
              >
                {action.label}
              </Button>
            )}
            {secondary && (
              <Button
                size="sm"
                variant="ghost"
                onClick={secondary.onClick}
                loading={secondary.loading}
              >
                {secondary.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** The state as a small badge, e.g. "Needs connecting". */
export interface ProviderStatusBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  state: ProviderStateValue;
  size?: 'sm' | 'md';
}

export function ProviderStatusBadge({ state, size = 'sm', ...props }: ProviderStatusBadgeProps) {
  const meta = providerStateMeta[state];
  return (
    <Badge tone={meta.tone} size={size} icon={meta.icon} {...props}>
      {meta.label}
    </Badge>
  );
}

/** A warning worth reading before trusting a provider with everything. */
export function ProviderCaution({ children }: { children: ReactNode }) {
  return (
    <p className={styles.caution}>
      <TriangleAlert aria-hidden />
      <span>{children}</span>
    </p>
  );
}
