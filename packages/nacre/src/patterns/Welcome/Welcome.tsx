import { ArrowRight, Check } from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { StreamingText } from '../StreamingText';
import styles from './Welcome.module.css';

// ── The stage ──────────────────────────────────────────────────────────────

export interface WelcomeStageProps extends ComponentProps<'section'> {
  /** Which way the person is going: the next stage rises from below, the one before from above. */
  direction?: 'forward' | 'back';
}

/**
 * One moment of the welcome, centred. Give it a `key` per step: each new stage
 * surfaces, and its `WelcomeRise` children follow one after another, so a
 * screen arrives like a sentence being said rather than a page being drawn.
 */
export function WelcomeStage({
  direction = 'forward',
  className,
  children,
  ...props
}: WelcomeStageProps) {
  return (
    <section data-direction={direction} className={cx(styles.stage, className)} {...props}>
      {children}
    </section>
  );
}

export interface WelcomeRiseProps extends ComponentProps<'div'> {
  /** Its place in the sentence: each one rises a beat after the one before. */
  order?: number;
}

/** A line of a stage that rises a beat after the one before it. */
export function WelcomeRise({ order = 0, className, style, ...props }: WelcomeRiseProps) {
  return (
    <div
      className={cx(styles.rise, className)}
      style={{ '--wr-i': order, ...style } as CSSProperties}
      {...props}
    />
  );
}

// ── The backdrop ───────────────────────────────────────────────────────────

export interface WelcomeBackdropProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How far along the welcome is, 0–1: the dawn drifts and warms as it goes. */
  progress?: number;
}

/**
 * A slow pearl dawn behind the welcome. It drifts as the person moves through,
 * so the screen changes the way light does, not the way slides do. Opaque
 * colour, no blur of what's in front (Nacre is solid); still under reduced motion.
 */
export function WelcomeBackdrop({
  progress = 0,
  className,
  style,
  ...props
}: WelcomeBackdropProps) {
  const p = Math.min(1, Math.max(0, progress));
  return (
    <div
      aria-hidden
      className={cx(styles.backdrop, className)}
      style={{ '--wb-p': p, ...style } as CSSProperties}
      {...props}
    />
  );
}

// ── Where you are ──────────────────────────────────────────────────────────

export interface WelcomeStepsProps extends Omit<ComponentProps<'ol'>, 'children'> {
  count: number;
  /** 0-based. */
  current: number;
}

/** Small pearls for the steps: the current one stretches, the ones done stay lit. */
export function WelcomeSteps({ count, current, className, ...props }: WelcomeStepsProps) {
  return (
    <ol
      aria-label={`Step ${current + 1} of ${count}`}
      className={cx(styles.steps, className)}
      {...props}
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} data-state={i < current ? 'done' : i === current ? 'current' : 'todo'} />
      ))}
    </ol>
  );
}

// ── A name, typed large ────────────────────────────────────────────────────

export interface WelcomeNameProps extends Omit<ComponentProps<'input'>, 'size'> {
  /** What the field is called for screen readers (it has no visible label: the heading asks). */
  label: string;
}

/** The smallest a long name shrinks to, as a share of the field's own size. */
const NAME_MIN_FIT = 0.45;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

/**
 * One big line to type into, set like the heading above it: no box, a soft
 * glowing rule that brightens while you type. For the one question a screen asks.
 * It is display-size on a phone too (never under 16px, so iOS doesn't zoom), and a
 * name too long for the line shrinks to fit it rather than scrolling out of sight.
 */
export function WelcomeName({ label, className, ref, onInput, ...props }: WelcomeNameProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      input.current = el;
      assignRef(ref, el);
    },
    [ref],
  );

  // Measure at full size, then shrink by however much the words overrun the line.
  const fit = useCallback(() => {
    const el = input.current;
    if (!el) return;
    el.style.removeProperty('--wn-fit');
    const { scrollWidth, clientWidth } = el;
    if (clientWidth > 0 && scrollWidth > clientWidth + 1) {
      const scale = Math.max(NAME_MIN_FIT, (clientWidth / scrollWidth) * 0.98);
      el.style.setProperty('--wn-fit', scale.toFixed(3));
    }
  }, []);

  useLayoutEffect(fit, [fit, props.value, props.defaultValue, props.placeholder]);

  useEffect(() => {
    const el = input.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <div className={cx(styles.name, className)}>
      <input
        ref={setRef}
        aria-label={label}
        autoComplete="given-name"
        autoCapitalize="words"
        spellCheck={false}
        data-nc-large-type=""
        className={styles.nameInput}
        onInput={(e) => {
          fit();
          onInput?.(e);
        }}
        {...props}
      />
      <span aria-hidden className={styles.nameRule} />
    </div>
  );
}

// ── Choices, tapped ────────────────────────────────────────────────────────

export interface WelcomeChoice {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface WelcomeChoicesProps extends Omit<
  ComponentProps<'div'>,
  'children' | 'onChange' | 'defaultValue' | 'dir'
> {
  choices: readonly WelcomeChoice[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** What the group is called for screen readers. */
  label: string;
}

/**
 * Several of a few, tapped instead of typed: chips that rise in one after
 * another, light up with a check that pops in when chosen, and go back to
 * quiet when tapped again. One tab stop; arrow keys move, Space toggles.
 */
export function WelcomeChoices({
  choices,
  value,
  onChange,
  label,
  className,
  ...props
}: WelcomeChoicesProps) {
  return (
    <ToggleGroup.Root
      type="multiple"
      role="group"
      aria-label={label}
      value={[...value]}
      onValueChange={onChange}
      loop
      className={cx(styles.choices, className)}
      {...props}
    >
      {choices.map((choice, i) => (
        <ToggleGroup.Item
          key={choice.value}
          value={choice.value}
          data-lustre
          className={styles.choice}
          style={{ '--wc-i': i } as CSSProperties}
        >
          {choice.icon && (
            <span aria-hidden className={styles.choiceIcon}>
              {choice.icon}
            </span>
          )}
          <span>{choice.label}</span>
          <span aria-hidden className={styles.choiceCheck}>
            <Check />
          </span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

// ── A voice, heard ─────────────────────────────────────────────────────────

export interface WelcomeVoiceProps extends Omit<ComponentProps<'figure'>, 'children'> {
  /** Who's speaking: the assistant's name. */
  from: string;
  /** What it says in the voice chosen. A new line is said afresh. */
  text: string;
  /** Its face beside its name (an `AgentAvatar`); Conch's pearl when there's none. */
  face?: ReactNode;
}

/**
 * How the assistant would sound, said by it: a message that writes itself out
 * again each time the voice changes, so choosing one is hearing it.
 */
export function WelcomeVoice({ from, text, face, className, ...props }: WelcomeVoiceProps) {
  return (
    <figure className={cx(styles.voice, className)} {...props}>
      <figcaption className={styles.voiceFrom}>
        {face ?? <Pearl size="xs" state="idle" label={null} />}
        {from}
      </figcaption>
      <blockquote className={styles.voiceText} aria-live="polite">
        <StreamingText key={text} text={text} />
      </blockquote>
    </figure>
  );
}

// ── Apps, picked ───────────────────────────────────────────────────────────

export interface WelcomeApp {
  id: string;
  name: string;
  /** The brand's colour (hex), for the tile. */
  color?: string;
  /** Connected already: the tile wears a check. */
  connected?: boolean;
}

export interface WelcomeAppsProps extends Omit<ComponentProps<'ul'>, 'children'> {
  apps: readonly WelcomeApp[];
  /** Pressed: open its connection. */
  onPick: (id: string) => void;
  /** What the list is called for screen readers. */
  label: string;
}

/**
 * The apps a person lives in, as tiles to press: each opens its own connection,
 * and comes back wearing a check. They rise in a wave, row by row.
 */
export function WelcomeApps({ apps, onPick, label, className, ...props }: WelcomeAppsProps) {
  const id = useId();
  return (
    <ul aria-label={label} className={cx(styles.apps, className)} {...props}>
      {apps.map((app, i) => (
        <li key={app.id} style={{ '--wa-i': i } as CSSProperties} className={styles.appItem}>
          <button
            type="button"
            data-lustre
            data-connected={app.connected || undefined}
            className={styles.app}
            aria-describedby={app.connected ? `${id}-connected` : undefined}
            onClick={() => onPick(app.id)}
          >
            <IntegrationLogo
              brand={app.id}
              name={app.name}
              color={app.color}
              size="lg"
              decorative
            />
            <span className={styles.appName}>{app.name}</span>
            {app.connected && (
              <span aria-hidden className={styles.appCheck}>
                <Check />
              </span>
            )}
          </button>
        </li>
      ))}
      <span id={`${id}-connected`} hidden>
        Connected
      </span>
    </ul>
  );
}

// ── Somewhere to start ─────────────────────────────────────────────────────

export interface WelcomeStartersProps extends Omit<ComponentProps<'ul'>, 'children'> {
  /** Exactly the words that go in the composer. */
  starters: readonly string[];
  onPick: (text: string) => void;
  /** What the list is called for screen readers. */
  label: string;
}

/**
 * Things to ask first, said in the person's words: large, calm rows that rise
 * one after another, each with an arrow that leans forward under the pointer.
 */
export function WelcomeStarters({
  starters,
  onPick,
  label,
  className,
  ...props
}: WelcomeStartersProps) {
  return (
    <ul aria-label={label} className={cx(styles.starters, className)} {...props}>
      {starters.map((text, i) => (
        <li key={text} className={styles.starterItem} style={{ '--ws-i': i } as CSSProperties}>
          <button type="button" data-lustre className={styles.starter} onClick={() => onPick(text)}>
            <span className={styles.starterText}>{text}</span>
            <span aria-hidden className={styles.starterArrow}>
              <ArrowRight />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
