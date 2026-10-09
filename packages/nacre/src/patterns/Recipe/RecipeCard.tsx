import { ArrowUpRight, ChefHat, ChevronDown, Clock, Star, Users } from 'lucide-react';
import { useId, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Collapsible } from '../../components/Collapsible';
import { cx } from '../../utils/cx';
import { CookMode } from './CookMode';
import { IngredientLine, StepWords } from './Parts';
import styles from './Recipe.module.css';
import { recipeKey, useRecipeState, type RecipeData } from './recipe';
import { RollNumber, ServingsStepper, servingsWords } from './Servings';
import { formatDuration } from './time';
import { TimerTray } from './TimerChips';
import type { KitchenTimer } from './timers';
import { META_SEP } from '../../components/MetaList';

/** Only the page itself leaves the chat, and only over https, in a tab that knows nothing of Conch. */
const pageLink = (url: string) => (/^https:\/\//i.test(url) ? url : undefined);

function Fact({ icon, children, label }: { icon: ReactNode; children: ReactNode; label?: string }) {
  return (
    <li className={styles.fact} aria-label={label}>
      {icon}
      <span aria-hidden={label ? true : undefined}>{children}</span>
    </li>
  );
}

/** A list folded to its first few, with one quiet button for the rest. */
function useFold(total: number, limit: number) {
  const [all, setAll] = useState(false);
  const folds = total > limit + 1;
  return { shown: folds && !all ? limit : total, folds: folds && !all, open: () => setAll(true) };
}

export interface RecipeCardProps extends Omit<ComponentProps<'article'>, 'title'> {
  recipe: RecipeData;
  /** Where its state is kept for the session (servings, ticks, timers); the page's address by default. */
  stateKey?: string;
  /** A timer ended (it has already chimed): the app's notification, if it has one. */
  onTimerDone?: (timer: KitchenTimer, recipe: RecipeData) => void;
  /** Steps shown before “Show all steps”. */
  stepsLimit?: number;
  /** Ingredients shown before “Show all”. */
  ingredientsLimit?: number;
  /** Open in cook mode (stories). */
  defaultCooking?: boolean;
}

/**
 * A recipe, as a card to cook from. Its photo with the title over a soft
 * scrim; how long, how many and how well liked in chips; − and + that
 * rescale every amount (each number rolls to its new value, written as a
 * cook writes it: ½, ⅓, 1¾); ingredients to tick off (the check springs in,
 * the line is struck through); the method numbered, with every length of
 * time in it a timer chip that counts down in place and chimes when done;
 * the nutrition folded away; and the page it came from. **Cook** opens one
 * step at a time, large, in a sheet. What's ticked, the servings and the
 * timers last for the session.
 */
export function RecipeCard({
  recipe,
  stateKey,
  onTimerDone,
  stepsLimit = 5,
  ingredientsLimit = 12,
  defaultCooking = false,
  className,
  ...props
}: RecipeCardProps) {
  const key = stateKey ?? recipeKey(recipe);
  const base = recipe.yield?.amount ?? 1;
  const state = useRecipeState(key, base);
  const factor = state.servings / base;
  const [cooking, setCooking] = useState(defaultCooking);
  const [fresh, setFresh] = useState<number | undefined>();
  const titleId = useId();
  const ingredientsId = useId();
  const stepsId = useId();
  const ingredients = useFold(recipe.ingredients.length, ingredientsLimit);
  const steps = useFold(recipe.steps.length, stepsLimit);
  const done = (timer: KitchenTimer) => onTimerDone?.(timer, recipe);
  const link = pageLink(recipe.source.url);
  const total = recipe.times?.total ?? 0;
  const ticked = recipe.ingredients.filter((_, i) => state.checked.has(i)).length;
  const facts = [
    recipe.times?.prep && `${formatDuration(recipe.times.prep)} prep`,
    recipe.times?.cook && `${formatDuration(recipe.times.cook)} cook`,
    recipe.cuisine,
    recipe.category,
  ].filter(Boolean);

  const heading = (
    <div className={styles.heroText}>
      <span className={styles.site}>{recipe.source.site}</span>
      <h3 id={titleId} className={styles.title}>
        {recipe.title}
      </h3>
    </div>
  );

  return (
    <article
      className={cx(styles.card, className)}
      aria-labelledby={titleId}
      data-picture={recipe.picture ? '' : undefined}
      {...props}
    >
      {recipe.picture ? (
        <header className={styles.hero}>
          <img
            className={styles.photo}
            src={recipe.picture.src}
            alt=""
            width={recipe.picture.width}
            height={recipe.picture.height}
            decoding="async"
            draggable={false}
          />
          <span className={styles.scrim} aria-hidden />
          {heading}
        </header>
      ) : (
        <header className={styles.plainHead}>
          <span className={styles.mark} aria-hidden>
            <ChefHat />
          </span>
          {heading}
        </header>
      )}

      <div className={styles.body}>
        <ul className={styles.facts} aria-label="At a glance">
          {total > 0 && (
            <Fact icon={<Clock aria-hidden />} label={`Takes ${formatDuration(total)}`}>
              {formatDuration(total)}
            </Fact>
          )}
          {recipe.yield && (
            <Fact icon={<Users aria-hidden />}>
              {/^(?:servings?|people|portions?)$/i.test(recipe.yield.unit) ? 'Serves ' : 'Makes '}
              <RollNumber value={String(state.servings)} order={state.servings} />
              {/^(?:servings?|people|portions?)$/i.test(recipe.yield.unit)
                ? ''
                : ` ${servingsWords(state.servings, recipe.yield.unit).replace(/^\S+\s/, '')}`}
            </Fact>
          )}
          {recipe.rating && (
            <Fact
              icon={<Star aria-hidden className={styles.star} />}
              label={`Rated ${recipe.rating.value} out of 5${recipe.rating.count ? ` by ${recipe.rating.count.toLocaleString()} people` : ''}`}
            >
              {recipe.rating.value.toFixed(1)}
              {recipe.rating.count ? (
                <span className={styles.factQuiet}> ({recipe.rating.count.toLocaleString()})</span>
              ) : null}
            </Fact>
          )}
        </ul>
        {recipe.description && <p className={styles.description}>{recipe.description}</p>}
        {facts.length > 0 && <p className={styles.factLine}>{facts.join(META_SEP)}</p>}

        <TimerTray recipe={key} className={styles.cardTray} />

        {recipe.ingredients.length > 0 && (
          <section className={styles.section} aria-labelledby={ingredientsId}>
            <div className={styles.sectionHead}>
              <h4 id={ingredientsId} className={styles.sectionTitle}>
                Ingredients
                <span className={styles.count}>
                  {ticked ? `${ticked} of ${recipe.ingredients.length}` : recipe.ingredients.length}
                </span>
              </h4>
              <ServingsStepper
                value={state.servings}
                onChange={state.setServings}
                unit={recipe.yield ? recipe.yield.unit : undefined}
                max={Math.max(24, base * 4)}
              />
            </div>
            <ul className={styles.ingredients}>
              {recipe.ingredients.slice(0, ingredients.shown).map((ingredient, i) => {
                const section =
                  ingredient.section && ingredient.section !== recipe.ingredients[i - 1]?.section
                    ? ingredient.section
                    : undefined;
                const on = state.checked.has(i);
                return (
                  <li
                    key={i}
                    className={styles.ingredient}
                    data-checked={on || undefined}
                    data-fresh={fresh === i || undefined}
                  >
                    {section && <span className={styles.group}>{section}</span>}
                    <Checkbox
                      className={styles.tick}
                      checked={on}
                      onCheckedChange={(v) => {
                        state.toggle(i, v === true);
                        setFresh(v === true ? i : undefined);
                      }}
                      label={<IngredientLine ingredient={ingredient} factor={factor} index={i} />}
                    />
                  </li>
                );
              })}
            </ul>
            {ingredients.folds && (
              <FoldButton onClick={ingredients.open}>
                Show all {recipe.ingredients.length}
              </FoldButton>
            )}
          </section>
        )}

        {recipe.steps.length > 0 && (
          <section className={styles.section} aria-labelledby={stepsId}>
            <div className={styles.sectionHead}>
              <h4 id={stepsId} className={styles.sectionTitle}>
                Method
                <span className={styles.count}>{recipe.steps.length} steps</span>
              </h4>
            </div>
            <ol className={styles.steps}>
              {recipe.steps.slice(0, steps.shown).map((step, i) => {
                const section =
                  step.section && step.section !== recipe.steps[i - 1]?.section
                    ? step.section
                    : undefined;
                return (
                  <li key={i} className={styles.step} style={{ '--rc-i': i } as CSSProperties}>
                    {section && <span className={styles.group}>{section}</span>}
                    <span className={styles.stepRow}>
                      <span className={styles.stepNumber} aria-hidden>
                        {i + 1}
                      </span>
                      <span className={styles.stepText}>
                        <span className="nc-visually-hidden">Step {i + 1}: </span>
                        <StepWords step={step} index={i} recipe={key} onTimerDone={done} />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
            {steps.folds && (
              <FoldButton onClick={steps.open}>Show all {recipe.steps.length} steps</FoldButton>
            )}
          </section>
        )}

        {recipe.nutrition && recipe.nutrition.length > 0 && (
          <Collapsible className={styles.nutrition}>
            <Collapsible.Trigger className={styles.nutritionTrigger}>
              Nutrition per serving
              {recipe.nutrition[0]?.label === 'Calories' && (
                <span className={styles.factQuiet}> · {recipe.nutrition[0].value}</span>
              )}
            </Collapsible.Trigger>
            <Collapsible.Content>
              <dl className={styles.nutrients}>
                {recipe.nutrition.map((n) => (
                  <div key={n.label} className={styles.nutrient}>
                    <dt>{n.label}</dt>
                    <dd>{n.value}</dd>
                  </div>
                ))}
              </dl>
            </Collapsible.Content>
          </Collapsible>
        )}
      </div>

      <footer className={styles.footer}>
        {recipe.steps.length > 0 && (
          <Button
            size="md"
            leadingIcon={<ChefHat aria-hidden />}
            onClick={() => setCooking(true)}
            className={styles.cookButton}
          >
            Cook
          </Button>
        )}
        {link && (
          <a className={styles.original} href={link} target="_blank" rel="noopener noreferrer">
            <span>
              Open on <span className={styles.originalSite}>{recipe.source.site}</span>
            </span>
            <ArrowUpRight aria-hidden />
            <span className="nc-visually-hidden"> (opens in a new tab)</span>
          </a>
        )}
      </footer>

      {recipe.steps.length > 0 && (
        <CookMode
          open={cooking}
          onOpenChange={setCooking}
          recipe={recipe}
          recipeKey={key}
          factor={factor}
          step={state.step}
          onStepChange={state.setStep}
          onTimerDone={done}
        />
      )}
    </article>
  );
}

function FoldButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div className={styles.fold}>
      <Button variant="ghost" size="sm" tone="neutral" onClick={onClick}>
        {children}
        <ChevronDown aria-hidden />
      </Button>
    </div>
  );
}

export interface RecipeCardsProps extends Omit<RecipeCardProps, 'recipe' | 'stateKey'> {
  recipes: readonly RecipeData[];
}

/** One to three recipes, each its own card, one under another. */
export function RecipeCards({ recipes, className, ...props }: RecipeCardsProps) {
  return (
    <div className={cx(styles.cards, className)}>
      {recipes.map((recipe, i) => (
        <RecipeCard key={`${recipe.source.url}-${i}`} recipe={recipe} {...props} />
      ))}
    </div>
  );
}
