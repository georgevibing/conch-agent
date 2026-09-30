import { Clock, Plus } from 'lucide-react';
import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './ChannelCard.module.css';
import { channelStateMeta, type ChannelStateValue } from './status';

export interface ChannelTileProps extends Omit<ComponentProps<'article'>, 'title'> {
  /** `telegram`, `discord`, `slack`… — picks the logo. */
  brand: string;
  name: string;
  color?: string;
  /** One plain line on what it's like. */
  tagline: string;
  /** Roughly how long setting it up takes. */
  minutes?: number;
  onConnect?: () => void;
  /** Position in a grid, to stagger the entrance. */
  index?: number;
}

/**
 * A chat app you can add: its logo, one line about it, and how long it takes.
 * The whole tile is the button.
 */
export function ChannelTile({
  brand,
  name,
  color,
  tagline,
  minutes,
  onConnect,
  index = 0,
  className,
  style,
  ...props
}: ChannelTileProps) {
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      data-lustre=""
      className={cx(styles.card, styles.tile, className)}
      style={{ '--cc-i': Math.min(index, 12), ...style } as CSSProperties}
      {...props}
    >
      <IntegrationLogo brand={brand} name={name} color={color} size="lg" decorative />
      <h3 id={titleId} className={styles.title}>
        <button
          type="button"
          className={styles.open}
          onClick={onConnect}
          aria-label={'Connect ' + name}
        >
          {name}
        </button>
      </h3>
      <p className={styles.tagline}>{tagline}</p>
      <div className={styles.tileFoot}>
        {minutes !== undefined && (
          <span className={styles.minutes}>
            <Clock aria-hidden size={13} />
            About {minutes} {minutes === 1 ? 'minute' : 'minutes'}
          </span>
        )}
        <span className={styles.affordance} aria-hidden>
          <Plus size={14} />
          Connect
        </span>
      </div>
    </article>
  );
}

export interface ChannelSoonProps extends ComponentProps<'div'> {
  apps: { brand: string; name: string; color?: string }[];
}

/** The chat apps that are coming, quietly, in a row. */
export function ChannelSoon({ apps, className, ...props }: ChannelSoonProps) {
  return (
    <div className={cx(styles.soon, className)} {...props}>
      <span className={styles.soonNote}>Coming soon</span>
      <ul className={styles.soonList} aria-label="Coming soon">
        {apps.map((app) => (
          <li key={app.brand} className={styles.soonItem}>
            <IntegrationLogo
              brand={app.brand}
              name={app.name}
              color={app.color}
              size="xs"
              decorative
            />
            {app.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ChannelCardProps extends Omit<ComponentProps<'article'>, 'title' | 'onToggle'> {
  brand: string;
  /** The app's name: "Telegram". */
  app: string;
  color?: string;
  /** The bot's name as people see it. */
  name: string;
  /** Its handle, without the @. */
  handle?: string;
  /** The bot's own picture (a data: URL), shown with the app's logo on its corner. */
  avatar?: string;
  state: ChannelStateValue;
  /** What's wrong, or what's needed, in one sentence. */
  message?: string;
  /** Quiet facts when all is well: "You and Grace · last message 5 minutes ago". */
  meta?: ReactNode;
  /** People waiting to be let in. */
  requests?: number;
  /** The one thing to do now ("Say hello", "Paste a new key"). */
  action?: { label: string; onClick: () => void; loading?: boolean };
  enabled: boolean;
  onToggle?: (enabled: boolean) => void;
  onOpen?: () => void;
  index?: number;
}

/**
 * A connected channel at a glance: whose bot it is, how it's doing, and the
 * one button that moves it forward. Tap anywhere to open it.
 */
export function ChannelCard({
  brand,
  app,
  color,
  name,
  handle,
  avatar,
  state,
  message,
  meta,
  requests = 0,
  action,
  enabled,
  onToggle,
  onOpen,
  index = 0,
  className,
  style,
  ...props
}: ChannelCardProps) {
  const titleId = useId();
  const statusId = useId();
  const status = channelStateMeta[state];
  const attention = state !== 'online' && state !== 'off' && state !== 'connecting';
  return (
    <article
      aria-labelledby={titleId}
      aria-describedby={statusId}
      data-state={state}
      data-attention={attention || undefined}
      data-lustre=""
      className={cx(styles.card, styles.row, className)}
      style={{ '--cc-i': Math.min(index, 12), ...style } as CSSProperties}
      {...props}
    >
      <span className={styles.identity}>
        {avatar ? (
          <span className={styles.avatar}>
            <img src={avatar} alt="" className={styles.avatarImg} />
            <IntegrationLogo
              brand={brand}
              name={app}
              color={color}
              size="xs"
              decorative
              className={styles.corner}
            />
          </span>
        ) : (
          <IntegrationLogo
            brand={brand}
            name={app}
            color={color}
            size="md"
            status={status.dot}
            decorative
          />
        )}
      </span>
      <div className={styles.text}>
        <h3 id={titleId} className={styles.title}>
          <button type="button" className={styles.open} onClick={onOpen}>
            {name}
          </button>
          {handle && <span className={styles.handle}>@{handle}</span>}
        </h3>
        <p id={statusId} className={styles.status} data-tone={status.tone}>
          <span className={styles.app}>{app}</span>
          <span aria-hidden className={styles.sep} />
          {attention || state === 'off' ? (message ?? status.label) : (meta ?? status.label)}
        </p>
      </div>
      <div className={styles.controls}>
        {requests > 0 && (
          <Badge tone="info" variant="soft" className={styles.requests}>
            {requests === 1 ? '1 request' : `${requests} requests`}
          </Badge>
        )}
        {action && (
          <Button
            size="sm"
            variant={attention ? 'solid' : 'soft'}
            onClick={action.onClick}
            loading={action.loading}
            className={styles.action}
          >
            {action.label}
          </Button>
        )}
        {onToggle && (
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            aria-label={enabled ? `Turn off ${app}` : `Turn on ${app}`}
            className={styles.toggle}
          />
        )}
      </div>
    </article>
  );
}
