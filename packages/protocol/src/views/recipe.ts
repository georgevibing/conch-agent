/**
 * A recipe, drawn as a card you can cook from (ADR 0060 §7): its picture,
 * times and servings, the ingredients (with their amounts read, so the card
 * can scale them), the steps (with the timers they mention found), and the
 * page it came from.
 *
 * Everything here was read from someone else's page: plain text, never
 * markup, and the only link is the page itself (https). The picture is the
 * chat's own attachment, fetched by the gateway, never a remote address.
 */
import { z } from 'zod';

import { Attachment } from '../attachments';

const PageUrl = z
  .string()
  .max(2000)
  .regex(/^https:\/\//i, 'Only secure web links.');

/** Seconds, from a few seconds to a week (a long ferment, a cure). */
const Seconds = z
  .number()
  .int()
  .positive()
  .max(7 * 24 * 3600);

/** An amount: a number (1.5), or a range (2–3). */
export const RecipeQuantity = z.union([
  z.number().nonnegative().max(100_000),
  z.object({
    from: z.number().nonnegative().max(100_000),
    to: z.number().nonnegative().max(100_000),
  }),
]);
export type RecipeQuantity = z.infer<typeof RecipeQuantity>;

export const RecipeIngredient = z.object({
  /** The line as the page wrote it: what's shown when nothing more could be read. */
  text: z.string().min(1).max(300),
  quantity: RecipeQuantity.optional(),
  /** As written, short: `cup`, `g`, `tbsp`, `cloves`. */
  unit: z.string().max(24).optional(),
  /** What it is: `plain flour`. */
  item: z.string().max(200).optional(),
  /** What follows it: `finely chopped`, `or to taste`. */
  note: z.string().max(200).optional(),
  /** The group it's listed under on the page: `For the sauce`. */
  section: z.string().max(120).optional(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredient>;

/** A length of time a step mentions ("bake for 20–25 minutes"), where it sits in the step's words. */
export const RecipeTimer = z.object({
  /** Characters into the step's text where the words for it start, and end. */
  start: z.number().int().nonnegative().max(2000),
  end: z.number().int().positive().max(2000),
  seconds: Seconds,
  /** The longer end of a range (25 minutes, for "20–25 minutes"). */
  upTo: Seconds.optional(),
});
export type RecipeTimer = z.infer<typeof RecipeTimer>;

export const RecipeStep = z.object({
  text: z.string().min(1).max(2000),
  /** The part of the method it belongs to: `Make the dough`. */
  section: z.string().max(120).optional(),
  timers: z.array(RecipeTimer).max(6).default([]),
});
export type RecipeStep = z.infer<typeof RecipeStep>;

export const RecipeNutrient = z.object({
  /** `Calories`, `Protein`, `Fat`. */
  label: z.string().min(1).max(40),
  /** As the page gave it: `320 kcal`, `12 g`. */
  value: z.string().min(1).max(40),
});
export type RecipeNutrient = z.infer<typeof RecipeNutrient>;

export const Recipe = z.object({
  title: z.string().min(1).max(200),
  source: z.object({
    /** The site's name, or its address without `www.`: `BBC Good Food`. */
    site: z.string().min(1).max(80),
    url: PageUrl,
  }),
  picture: Attachment.optional(),
  description: z.string().max(500).optional(),
  author: z.string().max(120).optional(),
  /** What it makes: `{ amount: 4, unit: 'servings' }`. */
  yield: z
    .object({
      amount: z.number().positive().max(1000),
      unit: z.string().max(40),
    })
    .optional(),
  times: z
    .object({ prep: Seconds.optional(), cook: Seconds.optional(), total: Seconds.optional() })
    .default({}),
  ingredients: z.array(RecipeIngredient).max(80),
  steps: z.array(RecipeStep).max(60),
  /** Per serving, as the page gave it. */
  nutrition: z.array(RecipeNutrient).max(12).optional(),
  rating: z
    .object({
      value: z.number().min(0).max(5),
      count: z.number().int().nonnegative().optional(),
    })
    .optional(),
  cuisine: z.string().max(80).optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().min(1).max(40)).max(8).optional(),
});
export type Recipe = z.infer<typeof Recipe>;

/** The `recipe` tool view: one to three recipes, each its own card. */
export const RecipeView = z.object({
  kind: z.literal('recipe'),
  items: z.array(Recipe).min(1).max(3),
});
export type RecipeView = z.infer<typeof RecipeView>;
