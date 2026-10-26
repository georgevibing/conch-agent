/**
 * Apps whose tools didn't reach this turn (ADR 0049): the prompt lists them as
 * connected, so without a word from Conch the model either calls tools that
 * aren't there or tells the person to reconnect what works. This note goes in
 * front of the person's message, for this turn only, in words a model can act on.
 */
import { scrub } from './probe';

/** One app the turn couldn't open, by its server name, and why (already scrubbed). */
export interface MissingApp {
  name: string;
  error: string;
}

/** What the model is told, or `undefined` when every app's tools are here. */
export function missingAppsNote(missing: readonly MissingApp[]): string | undefined {
  if (!missing.length) return undefined;
  const apps = missing.map(
    ({ name, error }) =>
      `\`${name}\`${error ? ` (${error.replace(/\s+/g, ' ').slice(0, 160)})` : ''}`,
  );
  return [
    `These apps are connected, but their tools didn’t load for this message: ${apps.join(', ')}.`,
    'Conch is checking them again. If the job needs one, reach it another way first: a program on this computer that does the same (signed in to the right account), or another connected app. Only if none can, tell the person in a sentence and offer to fix it from Apps.',
  ].join(' ');
}

/** Every server of a turn as missing, for a bridge that couldn't open at all. */
export function allMissing(servers: readonly string[], error: unknown): MissingApp[] {
  const why = scrub(error instanceof Error ? error.message : String(error ?? ''));
  return servers.map((name) => ({ name, error: why.slice(0, 160) }));
}
