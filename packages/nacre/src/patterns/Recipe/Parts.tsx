import { scaleAmount, unitFor, writeAmount } from './amounts';
import styles from './Recipe.module.css';
import { stepPieces, type RecipeIngredientData, type RecipeStepData } from './recipe';
import { RollNumber } from './Servings';
import { TimerChip } from './TimerChips';
import type { KitchenTimer } from './timers';

/** An ingredient's amount, scaled: `1½ cups`, or nothing when the page gave none. */
export function ingredientAmount(
  ingredient: RecipeIngredientData,
  factor: number,
): { amount: string; order: number; unit?: string } | undefined {
  if (ingredient.quantity === undefined) return undefined;
  const scaled = scaleAmount(ingredient.quantity, factor);
  const order = typeof scaled === 'number' ? scaled : scaled.from;
  const unit =
    ingredient.unit && ingredient.unit !== '×' ? unitFor(ingredient.unit, scaled) : ingredient.unit;
  return { amount: writeAmount(scaled), order, ...(unit && { unit }) };
}

/** One ingredient, as a cook reads it: the amount in bold, what it is, then the rest quietly. */
export function IngredientLine({
  ingredient,
  factor,
  index = 0,
}: {
  ingredient: RecipeIngredientData;
  factor: number;
  index?: number;
}) {
  const amount = ingredientAmount(ingredient, factor);
  if (!amount || !ingredient.item)
    return <span className={styles.ingredientText}>{ingredient.text}</span>;
  return (
    <span className={styles.ingredientText}>
      <span className={styles.amount}>
        <RollNumber value={amount.amount} order={amount.order} index={index} />
        {amount.unit && ` ${amount.unit}`}
      </span>{' '}
      {ingredient.item}
      {ingredient.note && <span className={styles.note}>, {ingredient.note}</span>}
    </span>
  );
}

/** A step's words, its timers drawn in them as chips you can tap. */
export function StepWords({
  step,
  index,
  recipe,
  size,
  onTimerDone,
}: {
  step: RecipeStepData;
  index: number;
  recipe: string;
  size?: 'md' | 'lg';
  onTimerDone?: (timer: KitchenTimer) => void;
}) {
  return (
    <>
      {stepPieces(step).map((piece, n) =>
        piece.kind === 'text' ? (
          <span key={n}>{piece.text}</span>
        ) : (
          <TimerChip
            key={n}
            id={`${recipe}:${index}:${piece.index}`}
            recipe={recipe}
            step={index}
            label={`Step ${index + 1}`}
            seconds={piece.timer.seconds}
            upTo={piece.timer.upTo}
            words={piece.text}
            size={size}
            onDone={onTimerDone}
          />
        ),
      )}
    </>
  );
}
