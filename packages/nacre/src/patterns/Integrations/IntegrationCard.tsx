import { ArrowRight, Check, Monitor } from 'lucide-react';
import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from './IntegrationLogo';
import styles from './IntegrationCard.module.css';
import { integrationStateMeta, type IntegrationStateValue } from './status';

interface Base extends Omit<ComponentProps<'article'>, 'title' | 'onToggle'> {
  name: string;
  /** Catalog id, for the logo. */
  brand?: string;
  color?: string;
  onOpen?: () => void;
  /** Position in a grid, to stagger the entrance. */
  index?: number;
}

export interface ConnectedCardProps extends Base {
  variant: 'connected';
  state: IntegrationStateValue;
  /** What's wrong, when the state needs attention. */
  message?: string;
  /** Quiet facts when all is well: "12 tools · used 2 hours ago". */
  meta?: ReactNode;
  /** The one thing to do about a problem ("Sign in again"). */
  action?: { label: string; onClick: () => void; loading?: boolean };
  enabled: boolean;
  onToggle?: (enabled: boolean) => void;
}

export interface CatalogCardProps extends Base {
  variant: 'catalog';
  tagline: string;
  /** Already set up: shows a check instead of the add arrow. */
  connected?: boolean;
  /** Runs on this computer. */
  local?: boolean;
  /** A short note, e.g. "Through your Claude account". */
  note?: string;
}

export type IntegrationCardProps = ConnectedCardProps | CatalogCardProps;

/**
 * An integration at a glance. `connected` cards show how it's doing and the
 * one button that fixes it; `catalog` tiles are for adding one. Tap
 * anywhere on the card to open it.
 */
export function IntegrationCard(props: IntegrationCardProps) {
  const titleId = useId();
  const statusId = useId();
  const { name, brand, color, onOpen, index = 0, className, style } = props;
  const stagger = { '--ic-i': Math.min(index, 12), ...style } as CSSProperties;

  if (props.variant === 'catalog') {
    const {
      variant: _v,
      tagline,
      connected,
      local,
      note,
      name: _n,
      brand: _b,
      color: _c,
      onOpen: _o,
      index: _i,
      className: _cl,
      style: _s,
      ...rest
    } = props;
    return (
      <article
        aria-labelledby={titleId}
        data-variant="catalog"
        data-connected={connected || undefined}
        data-lustre=""
        className={cx(styles.card, styles.tile, className)}
        style={stagger}
        {...rest}
      >
        <IntegrationLogo brand={brand} name={name} color={color} size="md" decorative />
        <div className={styles.text}>
          <h3 className={styles.title}>
            <button type="button" id={titleId} className={styles.open} onClick={onOpen}>
              {name}
            </button>
          </h3>
          <p className={styles.tagline}>{tagline}</p>
          {(local || note) && (
            <p className={styles.note}>
              {local && <Monitor aria-hidden />}
              {note ?? 'On this computer'}
            </p>
          )}
        </div>
        <span className={styles.affordance} aria-hidden>
          {connected ? <Check /> : <ArrowRight />}
        </span>
        {connected && <span className="nc-visually-hidden">Connected</span>}
      </article>
    );
  }

  const {
    variant: _v,
    state,
    message,
    meta,
    action,
    enabled,
    onToggle,
    name: _n,
    brand: _b,
    color: _c,
    onOpen: _o,
    index: _i,
    className: _cl,
    style: _s,
    ...rest
  } = props;
  const info = integrationStateMeta[state];
  const attention = info.attention;
  const busy = state === 'checking' || state === 'connecting';

  return (
    <article
      aria-labelledby={titleId}
      aria-describedby={statusId}
      data-variant="connected"
      data-state={state}
      data-attention={attention ? info.tone : undefined}
      data-lustre=""
      className={cx(styles.card, styles.connected, className)}
      style={stagger}
      {...rest}
    >
      <IntegrationLogo
        brand={brand}
        name={name}
        color={color}
        size="lg"
        status={state}
        decorative
      />
      <div className={styles.text}>
        <h3 className={styles.title}>
          <button type="button" id={titleId} className={styles.open} onClick={onOpen}>
            {name}
          </button>
        </h3>
        <p id={statusId} className={styles.status} data-tone={info.tone}>
          {(attention || busy || state === 'off') && (
            <span className={styles.statusIcon} aria-hidden>
              {info.icon}
            </span>
          )}
          <span className={styles.statusText}>
            <span className="nc-visually-hidden">{info.label}. </span>
            {attention || busy ? (message ?? info.label) : state === 'off' ? 'Off' : meta}
          </span>
        </p>
        {action && attention && (
          <div className={styles.action}>
            <Button size="sm" variant="surface" onClick={action.onClick} loading={action.loading}>
              {action.label}
            </Button>
          </div>
        )}
      </div>
      {onToggle && (
        <div className={styles.toggle}>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            aria-label={enabled ? `Turn off ${name}` : `Turn on ${name}`}
          />
        </div>
      )}
    </article>
  );
}
