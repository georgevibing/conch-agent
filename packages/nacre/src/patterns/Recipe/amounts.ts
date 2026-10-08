/**
 * Amounts, scaled and written the way a cook reads them: `1½`, `⅓`, `2–3`,
 * never `1.4999`. Pure, so the card, cook mode and the tests agree.
 */

/** An amount as the recipe has it: a number, or a range. */
export type RecipeAmount = number | { from: number; to: number };

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

/**
 * A number as a cook writes it. Small amounts snap to the nearest everyday
 * fraction (`1⅓`); big ones round to something you can weigh (`452` is `450`).
 */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100) return String(Math.round(n / 5) * 5);
  if (n >= 10) return String(Math.round(n));
  const whole = Math.floor(n);
  const rest = n - whole;
  if (rest < 1 / 16) return String(whole || '0');
  if (rest > 15 / 16) return String(whole + 1);
  let best: [number, string] = [1 / 8, '⅛'];
  for (const f of FRACTIONS) if (Math.abs(f[0] - rest) < Math.abs(best[0] - rest)) best = f;
  // Too far from any fraction cooks use (0.45 of a cup): one decimal says it better.
  if (Math.abs(best[0] - rest) > 0.05) return (Math.round(n * 10) / 10).toString();
  return whole ? `${whole}${best[1]}` : best[1];
}

/** An amount, scaled: `2–3` × 2 is `4–6`. */
export function scaleAmount(amount: RecipeAmount, factor: number): RecipeAmount {
  return typeof amount === 'number'
    ? amount * factor
    : { from: amount.from * factor, to: amount.to * factor };
}

/** An amount written out: `1½`, `2–3`. */
export function writeAmount(amount: RecipeAmount): string {
  if (typeof amount === 'number') return formatAmount(amount);
  const from = formatAmount(amount.from);
  const to = formatAmount(amount.to);
  return from === to ? from : `${from}–${to}`;
}

/** How much, for working out a unit's number. */
const size = (amount: RecipeAmount) => (typeof amount === 'number' ? amount : amount.to);

/** Units that take an `s` (or `es`) for more than one; the rest (g, tbsp, ml) never change. */
const COUNTED: Record<string, string> = {
  cup: 'cups',
  clove: 'cloves',
  can: 'cans',
  tin: 'tins',
  jar: 'jars',
  pinch: 'pinches',
  dash: 'dashes',
  slice: 'slices',
  sprig: 'sprigs',
  bunch: 'bunches',
  head: 'heads',
  piece: 'pieces',
  stalk: 'stalks',
  stick: 'sticks',
  packet: 'packets',
  pack: 'packs',
  package: 'packages',
  handful: 'handfuls',
  pound: 'pounds',
  ounce: 'ounces',
  pint: 'pints',
  quart: 'quarts',
  gallon: 'gallons',
  tablespoon: 'tablespoons',
  teaspoon: 'teaspoons',
  gram: 'grams',
  kilogram: 'kilograms',
  litre: 'litres',
  liter: 'liters',
  millilitre: 'millilitres',
  milliliter: 'milliliters',
  sheet: 'sheets',
  fillet: 'fillets',
  rasher: 'rashers',
  bottle: 'bottles',
  bag: 'bags',
  block: 'blocks',
  ball: 'balls',
  knob: 'knobs',
  drop: 'drops',
  serving: 'servings',
  portion: 'portions',
  loaf: 'loaves',
  batch: 'batches',
};
const SINGLE = Object.fromEntries(Object.entries(COUNTED).map(([one, many]) => [many, one]));

/** A unit that agrees with its amount: 1 cup, 2 cups; ½ cup; 1 pinch, 3 pinches. */
export function unitFor(unit: string, amount: RecipeAmount): string {
  const lower = unit.toLowerCase();
  const many = size(amount) > 1;
  if (many && COUNTED[lower]) return COUNTED[lower];
  if (!many && SINGLE[lower]) return SINGLE[lower];
  return unit;
}
