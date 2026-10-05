/**
 * A person's answer about a memory (ADR 0087): the only thing that lets a
 * memory past the memory check. Remember it, Remember anyway, Edit first,
 * Keep and Undo on a tidy-up, and what you add or edit on What Conch knows.
 *
 * A token is minted only by the HTTP routes that take those answers
 * (`memory/routes.ts`, behind the gateway's sign-in, host and origin checks;
 * a test holds the code to that). Each one is bound to the memory it's about
 * and to the exact words the person saw or wrote (a SHA-256 of their
 * canonical form), and is good once: the store spends it. A token that wasn't
 * minted here, was spent already, or is about other words or another memory
 * is no answer at all.
 */
import { createHash } from 'node:crypto';

import { canonical } from './guard';

declare const brand: unique symbol;

/** What the person did. */
export type ConsentAction = 'add' | 'edit' | 'keep' | 'anyway' | 'tidy';

/** A new memory has no id yet: its token is for these words, as a new one. */
export const NEW_MEMORY = 'new';

export interface PersonConsent {
  readonly [brand]: true;
  readonly action: ConsentAction;
  /** The memory it's about (`NEW_MEMORY` for one being added). */
  readonly id: string;
  /** SHA-256 of the canonical words the person saw or wrote. */
  readonly hash: string;
}

/** The fingerprint of a memory's words, in the form that's checked and kept. */
export function wordsHash(content: string): string {
  return createHash('sha256').update(canonical(content)).digest('hex');
}

const minted = new WeakSet<object>();

/**
 * Mint the token for one answer a person gave over HTTP, about one memory and
 * the words they saw. Call it only from the route that takes that answer.
 */
export function mintConsent(
  request: { readonly method: string; readonly url: string },
  action: ConsentAction,
  about: { id: string; content: string },
): PersonConsent {
  if (request.method === 'GET') throw new Error('A person’s answer is never a GET.');
  const token = Object.freeze({ action, id: about.id, hash: wordsHash(about.content) });
  minted.add(token);
  return token as unknown as PersonConsent;
}

/** Whether this is a live token a route minted (not spent, not one that only looks like it). */
export function isConsent(value: unknown): value is PersonConsent {
  return typeof value === 'object' && value !== null && minted.has(value);
}

/**
 * Spend a token on one write: it must be live, about this memory (`NEW_MEMORY`
 * for one being added), and for exactly these words. Once spent it's no answer any more.
 */
export function spendConsent(value: unknown, id: string, content: string): boolean {
  if (!isConsent(value)) return false;
  if (value.id !== id || value.hash !== wordsHash(content)) return false;
  minted.delete(value);
  return true;
}
