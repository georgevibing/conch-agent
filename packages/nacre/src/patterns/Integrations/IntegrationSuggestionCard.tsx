import { BellOff, CornerDownLeft, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from './IntegrationLogo';
import styles from './IntegrationSuggestionCard.module.css';

/**
 * Where an offer to connect an app is:
 * `suggested` → `connecting` (signing in) → `connected` (ask again);
 * `dismissed` (“Not now”) leaves; `muted` (“Don’t suggest”) is one quiet line with Undo.
 */
export type IntegrationSuggestionState =
  'suggested' | 'connecting' | 'connected' | 'dismissed' | 'muted';

export interface IntegrationSuggestionCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The app: “Linear”. */
  name: string;
  /** Catalog id, for the bundled logo. */
  brand?: string;
  color?: string;
  /** What it would let the assistant do, as the catalog says it: “Find, create and update issues.” */
  description: string;
  /** What the assistant is called. */
  assistant?: string;
  /** Connected through another app (“Zapier”) because this provider can't reach it by itself. */
  via?: string;
  state: IntegrationSuggestionState;
  onConnect?: () => void;
  onNotNow?: () => void;
  onMute?: () => void;
  onUnmute?: () => void;
  /**
   * Send the question again, now that it's connected. Leave it out when that
   * can't happen (it was asked again already, or a reply is being written).
   */
  onAskAgain?: () => void;
  /** A dismissed card has finished leaving. */
  onGone?: () => void;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** How long a dismissed card takes to fold away (the soft spring, with a little slack). */
const LEAVE_MS = 650;

/**
 * Offered in a chat when a message is about an app that isn't connected: one
 * small, quiet card under the reply, with one obvious button. It never
 * interrupts, and every way out is right there — “Not now” for this chat,
 * “Don’t suggest” for good (with Undo). Once connected it settles into a
 * confirmation that offers to ask the question again.
 */
export function IntegrationSuggestionCard({
  name,
  brand,
  color,
  description,
  assistant = 'Conch',
  via,
  state,
  onConnect,
  onNotNow,
  onMute,
  onUnmute,
  onAskAgain,
  onGone,
  className,
  ...props
}: IntegrationSuggestionCardProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(state);

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

  if (state === 'muted') {
    return (
      <div ref={root} role="status" className={cx(styles.muted, className)} {...props}>
        <BellOff aria-hidden className={styles.mutedIcon} />
        <span className={styles.mutedText}>
          {assistant} won’t suggest {name} again.
        </span>
        {onUnmute && (
          <Button size="sm" variant="ghost" leadingIcon={<Undo2 />} onClick={onUnmute} data-primary>
            Undo
          </Button>
        )}
      </div>
    );
  }

  const app = via ?? name;
  const title =
    state === 'connected'
      ? `${app} is connected`
      : state === 'connecting'
        ? `Connecting ${app}…`
        : `${name} isn’t connected yet`;
  const message =
    state === 'connected'
      ? via
        ? `Turn on the ${name} actions you want in ${via}, then ask again.`
        : onAskAgain
          ? `Ask again and ${assistant} will use it.`
          : `${assistant} can use it from now on.`
      : state === 'connecting'
        ? 'Finish signing in, and it’s ready to use here.'
        : via
          ? `${assistant} can reach ${name} through ${via}, with any model.`
          : `Connect it and ${assistant} can ${lowerFirst(description)}`;
  const leaving = state === 'dismissed';

  return (
    <div
      ref={root}
      className={cx(styles.shell, className)}
      data-state={state}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      {...props}
    >
      <div role="group" aria-labelledby={titleId} className={styles.card} data-state={state}>
        <IntegrationLogo
          brand={brand}
          name={name}
          color={color}
          size="sm"
          status={state === 'connected' ? 'ok' : state === 'connecting' ? 'connecting' : undefined}
          decorative
          className={styles.logo}
        />
        <div className={styles.body}>
          <div className={styles.text} aria-live="polite">
            <p id={titleId} className={styles.title}>
              {title}
            </p>
            <p className={styles.message}>{message}</p>
          </div>
          {state === 'suggested' && (
            <div className={styles.actions}>
              {onConnect && (
                <Button size="sm" variant="soft" onClick={onConnect} data-primary>
                  Connect {app}
                </Button>
              )}
              {onNotNow && (
                <Button size="sm" variant="ghost" onClick={onNotNow}>
                  Not now
                </Button>
              )}
              {onMute && (
                <Button size="sm" variant="ghost" onClick={onMute} className={styles.mute}>
                  Don’t suggest {name}
                </Button>
              )}
            </div>
          )}
          {state === 'connecting' && onConnect && (
            <div className={styles.actions}>
              <Button size="sm" variant="surface" onClick={onConnect} data-primary>
                Continue
              </Button>
            </div>
          )}
          {state === 'connected' && onAskAgain && (
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="soft"
                leadingIcon={<CornerDownLeft />}
                onClick={onAskAgain}
                data-primary
              >
                Ask again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
