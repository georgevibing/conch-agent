import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import styles from './Recipe.module.css';
import { stepIngredients, type RecipeData } from './recipe';
import { IngredientLine, StepWords } from './Parts';
import { TimerTray } from './TimerChips';
import type { KitchenTimer } from './timers';

/** How far a finger travels sideways before it means “next”. */
const SWIPE = 56;

interface Lock {
  release: () => Promise<void>;
  addEventListener?: (e: 'release', f: () => void) => void;
}
type WakeLockNavigator = Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<Lock> } };

/**
 * Keeps the screen on while `on`: hands are floury, nobody wants to tap a
 * dark phone. Asked again when the page comes back (a lock is lost when it's
 * hidden); let go when it's off. Where the browser can't, nothing happens.
 */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    const nav = (typeof navigator === 'undefined' ? undefined : navigator) as
      WakeLockNavigator | undefined;
    if (!on || !nav?.wakeLock) return;
    let lock: Lock | undefined;
    let gone = false;
    const take = () => {
      if (gone || document.visibilityState !== 'visible') return;
      nav.wakeLock
        ?.request('screen')
        .then((l) => {
          if (gone) void l.release().catch(() => undefined);
          else lock = l;
        })
        .catch(() => undefined);
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}

export interface CookModeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: RecipeData;
  /** The card's state key: its timers are this recipe's. */
  recipeKey: string;
  /** How much the amounts are scaled by. */
  factor: number;
  step: number;
  onStepChange: (step: number) => void;
  onTimerDone?: (timer: KitchenTimer) => void;
}

/**
 * Cooking, one step at a time: a sheet that fills the screen, the step in
 * large type, the ingredients it uses under it (scaled), and every timer
 * that's going along the top, a press from its step. Back and Next, the
 * arrow keys or a swipe move between steps; the screen stays on while it's
 * open.
 */
export function CookMode({
  open,
  onOpenChange,
  recipe,
  recipeKey,
  factor,
  step,
  onStepChange,
  onTimerDone,
}: CookModeProps) {
  const count = recipe.steps.length;
  const at = Math.min(Math.max(0, step), Math.max(0, count - 1));
  const current = recipe.steps[at];
  const [dir, setDir] = useState<'next' | 'back' | undefined>();
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const countId = useId();
  const next = useRef<HTMLButtonElement>(null);
  useWakeLock(open);

  const go = (n: number) => {
    if (n < 0 || n >= count || n === at) return;
    setDir(n > at ? 'next' : 'back');
    onStepChange(n);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') go(at + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(at - 1);
    else return;
    event.preventDefault();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    start.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent) => {
    const from = start.current;
    start.current = undefined;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? at + 1 : at - 1);
  };
  const uses = current ? stepIngredients(current.text, recipe.ingredients) : [];

  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content
        side="bottom"
        size="lg"
        className={styles.cook}
        aria-describedby={countId}
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(event) => {
          // Hands go to Next first, not to the first timer in the row.
          event.preventDefault();
          next.current?.focus();
        }}
      >
        <div className={styles.cookTop}>
          <Sheet.Title className={styles.cookTitle}>{recipe.title}</Sheet.Title>
          <div
            className={styles.cookProgress}
            aria-hidden
            style={{ '--rc-progress': count ? (at + 1) / count : 0 } as CSSProperties}
          >
            <span className={styles.cookProgressFill} />
          </div>
          <TimerTray recipe={recipeKey} onSelect={go} className={styles.cookTray} />
        </div>

        <div
          className={styles.stage}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (start.current = undefined)}
        >
          {current && (
            <div key={at} className={styles.cookStep} data-dir={dir}>
              <p className={styles.cookCount} id={countId} aria-live="polite">
                Step {at + 1} of {count}
                {current.section && (
                  <span className={styles.cookSection}> · {current.section}</span>
                )}
              </p>
              <p className={styles.cookText}>
                <StepWords
                  step={current}
                  index={at}
                  recipe={recipeKey}
                  size="lg"
                  onTimerDone={onTimerDone}
                />
              </p>
              {uses.length > 0 && (
                <section className={styles.uses} aria-label="You’ll need">
                  <h3 className={styles.usesTitle}>You’ll need</h3>
                  <ul className={styles.usesList}>
                    {uses.flatMap((i) => {
                      const ingredient = recipe.ingredients[i];
                      return ingredient
                        ? [
                            <li key={i} className={styles.use}>
                              <IngredientLine ingredient={ingredient} factor={factor} />
                            </li>,
                          ]
                        : [];
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        <div className={styles.cookNav}>
          <Button
            variant="surface"
            tone="neutral"
            size="lg"
            disabled={at === 0}
            onClick={() => go(at - 1)}
            leadingIcon={<ArrowLeft aria-hidden />}
          >
            Back
          </Button>
          {at < count - 1 ? (
            <Button
              ref={next}
              size="lg"
              onClick={() => go(at + 1)}
              trailingIcon={<ArrowRight aria-hidden />}
            >
              Next
            </Button>
          ) : (
            <Button
              ref={next}
              size="lg"
              onClick={() => onOpenChange(false)}
              leadingIcon={<Check aria-hidden />}
            >
              Done
            </Button>
          )}
        </div>
      </Sheet.Content>
    </Sheet.Root>
  );
}
