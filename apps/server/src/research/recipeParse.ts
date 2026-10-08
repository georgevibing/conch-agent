/**
 * Reading a recipe page (the `recipe` tool): its schema.org `Recipe`, or its
 * microdata and card tags when it has none, into the shape the chat's recipe
 * card draws. Pure functions, no network: `recipe.ts` fetches.
 *
 * Amounts are read so the card can scale them (½, 1 1/2, 2–3, 1.5), and the
 * lengths of time a step mentions (“bake for 20–25 minutes”) are found so the
 * card can offer a timer right there in the words. Everything is someone
 * else's text: plain, capped, never markup.
 */
import type {
  Recipe,
  RecipeIngredient,
  RecipeQuantity,
  RecipeStep,
  RecipeTimer,
} from '@conch/protocol';

import {
  findLd,
  httpsUrl,
  isoDuration,
  ldImage,
  plain,
  type LdNode,
  type PageData,
} from './pageData';

// ── Amounts ─────────────────────────────────────────────────────────────────

const VULGAR: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
  '⅐': 1 / 7,
  '⅑': 1 / 9,
  '⅒': 1 / 10,
};
const VULGAR_CLASS = `[${Object.keys(VULGAR).join('')}]`;

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  sixty: 60,
  half: 0.5,
};

/**
 * One amount, as written: `3`, `1.5`, `1,5`, `1/2`, `1 1/2`, `½`, `1½`, `1 ½`.
 * Order matters: the mixed forms come before their parts.
 */
const NUMBER = `(?:\\d+\\s*${VULGAR_CLASS}|\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?|${VULGAR_CLASS})`;
const RANGE_JOIN = `\\s*(?:-|–|—|to|or)\\s*`;

/** A written amount as a number, or nothing. */
export function readNumber(raw: string): number | undefined {
  const text = raw.trim().replace(/⁄/g, '/');
  const vulgar = new RegExp(`^(\\d+)?\\s*(${VULGAR_CLASS})$`).exec(text);
  if (vulgar) return Number(vulgar[1] ?? 0) + (VULGAR[vulgar[2] ?? ''] ?? 0);
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (mixed)
    return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : undefined;
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : undefined;
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
  return WORDS[text.toLowerCase()];
}

/** Units a recipe measures in, longest first so `fl oz` wins over `oz`. Matched whole-word, any case. */
const UNITS = [
  'fluid ounces',
  'fluid ounce',
  'fl\\.? oz',
  'tablespoons',
  'tablespoon',
  'teaspoons',
  'teaspoon',
  'kilograms',
  'kilogram',
  'millilitres',
  'millilitre',
  'milliliters',
  'milliliter',
  'litres',
  'litre',
  'liters',
  'liter',
  'grams',
  'gram',
  'ounces',
  'ounce',
  'pounds',
  'pound',
  'gallons',
  'gallon',
  'quarts',
  'quart',
  'pints',
  'pint',
  'cups',
  'cup',
  'tbsps?',
  'tbsp\\.',
  'tbs\\.?',
  'tbl\\.?',
  'tsps?',
  'tsp\\.',
  'kgs?',
  'mg',
  'ml',
  'cl',
  'dl',
  'lbs?\\.?',
  'oz\\.?',
  'qt\\.?',
  'pt\\.?',
  'g',
  'l',
  'cloves?',
  'pinch(?:es)?',
  'dash(?:es)?',
  'handfuls?',
  'cans?',
  'tins?',
  'jars?',
  'packets?',
  'packages?',
  'packs?',
  'sticks?',
  'slices?',
  'sprigs?',
  'bunch(?:es)?',
  'heads?',
  'pieces?',
  'stalks?',
  'knobs?',
  'drops?',
  'sheets?',
  'fillets?',
  'rashers?',
  'bottles?',
  'bags?',
  'blocks?',
  'balls?',
];
const UNIT = `(?:${UNITS.join('|')})`;

const INGREDIENT = new RegExp(
  `^(?:about\\s+|approx\\.?\\s+|approximately\\s+)?(${NUMBER}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)` +
    `(?:${RANGE_JOIN}(${NUMBER}))?` +
    `(?:\\s*([x×])(?![\\p{L}])\\s*|\\s*(${UNIT})(?![\\p{L}])\\.?\\s*|\\s+|(?=\\())`,
  'iu',
);

/** One ingredient line, read as far as it can be: the amount, the unit, what it is, and the rest. */
export function parseIngredient(line: string, section?: string): RecipeIngredient | undefined {
  const text = plain(line, 300);
  if (!text) return undefined;
  const base: RecipeIngredient = { text, ...(section && { section }) };
  const m = INGREDIENT.exec(text.replace(/⁄/g, '/'));
  let quantity: RecipeQuantity | undefined;
  let unit: string | undefined;
  let rest = text;
  if (m) {
    const from = readNumber(m[1] ?? '');
    const to = m[2] ? readNumber(m[2]) : undefined;
    // "a pinch", "an onion" are amounts; "a few", "a little" aren't.
    const vague = /^(?:a|an)\s+(?:few|little|bit|couple|good|generous|splash|drizzle|some)\b/i.test(
      text,
    );
    if (from !== undefined && !vague) {
      quantity = to !== undefined && to > from ? { from, to } : from;
      unit = m[3] ? '×' : m[4] ? m[4].replace(/\.$/, '') : undefined;
      rest = text.slice(m[0].length);
    }
  }
  rest = rest.replace(/^of\s+/i, '').trim();
  let item = rest;
  let note: string | undefined;
  const comma = /^([^,;]+?)[,;]\s*(.+)$/.exec(rest);
  if (comma) {
    item = (comma[1] ?? '').trim();
    note = (comma[2] ?? '').trim();
  }
  const aside = /^(.+?)\s*\(([^()]+)\)$/.exec(item);
  if (aside && !note) {
    item = (aside[1] ?? '').trim();
    note = (aside[2] ?? '').trim();
  }
  if (quantity === undefined) {
    return item
      ? { ...base, item: item.slice(0, 200), ...(note && { note: note.slice(0, 200) }) }
      : base;
  }
  return {
    ...base,
    quantity,
    ...(unit && { unit: unit.slice(0, 24) }),
    ...(item && { item: item.slice(0, 200) }),
    ...(note && { note: note.slice(0, 200) }),
  };
}

// ── Timers in a step ────────────────────────────────────────────────────────

const TIME_UNIT: [RegExp, number][] = [
  [/^s/i, 1],
  [/^m/i, 60],
  [/^h/i, 3600],
  [/^d/i, 86400],
];
const SECONDS_IN = (unit: string) => TIME_UNIT.find(([re]) => re.test(unit))?.[1] ?? 0;
const TIME_WORD = `(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)`;
const TIME_NUMBER = `(?:${NUMBER}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|forty|sixty)`;
const TIMER = new RegExp(
  `(?<![\\p{L}\\d/.,])(?:(half)\\s+an?\\s+(hour)|(${TIME_NUMBER})(?:${RANGE_JOIN}(${TIME_NUMBER}))?(?:\\s*|-)(${TIME_WORD})` +
    `(?:\\s*(?:and\\s+)?(?:a\\s+)?(half)|\\s*(?:and\\s+)?(\\d+)\\s*(minutes?|mins?))?)(?![\\p{L}])`,
  'giu',
);

/** The lengths of time a step's words mention, where they are: each one a timer to start. */
export function findTimers(text: string): RecipeTimer[] {
  const out: RecipeTimer[] = [];
  for (const m of text.matchAll(TIMER)) {
    if (out.length >= 6) break;
    let seconds: number | undefined;
    let upTo: number | undefined;
    if (m[1]) seconds = 1800;
    else {
      const per = SECONDS_IN(m[5] ?? '');
      const from = readNumber(m[3] ?? '');
      const to = m[4] ? readNumber(m[4]) : undefined;
      if (from === undefined || !per) continue;
      // "1 hour and a half", "1 hour 15 minutes": one length of time, not two.
      const extra = m[6] ? per / 2 : m[7] ? Number(m[7]) * 60 : 0;
      seconds = Math.round(from * per + extra);
      if (to !== undefined && to > from) upTo = Math.round(to * per + extra);
    }
    if (!seconds || seconds > 7 * 86400) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (end > 2000) break;
    out.push({ start, end, seconds, ...(upTo && upTo <= 7 * 86400 && { upTo }) });
  }
  return out;
}

// ── Steps ───────────────────────────────────────────────────────────────────

const STEP_NUMBER = /^(?:step\s*)?\d{1,2}\s*[.):-]\s+|^step\s*\d{1,2}\s*$/i;

function stepText(raw: unknown): string | undefined {
  const text = plain(raw, 2000)?.replace(STEP_NUMBER, '').trim();
  return text || undefined;
}

/** A block of method written as one string: its lines, or its numbered parts. */
function splitMethod(raw: string): string[] {
  const lines = raw
    .replace(/<\s*(?:br|\/p|\/li|\/div)\s*\/?>/gi, '\n')
    .split(/\n+/)
    .map((l) => stepText(l))
    .filter((l): l is string => Boolean(l));
  if (lines.length > 1) return lines;
  const one = lines[0];
  if (!one) return [];
  // "1. Heat the oven. 2. Mix…" written as one line: its numbered parts.
  if (!/^1[.)]\s/.test(raw.trim())) return [one];
  const numbered = (plain(raw, 2000) ?? '')
    .split(/\s(?=\d{1,2}[.)]\s+\p{Lu})/u)
    .map((l) => stepText(l));
  return numbered.filter((l): l is string => Boolean(l));
}

function readSteps(value: unknown, section?: string, depth = 0): RecipeStep[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') return splitMethod(value).map((text) => step(text, section));
  if (Array.isArray(value)) return value.flatMap((v) => readSteps(v, section, depth + 1));
  if (typeof value !== 'object') return [];
  const node = value as LdNode;
  const type = JSON.stringify(node['@type'] ?? '').toLowerCase();
  if (type.includes('howtosection') || (node.itemListElement && !node.text)) {
    const name = plain(node.name, 120);
    return readSteps(node.itemListElement, name ?? section, depth + 1);
  }
  const text = stepText(node.text) ?? stepText(node.name) ?? stepText(node.description);
  return text ? [step(text, section)] : [];
}

function step(text: string, section?: string): RecipeStep {
  return { text, ...(section && { section }), timers: findTimers(text) };
}

// ── Yield, people, numbers ──────────────────────────────────────────────────

/** `4`, `"4 servings"`, `"Serves 4-6"`, `"Makes 12 cookies"`, `["4", "4 servings"]`. */
export function parseYield(value: unknown): Recipe['yield'] {
  const list = (Array.isArray(value) ? value : [value]).flatMap((v) =>
    typeof v === 'number' ? [String(v)] : typeof v === 'string' ? [v] : [],
  );
  const read = list.flatMap((raw) => {
    const text = plain(raw, 120);
    if (!text) return [];
    const m = new RegExp(
      `(${NUMBER})(?:${RANGE_JOIN}${NUMBER})?\\s*([\\p{L}][\\p{L}\\s-]*)?`,
      'u',
    ).exec(text.replace(/⁄/g, '/'));
    const amount = m ? readNumber(m[1] ?? '') : undefined;
    if (!amount || amount > 1000) return [];
    const said = m?.[2]?.trim().toLowerCase();
    const unit =
      !said || /^(?:people|persons?|portions?|servings?|serves)$/.test(said) ? 'servings' : said;
    return [{ amount, unit: unit.slice(0, 40), worded: Boolean(said) }];
  });
  const best = read.find((r) => r.worded) ?? read[0];
  return best && { amount: best.amount, unit: best.unit };
}

function name(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string') return plain(first, 120);
  if (first && typeof first === 'object') return plain((first as LdNode).name, 120);
  return undefined;
}

function firstText(value: unknown, max: number): string | undefined {
  const first = Array.isArray(value) ? value.find((v) => typeof v === 'string') : value;
  return plain(first, max);
}

const num = (value: unknown): number | undefined => {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(',', '.'))
        : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const NUTRIENTS: [string, string][] = [
  ['calories', 'Calories'],
  ['proteinContent', 'Protein'],
  ['carbohydrateContent', 'Carbohydrates'],
  ['sugarContent', 'Sugar'],
  ['fiberContent', 'Fibre'],
  ['fatContent', 'Fat'],
  ['saturatedFatContent', 'Saturated fat'],
  ['unsaturatedFatContent', 'Unsaturated fat'],
  ['transFatContent', 'Trans fat'],
  ['cholesterolContent', 'Cholesterol'],
  ['sodiumContent', 'Sodium'],
];

function nutrition(value: unknown): Recipe['nutrition'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const node = value as LdNode;
  const out = NUTRIENTS.flatMap(([key, label]) => {
    const raw = plain(node[key], 40);
    if (!raw) return [];
    // A bare calorie count reads better with its unit.
    const text = key === 'calories' && /^\d+(?:\.\d+)?$/.test(raw) ? `${raw} kcal` : raw;
    return [{ label, value: text }];
  });
  return out.length ? out : undefined;
}

function rating(value: unknown): Recipe['rating'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const node = value as LdNode;
  const raw = num(node.ratingValue);
  if (raw === undefined || raw <= 0) return undefined;
  const best = num(node.bestRating) ?? 5;
  const value5 = best > 0 && best !== 5 ? (raw / best) * 5 : raw;
  if (value5 > 5) return undefined;
  const count = num(node.ratingCount) ?? num(node.reviewCount);
  return {
    value: Math.round(value5 * 10) / 10,
    ...(count !== undefined && count >= 0 && { count: Math.round(count) }),
  };
}

function tags(value: unknown): string[] | undefined {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set<string>();
  const out = list.flatMap((t) => {
    const text = plain(t, 40);
    if (!text || seen.has(text.toLowerCase())) return [];
    seen.add(text.toLowerCase());
    return [text];
  });
  return out.length ? out.slice(0, 8) : undefined;
}

// ── Microdata, for pages without JSON-LD ────────────────────────────────────

/** The text of every element with this `itemprop`, crudely: for pages that only mark their lists up. */
function microdata(html: string, ...props: string[]): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*\\bitemprop\\s*=\\s*["']?(?:${props.join('|')})["']?[^>]*>([\\s\\S]*?)</\\1>`,
    'gi',
  );
  for (const m of html.slice(0, 3_000_000).matchAll(re)) {
    const text = plain(m[2], 2000);
    if (text) out.push(text);
    if (out.length >= 80) break;
  }
  return out;
}

// ── The whole recipe ────────────────────────────────────────────────────────

/** A recipe as read, before its picture is fetched: `image` is where the picture is. */
export type ReadRecipe = Omit<Recipe, 'picture'> & { image?: string };

/** The site's own name, or its address without `www.`. */
function siteOf(data: PageData, node: LdNode | undefined, url: URL): string {
  return (
    plain(data.meta['og:site_name'], 80) ??
    name(node?.publisher) ??
    url.hostname.replace(/^www\./, '').slice(0, 80)
  );
}

/**
 * The recipe on a page, or nothing when there isn't one to cook from (no
 * ingredients and no steps). `url` is where the page really was (after
 * redirects): links and pictures are resolved against it.
 */
export function readRecipe(data: PageData, html: string, url: string): ReadRecipe | undefined {
  const page = httpsUrl(url);
  if (!page) return undefined;
  const at = new URL(page);
  at.hash = '';
  const node = findLd(data, 'recipe');
  const ingredientLines = node
    ? Array.isArray(node.recipeIngredient)
      ? node.recipeIngredient
      : Array.isArray(node.ingredients)
        ? node.ingredients
        : typeof node.recipeIngredient === 'string'
          ? node.recipeIngredient.split(/\n+/)
          : []
    : microdata(html, 'recipeIngredient', 'ingredients');
  const ingredients = ingredientLines
    .flatMap((line) => {
      const read = parseIngredient(typeof line === 'string' ? line : '');
      return read ? [read] : [];
    })
    .slice(0, 80);
  const steps = (
    node
      ? readSteps(node.recipeInstructions)
      : microdata(html, 'recipeInstructions').flatMap((t) => readSteps(t))
  ).slice(0, 60);
  if (!ingredients.length && !steps.length) return undefined;

  const title =
    plain(node?.name, 200) ??
    plain(data.meta['og:title'], 200) ??
    plain(data.title, 200) ??
    'Recipe';
  const description =
    plain(node?.description, 500) ??
    plain(data.meta['og:description'] ?? data.meta.description, 500);
  const image =
    ldImage(node?.image, at.href) ??
    (data.meta['og:image'] ? httpsUrl(data.meta['og:image'], at.href) : undefined) ??
    (data.meta['twitter:image'] ? httpsUrl(data.meta['twitter:image'], at.href) : undefined);
  const prep = isoDuration(node?.prepTime);
  const cook = isoDuration(node?.cookTime);
  const total = isoDuration(node?.totalTime) ?? (prep && cook ? prep + cook : undefined);
  const made = parseYield(node?.recipeYield ?? node?.yield);
  const nutrients = nutrition(node?.nutrition);
  const stars = rating(node?.aggregateRating);
  const author = name(node?.author);
  const cuisine = firstText(node?.recipeCuisine, 80);
  const category = firstText(node?.recipeCategory, 80);
  const keywords = tags(node?.keywords);
  const week = 7 * 86400;
  const time = (s: number | undefined) => (s && s > 0 && s <= week ? s : undefined);
  return {
    title,
    source: { site: siteOf(data, node, at), url: at.href },
    ...(description && { description }),
    ...(author && { author }),
    ...(made && { yield: made }),
    times: {
      ...(time(prep) && { prep: time(prep) }),
      ...(time(cook) && { cook: time(cook) }),
      ...(time(total) && { total: time(total) }),
    },
    ingredients,
    steps,
    ...(nutrients && { nutrition: nutrients }),
    ...(stars && { rating: stars }),
    ...(cuisine && { cuisine }),
    ...(category && { category }),
    ...(keywords && { tags: keywords }),
    ...(image && { image }),
  };
}
