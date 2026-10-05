import { BellOff, Check, CornerDownLeft, MoreHorizontal, Undo2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { DropdownMenu } from '../../components/DropdownMenu';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { AppIcon, type AppIconLook } from '../ConchApps/AppIcon';
import { MarketTrustBadge } from '../Discover/MarketTrustBadge';
import { fromWords, roughly, type MarketTrustLevel } from '../Discover/types';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { SkillIcon } from '../Skills/SkillIcon';
import { type SkillCapabilityName, SkillPermissionList } from '../Skills/SkillPermissionList';
import styles from './OfferCard.module.css';

/**
 * Where an offer is (ADR 0060):
 * - `suggested`: the card, with one button;
 * - `connecting`: an app is signing in;
 * - `review`: a skill shows what it may do before it's turned on;
 * - `ready`: it's on, and the chat can carry on (it was turned on elsewhere);
 * - `accepted`: folded to a quiet line while the chat carries on;
 * - `dismissed`: “Not now”, folding away;
 * - `muted`: “Don’t suggest”, one line with Undo;
 * - `expired`: a newer message overtook it, a small line.
 */
export type OfferCardState =
  'suggested' | 'connecting' | 'review' | 'ready' | 'accepted' | 'dismissed' | 'muted' | 'expired';

/** What a skill may do, in ADR 0031's words. */
export interface OfferPermissions {
  capabilities: SkillCapabilityName[];
  words: string[];
  declared: boolean;
}

export interface OfferCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** An app to connect, a skill of yours to turn on, or one people share to read and add (ADR 0074). */
  kind: 'app' | 'skill' | 'market';
  /** “Google Calendar”, or a skill's title. */
  name: string;
  /** An app's catalog id (its logo), or a skill's name (its tile's colour). */
  brand?: string;
  /** An app's brand colour. */
  color?: string;
  /**
   * A Conch app you have that's switched off (ADR 0061): its own icon, and
   * **Turn on** instead of Connect.
   */
  app?: AppIconLook;
  /** What it lets the assistant do: the catalog's or the skill's own line. */
  description: string;
  /** Why it helps with this request, in the assistant's words. */
  why?: string;
  /** For a skill: `off` turns on; `manual` waits to be asked, and can be used once. */
  skillMode?: 'off' | 'manual';
  /** What the assistant is called. */
  assistant?: string;
  state: OfferCardState;
  /** For a skill people share: where it's from and what that place says about it. */
  market?: { sourceLabel: string; publisher: string; trust: MarketTrustLevel; installs?: number };
  /** The words of “Don’t suggest …” when they aren't the name's: “Don’t suggest skills from Discover”. */
  muteLabel?: string;
  /** A skill's permissions, shown in `review`. */
  permissions?: OfferPermissions;
  /** How it was taken, for the folded line: turned on, or used once. */
  taken?: 'on' | 'once';
  /** Waiting on the gateway: the buttons hold still. */
  busy?: boolean;
  /** The one button: **Connect** (or **Continue** while signing in), or a skill's **Turn on** / **Use it**, which opens `review`. */
  onTake?: () => void;
  /** In `review`: **Turn on** an Off skill, or **Always** for one that waits to be asked. */
  onTurnOn?: () => void;
  /** In `review`: **Use it**, once, for a skill that waits to be asked. */
  onUseOnce?: () => void;
  /** In `ready`: **Carry on**. */
  onCarryOn?: () => void;
  onNotNow?: () => void;
  onMute?: () => void;
  onUnmute?: () => void;
  /** A dismissed card has finished folding away. */
  onGone?: () => void;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** How long a dismissed card takes to fold away (the soft spring, with a little slack). */
const LEAVE_MS = 650;

const FOLDED = new Set<OfferCardState>(['accepted', 'muted', 'expired']);

/**
 * An offer to turn on the one thing a request is missing (ADR 0060), under
 * the reply that needed it: an app to connect, or a skill that's off. One
 * small, calm card with one obvious button; every way out is right there.
 * Taken, it folds into a quiet line (“Connected Google Calendar · carrying
 * on”) and the chat carries on by itself.
 */
export function OfferCard({
  kind,
  name,
  brand,
  color,
  app,
  description,
  why,
  skillMode = 'off',
  assistant = 'Conch',
  state,
  market,
  muteLabel,
  permissions,
  taken,
  busy,
  onTake,
  onTurnOn,
  onUseOnce,
  onCarryOn,
  onNotNow,
  onMute,
  onUnmute,
  onGone,
  className,
  ref,
  ...props
}: OfferCardProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const shown = useRef(state);
  /** Taken while on screen (not read from history): the check draws itself. */
  const [before, setBefore] = useState(state);
  const [justTaken, setJustTaken] = useState(false);
  if (before !== state) {
    setBefore(state);
    setJustTaken(state === 'accepted');
  }

  // Focus follows the card when a change takes away the button it was on.
  useEffect(() => {
    if (shown.current === state) return;
    shown.current = state;
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    root.current?.querySelector<HTMLElement>('[data-primary]')?.focus();
  }, [state]);

  useEffect(() => {
    if (state !== 'dismissed' || !onGone) return;
    const timer = setTimeout(onGone, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [state, onGone]);

  const skill = kind === 'skill';
  const shared = kind === 'market';
  const manual = skill && skillMode === 'manual';
  const folded = FOLDED.has(state);
  const leaving = state === 'dismissed';

  const mark = (size: 'xs' | 'sm') =>
    app && !skill && !shared ? (
      <AppIcon glyph={app.glyph} color={app.color} src={app.src} size={size} />
    ) : skill || shared ? (
      <SkillIcon
        name={brand ?? name}
        title={name}
        size={size}
        className={size === 'sm' ? styles.skillMark : undefined}
      />
    ) : (
      <IntegrationLogo brand={brand} name={name} color={color} size={size} decorative />
    );

  const title =
    state === 'connecting'
      ? `Connecting ${name}…`
      : state === 'ready'
        ? skill
          ? `“${name}” is on`
          : app
            ? `${name} is on`
            : `${name} is connected`
        : shared
          ? `A skill for this: “${name}”`
          : skill
            ? manual
              ? `“${name}” waits to be asked`
              : `The “${name}” skill is off`
            : app
              ? `${name} is off`
              : `${name} isn’t connected yet`;
  const message =
    state === 'connecting'
      ? 'Finish signing in, and the chat carries on by itself.'
      : state === 'ready'
        ? 'Carry on with what you asked?'
        : (why ??
          (shared
            ? `Add it and ${assistant} can ${lowerFirst(description)}`
            : skill || app
              ? `${manual ? 'Use it' : 'Turn it on'} and ${assistant} can ${lowerFirst(description)}`
              : `Connect it and ${assistant} can ${lowerFirst(description)}`));

  const takeLabel = shared
    ? 'Look at it'
    : skill
      ? manual
        ? 'Use it'
        : 'Turn on'
      : app
        ? 'Turn on'
        : 'Connect';

  const more = onMute && (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="More" size="sm" className={styles.more}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item icon={<BellOff />} onSelect={onMute}>
          {muteLabel ?? `Don’t suggest ${name}`}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );

  let actions: ReactNode = null;
  if (state === 'suggested')
    actions = (
      <>
        {onTake && (
          <Button
            size="sm"
            variant="soft"
            onClick={onTake}
            loading={busy}
            aria-label={`${takeLabel} ${name}`}
            data-primary
          >
            {takeLabel}
          </Button>
        )}
        {onNotNow && (
          <Button size="sm" variant="ghost" onClick={onNotNow} disabled={busy}>
            Not now
          </Button>
        )}
      </>
    );
  else if (state === 'connecting' && onTake)
    actions = (
      <Button size="sm" variant="surface" onClick={onTake} data-primary>
        Continue
      </Button>
    );
  else if (state === 'review')
    actions = (
      <>
        {manual
          ? onUseOnce && (
              <Button
                size="sm"
                variant="soft"
                onClick={onUseOnce}
                loading={busy}
                aria-label={`Use ${name} for this`}
                data-primary
              >
                Use it
              </Button>
            )
          : onTurnOn && (
              <Button
                size="sm"
                variant="soft"
                onClick={onTurnOn}
                loading={busy}
                aria-label={`Turn on ${name}`}
                data-primary
              >
                Turn on
              </Button>
            )}
        {manual && onTurnOn && (
          <Button
            size="sm"
            variant="surface"
            onClick={onTurnOn}
            disabled={busy}
            aria-label={`Always use ${name} when it fits`}
          >
            Always
          </Button>
        )}
        {onNotNow && (
          <Button size="sm" variant="ghost" onClick={onNotNow} disabled={busy}>
            Not now
          </Button>
        )}
      </>
    );
  else if (state === 'ready' && onCarryOn)
    actions = (
      <Button
        size="sm"
        variant="soft"
        leadingIcon={<CornerDownLeft />}
        onClick={onCarryOn}
        loading={busy}
        data-primary
      >
        Carry on
      </Button>
    );

  const line =
    state === 'accepted' ? (
      <div
        role="status"
        className={styles.line}
        data-state={state}
        data-just={justTaken || undefined}
      >
        <span className={styles.lineMark}>
          {mark('xs')}
          <span className={styles.tick} aria-hidden>
            <Check />
          </span>
        </span>
        <span className={styles.lineText}>
          {shared
            ? 'Added '
            : skill
              ? taken === 'once'
                ? 'Using '
                : 'Turned on '
              : app
                ? 'Turned on '
                : 'Connected '}
          <strong className={styles.lineName}>{name}</strong>
          <span className={styles.dot} aria-hidden>
            ·
          </span>
          <span className={styles.carrying}>carrying on</span>
        </span>
      </div>
    ) : state === 'expired' ? (
      <div role="note" className={styles.line} data-state={state}>
        <span className={styles.lineMark}>{mark('xs')}</span>
        <span className={styles.lineText}>
          {skill || shared ? 'Offered the ' : app ? 'Offered to turn on ' : 'Offered to connect '}
          <strong className={styles.lineName}>{name}</strong>
          {skill || shared ? ' skill' : ''}
        </span>
      </div>
    ) : state === 'muted' ? (
      <div role="status" className={styles.muted}>
        <BellOff aria-hidden className={styles.mutedIcon} />
        <span className={styles.mutedText}>
          {shared
            ? `${assistant} won’t suggest skills from Discover again.`
            : `${assistant} won’t suggest ${name} again.`}
        </span>
        {onUnmute && (
          <Button size="sm" variant="ghost" leadingIcon={<Undo2 />} onClick={onUnmute} data-primary>
            Undo
          </Button>
        )}
      </div>
    ) : null;

  return (
    <div
      ref={setRoot}
      className={cx(styles.shell, className)}
      data-state={state}
      data-folded={folded || undefined}
      data-kind={kind}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      {...props}
    >
      <div className={styles.cardRow} inert={folded || undefined} aria-hidden={folded || undefined}>
        <div
          role="group"
          aria-labelledby={titleId}
          aria-busy={busy || undefined}
          className={styles.card}
          data-state={state}
          data-lustre
        >
          <span className={styles.mark}>{mark('sm')}</span>
          <div className={styles.body}>
            <div
              className={styles.head}
              data-more={(onMute && (state === 'suggested' || state === 'review')) || undefined}
            >
              <div className={styles.text} aria-live="polite">
                <p id={titleId} className={styles.title}>
                  {title}
                </p>
                <p
                  className={styles.message}
                  data-why={(why && state !== 'connecting') || undefined}
                >
                  {message}
                </p>
                {shared && market && (
                  <p className={styles.from}>
                    <MarketTrustBadge trust={market.trust} />
                    <span>
                      {fromWords(market.sourceLabel, market.publisher)}
                      {market.installs ? ` · ${roughly(market.installs)} people use it` : ''}
                    </span>
                  </p>
                )}
              </div>
            </div>
            {skill && (
              <div className={styles.review} data-open={state === 'review' || undefined}>
                <div
                  className={styles.reviewClip}
                  inert={state !== 'review' || undefined}
                  aria-hidden={state !== 'review' || undefined}
                >
                  {permissions && (
                    <div className={styles.permissions}>
                      <SkillPermissionList
                        variant="compact"
                        capabilities={permissions.capabilities}
                        words={permissions.words}
                        declared={permissions.declared}
                        aria-labelledby={undefined}
                        aria-label={`What ${name} can do`}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            {actions && <div className={styles.actions}>{actions}</div>}
          </div>
          {/* Last in the keyboard's path, though it sits in the corner. */}
          {(state === 'suggested' || state === 'review') && more}
        </div>
      </div>
      <div className={styles.lineRow} aria-hidden={!folded || undefined}>
        <div className={styles.lineClip}>{line}</div>
      </div>
    </div>
  );
}

export interface OfferAlsoTryProps extends Omit<ComponentProps<'div'>, 'children' | 'onSelect'> {
  /** What to try next with what was just turned on: the catalog's examples. Two at most are shown. */
  examples: readonly string[];
  /** Send exactly these words. */
  onPick: (text: string) => void;
}

/**
 * “Also try”: what else the thing just turned on can do, as chips under the
 * reply that carried on. The words on a chip are exactly the words sent.
 */
export function OfferAlsoTry({ examples, onPick, className, ...props }: OfferAlsoTryProps) {
  const shown = examples.slice(0, 2);
  if (!shown.length) return null;
  return (
    <div role="group" aria-label="Also try" className={cx(styles.also, className)} {...props}>
      <span className={styles.alsoLabel} aria-hidden>
        Also try
      </span>
      {shown.map((text) => (
        <button
          key={text}
          type="button"
          className={styles.chip}
          onClick={() => onPick(text)}
          data-lustre
        >
          {text}
        </button>
      ))}
    </div>
  );
}
