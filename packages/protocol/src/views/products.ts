/**
 * Products a tool found on shop pages (`product_details`), drawn as a shelf
 * of cards in the chat (ADR 0060 §7). Everything here came from someone
 * else's page: plain text, `https` links only, and pictures only as the
 * chat's own attachments (the gateway fetched them), never a remote address.
 */
import { z } from 'zod';

import { Attachment } from '../attachments';

/** A shop's own page: `https` only, since a view's links are the only way out. */
const ShopUrl = z
  .string()
  .max(2000)
  .regex(/^https:\/\//i, 'Only secure web links.');

/** Whether it can be had, as the page says. `unknown` when it doesn't. */
export const ProductAvailability = z.enum([
  'in_stock',
  'out_of_stock',
  'preorder',
  'limited',
  'unknown',
]);
export type ProductAvailability = z.infer<typeof ProductAvailability>;

/** An amount in an ISO 4217 currency (`EUR`, `USD`, `JPY`). */
export const ProductPrice = z.object({
  amount: z.number().nonnegative().max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, 'An ISO 4217 code.'),
});
export type ProductPrice = z.infer<typeof ProductPrice>;

/** Stars out of five, and how many people gave them. */
export const ProductRating = z.object({
  value: z.number().min(0).max(5),
  count: z.number().int().nonnegative().optional(),
});
export type ProductRating = z.infer<typeof ProductRating>;

export const ProductItem = z.object({
  title: z.string().min(1).max(200),
  /** The product's page in its shop. */
  url: ShopUrl.optional(),
  /** Its photo, kept as the chat's own attachment. */
  picture: Attachment.optional(),
  /** More photos for the gallery, after `picture`. */
  pictures: z.array(Attachment).max(4).optional(),
  price: ProductPrice.optional(),
  /** What it cost before, when the page shows a reduction. */
  was: ProductPrice.optional(),
  rating: ProductRating.optional(),
  /** The shop's name: "Lakeland". */
  store: z.string().max(80).optional(),
  brand: z.string().max(80).optional(),
  availability: ProductAvailability.optional(),
  /** A few short facts worth comparing: "1.7 litres", "Keeps warm for 30 minutes". */
  highlights: z.array(z.string().min(1).max(120)).max(5).optional(),
  /** A line or two from the page. */
  description: z.string().max(400).optional(),
});
export type ProductItem = z.infer<typeof ProductItem>;

/** The most products one view shows. */
export const PRODUCTS_MAX = 12;

export const ProductsView = z.object({
  kind: z.literal('products'),
  items: z.array(ProductItem).min(1).max(PRODUCTS_MAX),
  /** The person is choosing between these: open side by side. */
  compare: z.boolean().optional(),
});
export type ProductsView = z.infer<typeof ProductsView>;
