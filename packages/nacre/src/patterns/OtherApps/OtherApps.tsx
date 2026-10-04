import { Globe, MessageSquare, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './OtherApps.module.css';

// ── Apps Conch connects in one press ─────────────────────────────────────

export interface OtherAppTarget {
  /** Its id: `claude-desktop`. */
  app: string;
  name: string;
  /** `connected`: its settings start Conch. `ready`: on this computer. `missing`: not here. */
  state: 'connected' | 'ready' | 'missing';
  /** What it may use, when connected: "Your memory, Gmail and the browser". */
  detail?: ReactNode;
  brand?: string;
  color?: string;
}

export interface OtherAppTargetsProps extends Omit<ComponentProps<'ul'>, 'children'> {
  targets: OtherAppTarget[];
  onConnect?: (target: OtherAppTarget) => void;
  /** Change what a connected one may use. */
  onManage?: (target: OtherAppTarget) => void;
}

const STATE_WORDS: Record<OtherAppTarget['state'], string> = {
  connected: 'Connected',
  ready: 'On this computer',
  missing: 'Not on this computer',
};

/**
 * Settings → Other apps: the apps Conch can add itself to in one press
 * (Claude Desktop, Cursor, VS Code), each saying in words whether it's
 * connected, here to connect, or not on this computer.
 */
export function OtherAppTargets({
  targets,
  onConnect,
  onManage,
  className,
  ...props
}: OtherAppTargetsProps) {
  return (
    <ul aria-label="Apps Conch can connect" className={cx(styles.list, className)} {...props}>
      {targets.map((target) => (
        <li key={target.app} className={styles.row} data-state={target.state}>
          <IntegrationLogo
            brand={target.brand}
            name={target.name}
            color={target.color}
            size="md"
            decorative
          />
          <div className={styles.body}>
            <p className={styles.name}>{target.name}</p>
            <p className={styles.meta}>
              {STATE_WORDS[target.state]}
              {target.state === 'connected' && target.detail && <> · {target.detail}</>}
            </p>
          </div>
          <div className={styles.actions}>
            {target.state === 'ready' && onConnect && (
              <Button size="sm" onClick={() => onConnect(target)}>
                Connect
              </Button>
            )}
            {target.state === 'connected' && onManage && (
              <Button
                size="sm"
                variant="surface"
                leadingIcon={<SlidersHorizontal />}
                onClick={() => onManage(target)}
                aria-label={`Change what ${target.name} may use`}
              >
                Change
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── What an app may use ──────────────────────────────────────────────────

export interface McpScopeChoice {
  scope: string;
  title: string;
  detail?: string;
  /** `conch`: Conch's own (memory, skills, the browser). `app`: one of your apps. */
  kind: 'conch' | 'app';
  brand?: string;
  color?: string;
}

export interface McpScopePickerProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  choices: McpScopeChoice[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * What a paired app may use, as boxes to tick: Conch's own abilities first,
 * then each of your apps by its logo. Nothing is ticked for it: it gets
 * exactly what's ticked here.
 */
export function McpScopePicker({
  choices,
  value,
  onChange,
  disabled,
  className,
  ...props
}: McpScopePickerProps) {
  const conchId = useId();
  const appsId = useId();
  const chosen = new Set(value);
  const toggle = (scope: string, on: boolean) =>
    onChange(on ? [...value.filter((s) => s !== scope), scope] : value.filter((s) => s !== scope));
  const group = (kind: McpScopeChoice['kind']) => choices.filter((c) => c.kind === kind);
  const box = (choice: McpScopeChoice) => (
    <li key={choice.scope} className={styles.choice}>
      <Checkbox
        checked={chosen.has(choice.scope)}
        onCheckedChange={(on) => toggle(choice.scope, on === true)}
        disabled={disabled}
        label={
          choice.kind === 'app' ? (
            <span className={styles.appChoice}>
              <IntegrationLogo
                brand={choice.brand}
                name={choice.title}
                color={choice.color}
                size="xs"
                decorative
              />
              {choice.title}
            </span>
          ) : (
            choice.title
          )
        }
        description={choice.detail}
      />
    </li>
  );
  const apps = group('app');
  return (
    <div className={cx(styles.picker, className)} {...props}>
      <div role="group" aria-labelledby={conchId}>
        <p id={conchId} className={styles.groupTitle}>
          In Conch
        </p>
        <ul className={styles.choices}>{group('conch').map(box)}</ul>
      </div>
      <div role="group" aria-labelledby={appsId}>
        <p id={appsId} className={styles.groupTitle}>
          Your apps
        </p>
        {apps.length ? (
          <ul className={styles.choices}>{apps.map(box)}</ul>
        ) : (
          <p className={styles.meta}>No apps connected in Conch yet. Connect them in Apps.</p>
        )}
      </div>
    </div>
  );
}

// ── Apps paired with Conch ───────────────────────────────────────────────

export interface PairedAppItem {
  id: string;
  name: string;
  brand?: string;
  color?: string;
  /** "Your memory, Gmail and the browser". */
  uses: ReactNode;
  /** "Paired 3 Oct · used 2 minutes ago". */
  meta: ReactNode;
  /** It may come in through your own address. */
  remote?: boolean;
}

export interface PairedAppListProps extends Omit<ComponentProps<'div'>, 'children'> {
  apps: PairedAppItem[];
  /** "See what it did": its own chat in Conch. */
  onOpen?: (app: PairedAppItem) => void;
  /** Change what it may use. */
  onEdit?: (app: PairedAppItem) => void;
  onRemove?: (app: PairedAppItem) => void;
  /** The app being removed right now. */
  busy?: string;
}

/**
 * The apps paired with Conch: what each may use, when it last did, and the
 * three things you can do — see what it did, change what it may use, or
 * remove it (which ends what it has open at once).
 */
export function PairedAppList({
  apps,
  onOpen,
  onEdit,
  onRemove,
  busy,
  className,
  ...props
}: PairedAppListProps) {
  if (!apps.length)
    return (
      <div className={cx(styles.empty, className)} {...props}>
        <p className={styles.meta}>
          No other apps use Conch yet. Connect one above, and it can use what you choose.
        </p>
      </div>
    );
  return (
    <div className={className} {...props}>
      <ul aria-label="Apps paired with Conch" className={styles.list}>
        {apps.map((app) => (
          <li key={app.id} className={styles.row} data-busy={busy === app.id ? '' : undefined}>
            <IntegrationLogo
              brand={app.brand}
              name={app.name}
              color={app.color}
              size="md"
              decorative
            />
            <div className={styles.body}>
              <p className={styles.name}>
                {app.name}
                {app.remote && (
                  <Badge size="sm" tone="warning" icon={<Globe />}>
                    From your address
                  </Badge>
                )}
              </p>
              <p className={styles.uses}>{app.uses}</p>
              <p className={styles.meta}>{app.meta}</p>
            </div>
            <div className={styles.actions}>
              {onOpen && (
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<MessageSquare />}
                  onClick={() => onOpen(app)}
                  aria-label={`See what ${app.name} did`}
                >
                  What it did
                </Button>
              )}
              {onEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<SlidersHorizontal />}
                  onClick={() => onEdit(app)}
                  aria-label={`Change what ${app.name} may use`}
                >
                  Change
                </Button>
              )}
              {onRemove && (
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<Trash2 />}
                  loading={busy === app.id}
                  onClick={() => onRemove(app)}
                  aria-label={`Remove ${app.name}`}
                >
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
