/**
 * A person's answer about a memory (ADR 0087): the only thing that lets a
 * memory past the memory check. Remember it, Remember anyway, Edit first,
 * Keep and Undo on a tidy-up, and what you add or edit on What Conch knows.
 *
 * A token is minted only by the HTTP routes that handle those answers
 * (`memory/routes.ts`, behind the gateway's host, origin and sign-in checks),
 * and only a token minted here passes: the store keeps them in a `WeakSet`,
 * so an object that merely looks like one is refused. `consent.test.ts`
 * holds the code to "only the routes mint".
 */

declare const brand: unique symbol;

/** What the person did. */
export type ConsentAction = 'add' | 'edit' | 'keep' | 'anyway' | 'tidy';

export interface PersonConsent {
  readonly [brand]: true;
  readonly action: ConsentAction;
}

const minted = new WeakSet<object>();

/**
 * Mint the token for one answer a person gave over HTTP. Call it only from
 * the route that handles that answer; nothing an assistant can reach.
 */
export function mintConsent(
  request: { readonly method: string; readonly url: string },
  action: ConsentAction,
): PersonConsent {
  if (request.method === 'GET') throw new Error('A person’s answer is never a GET.');
  const token = Object.freeze({ action }) as PersonConsent;
  minted.add(token);
  return token;
}

/** Whether this is a token a route minted (not one that only looks like it). */
export function isConsent(value: unknown): value is PersonConsent {
  return typeof value === 'object' && value !== null && minted.has(value);
}
