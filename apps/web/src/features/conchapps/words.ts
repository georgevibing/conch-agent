/**
 * What an app says about itself, worked out once from the protocol's words
 * (ADR 0061), so the chat card, the app's page and the preview read the same
 * sentence. Nacre draws them; it doesn't know the protocol.
 */
import {
  appAbilities,
  appSourceLine,
  describeChanges,
  type ConchAppChanges,
  type ConchAppManifest,
  type ConchAppSource,
  type ConchAppTool,
  type SkillSignature,
} from '@conch/protocol';
import type { AppWords } from '@conch/nacre';

export function appWords({
  manifest,
  tools,
  source,
  signature,
  changes,
}: {
  manifest: ConchAppManifest;
  tools: readonly ConchAppTool[];
  source: ConchAppSource;
  signature: SkillSignature;
  changes?: ConchAppChanges;
}): AppWords {
  return {
    abilities: appAbilities(manifest, tools),
    from: appSourceLine(source, signature),
    ...(changes && { changes: describeChanges(changes, { manifest, tools }) }),
  };
}

/** 1536 → "2 KB": how much an app keeps, in words. */
export function sizeInWords(bytes: number): string {
  if (bytes <= 0) return 'Nothing kept yet';
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} ${units[unit]}`;
}

/** `capp_tally` → `tally`: the app's own id from its card's. */
export const appIdOf = (integrationId: string | undefined) =>
  integrationId?.startsWith('capp_') ? integrationId.slice(5) : undefined;

/** An app's page: `/apps/capp_tally` (its card's address). */
export const conchAppPath = (id: string) => `/apps/capp_${encodeURIComponent(id)}`;

/** One of its pages, on a page of its own: `/apps/capp_tally/main`. */
export const conchPagePath = (id: string, pageId: string) =>
  `${conchAppPath(id)}/${encodeURIComponent(pageId)}`;
