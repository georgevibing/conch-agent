/**
 * What a recipe card is drawn from, and the small pure pieces both its views
 * (the card, cook mode) share: which ingredients a step uses, a step's words
 * cut around its timers, and the card's state for the session.
 */
import { useCallback, useState } from 'react';

import type { RecipeAmount } from './amounts';

export interface RecipeIngredientData {
  /** The line as the page wrote it. */
  text: string;
  quantity?: RecipeAmount;
  unit?: string;
  item?: string;
  note?: string;
  section?: string;
}

export interface RecipeTimerData {
  /** Where the words for it sit in the step's text. */
  start: number;
  end: number;
  seconds: number;
  upTo?: number;
}

export interface RecipeStepData {
  text: string;
  section?: string;
  timers?: readonly RecipeTimerData[];
}

export interface RecipeData {
  title: string;
  source: { site: string; url: string };
  /** The chat's own copy of the picture (never a remote address). */
  picture?: { src: string; width?: number; height?: number };
  description?: string;
  author?: string;
  yield?: { amount: number; unit: string };
  times?: { prep?: number; cook?: number; total?: number };
  ingredients: readonly RecipeIngredientData[];
  steps: readonly RecipeStepData[];
  nutrition?: readonly { label: string; value: string }[];
  rating?: { value: number; count?: number };
  cuisine?: string;
  category?: string;
  tags?: readonly string[];
}

/** Words that describe an ingredient rather than name it. */
const DESCRIBING = new Set(
  'fresh large small medium big extra virgin finely roughly chopped sliced diced minced grated ground whole plain unsalted salted softened melted cold warm hot room temperature dried free range organic ripe thinly thickly peeled cooked raw good quality light dark low fat of and or the for to into'.split(
    ' ',
  ),
);

/** A word in the singular, near enough: berries → berry, tomatoes → tomato, eggs → egg. */
function stem(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh|o)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The ingredients a step's words mention, by place in the list: "Whisk the
 * eggs into the flour" uses the eggs and the flour. Each ingredient is
 * known by its own words (`plain flour`), else by its naming word
 * (`flour`), singular or plural.
 */
export function stepIngredients(
  text: string,
  ingredients: readonly RecipeIngredientData[],
): number[] {
  const words = text.toLowerCase();
  return ingredients.flatMap((ingredient, i) => {
    const item = (ingredient.item ?? '')
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .trim();
    if (!item) return [];
    if (new RegExp(`\\b${escape(item)}\\b`).test(words)) return [i];
    const naming = item.split(/[^\p{L}]+/u).filter((w) => w.length > 2 && !DESCRIBING.has(w));
    const last = naming.at(-1);
    if (!last) return [];
    const root = stem(last);
    const forms = [`${escape(root)}(?:s|es)?`];
    if (root.endsWith('y')) forms.push(`${escape(root.slice(0, -1))}ies`);
    return new RegExp(`\\b(?:${forms.join('|')})\\b`).test(words) ? [i] : [];
  });
}

/** A step's words in pieces: plain text, and the timers where they're mentioned. */
export type StepPiece =
  | { kind: 'text'; text: string }
  | { kind: 'timer'; text: string; timer: RecipeTimerData; index: number };

export function stepPieces(step: RecipeStepData): StepPiece[] {
  const out: StepPiece[] = [];
  let at = 0;
  const timers = [...(step.timers ?? [])]
    .map((timer, index) => ({ timer, index }))
    .filter(
      ({ timer }) => timer.start >= 0 && timer.end <= step.text.length && timer.end > timer.start,
    )
    .sort((a, b) => a.timer.start - b.timer.start);
  for (const { timer, index } of timers) {
    if (timer.start < at) continue;
    if (timer.start > at) out.push({ kind: 'text', text: step.text.slice(at, timer.start) });
    out.push({ kind: 'timer', text: step.text.slice(timer.start, timer.end), timer, index });
    at = timer.end;
  }
  if (at < step.text.length) out.push({ kind: 'text', text: step.text.slice(at) });
  return out;
}

/** The card's own key, when the app gives none: the page it came from. */
export const recipeKey = (recipe: RecipeData) => recipe.source.url || recipe.title;

interface Saved {
  servings?: number;
  checked?: number[];
  step?: number;
}

function read(key: string): Saved {
  try {
    const raw = sessionStorage.getItem(`nc-recipe:${key}`);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

function write(key: string, saved: Saved) {
  try {
    sessionStorage.setItem(`nc-recipe:${key}`, JSON.stringify(saved));
  } catch {
    // Not kept: it still works until the page goes.
  }
}

/**
 * What a person did with this card, kept for the session: how many it's
 * for, what's ticked off, the step cook mode is on. A card drawn again (a
 * scroll, a reload) picks up where it was.
 */
export function useRecipeState(key: string, baseServings: number) {
  const [held, setHeld] = useState(() => ({ key, saved: read(key) }));
  // Another card in this place: its own state, read as it's drawn.
  let saved = held.saved;
  if (held.key !== key) {
    saved = read(key);
    setHeld({ key, saved });
  }
  const setSaved = useCallback(
    (change: (s: Saved) => Saved) => setHeld((h) => ({ key: h.key, saved: change(h.saved) })),
    [],
  );
  const update = useCallback(
    (change: (s: Saved) => Saved) =>
      setSaved((s) => {
        const next = change(s);
        write(key, next);
        return next;
      }),
    [key, setSaved],
  );
  const servings = saved.servings && saved.servings > 0 ? saved.servings : baseServings;
  const checked = new Set(saved.checked ?? []);
  return {
    servings,
    setServings: (n: number) => update((s) => ({ ...s, servings: n })),
    checked,
    toggle: (i: number, on: boolean) =>
      update((s) => {
        const set = new Set(s.checked ?? []);
        if (on) set.add(i);
        else set.delete(i);
        return { ...s, checked: [...set].sort((a, b) => a - b) };
      }),
    step: saved.step ?? 0,
    setStep: (n: number) => update((s) => ({ ...s, step: n })),
  };
}
