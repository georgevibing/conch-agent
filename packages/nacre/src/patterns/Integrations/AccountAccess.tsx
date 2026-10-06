import { useId, type ComponentProps, type ReactNode } from 'react';

import { Avatar } from '../../components/Avatar';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import styles from './AccountAccess.module.css';
import { IntegrationLogo } from './IntegrationLogo';

/** How far an assistant may go in one service of one account. */
export type AccessLevel = 'off' | 'read' | 'write';

export interface AccessService {
  id: string;
  /** "Gmail", "Google Calendar". */
  name: string;
  /** Catalog id, for its logo. */
  brand?: string;
  color?: string;
  level: AccessLevel;
  /** What the current level means, in a few words; one sentence per level. */
  describe?: Partial<Record<AccessLevel, ReactNode>>;
  /** A quiet line under it: what choosing more involves ("Read & write asks Google once"). */
  note?: ReactNode;
  /** Can't be used this way at all: why, and the one button that changes that. */
  unavailable?: { reason: ReactNode; action?: { label: string; onClick: () => void } };
  /** Being changed: the control waits, with a spinner beside it. */
  busy?: boolean;
  /** The service whose page this is: shown first-class. */
  current?: boolean;
}

export interface AccessLevelsProps extends Omit<ComponentProps<'ul'>, 'children' | 'onChange'> {
  /** Names the list: "What Conch may do with ada@example.com". */
  label: string;
  services: AccessService[];
  onChange?: (serviceId: string, level: AccessLevel) => void;
  /** The words for each level. */
  levelLabels?: Record<AccessLevel, string>;
  disabled?: boolean;
}

const LEVELS: AccessLevel[] = ['off', 'read', 'write'];
const LABELS: Record<AccessLevel, string> = { off: 'Off', read: 'Read', write: 'Read & write' };

/**
 * One row per service, each with Off · Read · Read & write: what an
 * assistant may do there, said plainly under it. A service that can't be
 * reached this way says why, with the one button that fixes it, instead of
 * a control that would only pretend.
 */
export function AccessLevels({
  label,
  services,
  onChange,
  levelLabels = LABELS,
  disabled,
  className,
  ...props
}: AccessLevelsProps) {
  return (
    <ul aria-label={label} className={cx(styles.levels, className)} {...props}>
      {services.map((service) => (
        <LevelRow
          key={service.id}
          service={service}
          labels={levelLabels}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </ul>
  );
}

function LevelRow({
  service,
  labels,
  disabled,
  onChange,
}: {
  service: AccessService;
  labels: Record<AccessLevel, string>;
  disabled?: boolean;
  onChange?: (serviceId: string, level: AccessLevel) => void;
}) {
  const nameId = useId();
  const aboutId = useId();
  const { unavailable, busy } = service;
  const about = unavailable ? unavailable.reason : service.describe?.[service.level];
  return (
    <li
      className={styles.row}
      data-level={unavailable ? undefined : service.level}
      data-current={service.current || undefined}
      aria-busy={busy || undefined}
    >
      <IntegrationLogo
        brand={service.brand}
        name={service.name}
        color={service.color}
        size="sm"
        decorative
      />
      <div className={styles.about}>
        <p id={nameId} className={styles.name}>
          {service.name}
        </p>
        {about && (
          <p id={aboutId} className={styles.describe}>
            {about}
          </p>
        )}
        {service.note && !unavailable && <p className={styles.note}>{service.note}</p>}
      </div>
      <div className={styles.control}>
        {busy && <Spinner size="xs" label="Saving" />}
        {unavailable ? (
          unavailable.action && (
            <Button
              size="sm"
              variant="surface"
              disabled={disabled}
              onClick={unavailable.action.onClick}
              aria-describedby={aboutId}
            >
              {unavailable.action.label}
            </Button>
          )
        ) : (
          <SegmentedControl
            size="sm"
            value={service.level}
            aria-labelledby={nameId}
            aria-describedby={about ? aboutId : undefined}
            disabled={disabled || busy}
            onValueChange={(next) => onChange?.(service.id, next as AccessLevel)}
          >
            {LEVELS.map((level) => (
              <SegmentedControl.Item key={level} value={level}>
                {labels[level]}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        )}
      </div>
    </li>
  );
}

export type AccountState = 'ready' | 'needs-auth' | 'unavailable' | 'checking';

const STATE: Record<AccountState, { label: string; tone: BadgeTone }> = {
  ready: { label: 'Working', tone: 'success' },
  'needs-auth': { label: 'Needs you', tone: 'warning' },
  unavailable: { label: 'Out of reach', tone: 'danger' },
  checking: { label: 'Checking…', tone: 'info' },
};

export interface AccountAccessCardProps extends Omit<ComponentProps<'article'>, 'children'> {
  email: string;
  /** A name, when it isn't just the address. */
  name?: string;
  /** How it's connected, in two or three words: "Google sign-in", "App password". */
  method: ReactNode;
  state: AccountState;
  /** What's wrong, in one sentence, when it isn't working. */
  message?: ReactNode;
  services: AccessService[];
  onLevelChange?: (serviceId: string, level: AccessLevel) => void;
  levelLabels?: Record<AccessLevel, string>;
  /** The one thing that fixes it, right under the message (a field, a sign-in). */
  fix?: ReactNode;
  /** A step under the services, while one is under way (asking Google for more). */
  panel?: ReactNode;
  /** Quiet actions at the foot: Check now, Remove. */
  actions?: ReactNode;
  /** Nothing can be changed right now. */
  disabled?: boolean;
}

/**
 * One connected account and what an assistant may do with it, service by
 * service. Who it is and how it's signed in at the top, with its state in
 * words; when it needs the person, the sentence and the one fix come next;
 * then a row per service with Off · Read · Read & write.
 */
export function AccountAccessCard({
  email,
  name,
  method,
  state,
  message,
  services,
  onLevelChange,
  levelLabels,
  fix,
  panel,
  actions,
  disabled,
  className,
  ...props
}: AccountAccessCardProps) {
  const titleId = useId();
  const status = STATE[state];
  return (
    <article
      aria-labelledby={titleId}
      data-state={state}
      className={cx(styles.card, className)}
      {...props}
    >
      <header className={styles.head}>
        <Avatar name={name && name !== email ? name : email} size="md" aria-hidden />
        <div className={styles.who}>
          <h3 id={titleId} className={styles.email}>
            {email}
          </h3>
          <p className={styles.meta}>
            {method}
            {name && name !== email ? ` · ${name}` : ''}
          </p>
        </div>
        <Badge tone={status.tone} dot={state === 'checking' ? 'pulse' : true} size="sm">
          {status.label}
        </Badge>
      </header>
      {(message || fix) && state !== 'ready' && (
        <div className={styles.problem}>
          {message && <p className={styles.message}>{message}</p>}
          {fix}
        </div>
      )}
      <AccessLevels
        label={`What it may do with ${email}`}
        services={services}
        onChange={onLevelChange}
        levelLabels={levelLabels}
        disabled={disabled}
      />
      {panel && <div className={styles.panel}>{panel}</div>}
      {actions && <footer className={styles.actions}>{actions}</footer>}
    </article>
  );
}
