/**
 * Discover: skills people publish, found in a few public places and added
 * as one of yours in one press, after Conch has read every file in it
 * (ADR 0072). Nothing here is trusted because a registry said so: a skill
 * from a marketplace is downloaded at one fixed version, read by the same
 * scan as every other skill, held to its own list of what it may do, and
 * never runs anything when it's added.
 */
import { z } from 'zod';

import {
  MarketUrl,
  MarketId,
  MarketLicense,
  MarketPin,
  MarketPublisher,
  MarketSourceId,
  MarketTrust,
  marketText,
} from './market-basics';
import { SkillPermissions, SkillReview } from './skills';

export * from './market-basics';

/** The shelves on Discover. Conch sorts skills onto them from their own words. */
export const MarketCategory = z.enum([
  'writing',
  'documents',
  'design',
  'research',
  'productivity',
  'coding',
  'data',
  'business',
]);
export type MarketCategory = z.infer<typeof MarketCategory>;

export const MARKET_CATEGORY_LABELS: Record<MarketCategory, string> = {
  writing: 'Writing',
  documents: 'Documents',
  design: 'Design',
  research: 'Research',
  productivity: 'Everyday',
  coding: 'Coding',
  data: 'Data',
  business: 'Work',
};

/** A skill on a shelf: enough for a card. */
export const MarketListing = z.object({
  id: MarketId,
  source: MarketSourceId,
  /** "Anthropic", "skills.sh", "ClawHub". */
  sourceLabel: marketText(40),
  /** Its name in the Agent Skills format: `pdf-tools`. */
  name: marketText(80),
  /** In words: "PDF tools". */
  title: marketText(80),
  /** One plain line about what it does. */
  description: marketText(400),
  publisher: MarketPublisher,
  trust: MarketTrust,
  /** What the place itself says about its checks, in its words made plain. */
  trustNote: marketText(240).optional(),
  /** How many times people added it, as the place counts. */
  installs: z.number().int().nonnegative().optional(),
  stars: z.number().int().nonnegative().optional(),
  category: MarketCategory.optional(),
  /** Its page, on the place it's from or on GitHub. */
  url: MarketUrl,
  /** You have it: its id among your skills, and whether a newer version is there. */
  installed: z.object({ skillId: z.string().max(128), update: z.boolean().optional() }).optional(),
});
export type MarketListing = z.infer<typeof MarketListing>;

/** How one place answered, so the page can say "from before" calmly. */
export const MarketSourceState = z.object({
  id: MarketSourceId,
  label: marketText(40),
  state: z.enum(['ok', 'offline', 'limited', 'off']),
  /** When what's shown was fetched. */
  at: z.number().optional(),
});
export type MarketSourceState = z.infer<typeof MarketSourceState>;

/** `GET /api/skills/market?q=&category=` */
export const MarketQuery = z.object({
  q: z.string().trim().max(200).optional(),
  category: MarketCategory.optional(),
  source: MarketSourceId.optional(),
});
export type MarketQuery = z.infer<typeof MarketQuery>;

export const MarketResults = z.object({
  listings: z.array(MarketListing),
  sources: z.array(MarketSourceState),
  /** Something didn't answer, and what's shown came from Conch's copy from before. */
  stale: z.boolean().optional(),
});
export type MarketResults = z.infer<typeof MarketResults>;

/** A file that's different in an update. */
export const MarketFileChange = z.object({
  path: marketText(300),
  change: z.enum(['added', 'removed', 'changed']),
  /** A unified diff of a text file, capped; absent for a file that isn't text. */
  diff: z.string().max(40_000).optional(),
});
export type MarketFileChange = z.infer<typeof MarketFileChange>;

/** What an update changes, read before it's taken. */
export const MarketChanges = z.object({
  files: z.array(MarketFileChange),
  /** What it may do now and before: a wider list is said first. */
  permissions: z.object({ before: SkillPermissions, after: SkillPermissions }),
  /** It asks to do more than before. */
  wider: z.boolean(),
  from: MarketPin,
});
export type MarketChanges = z.infer<typeof MarketChanges>;

/**
 * A skill downloaded and read, waiting for a yes (`POST
 * /api/skills/market/preview`). Nothing is added until `install` names this
 * `previewId`, and what's added is exactly what was read here.
 */
export const MarketPreview = z.object({
  previewId: z.string().regex(/^mp_[A-Za-z0-9_-]{8,64}$/),
  listing: MarketListing,
  pin: MarketPin,
  /** What Conch saw reading every file in it. */
  review: SkillReview,
  /** What it may do while it's in use, from its own front matter. */
  permissions: SkillPermissions,
  /** Its instructions, as the assistant would read them (capped). */
  instructions: z.string().max(60_000),
  /** Other files in it, relative. */
  files: z.array(marketText(300)),
  license: MarketLicense,
  /** Why it can't be added, in one sentence; absent when it can. */
  blocked: marketText(300).optional(),
  /** For an update: what's different from the version you have. */
  changes: MarketChanges.optional(),
});
export type MarketPreview = z.infer<typeof MarketPreview>;

export const MarketPreviewBody = z.object({ id: MarketId }).strict();
export type MarketPreviewBody = z.infer<typeof MarketPreviewBody>;

/** Add what was read. A worrying one needs the review's hash, as turning one on does (ADR 0028). */
export const MarketInstallBody = z
  .object({
    previewId: MarketPreview.shape.previewId,
    /** On by itself when a request fits, or only when asked for. */
    mode: z.enum(['auto', 'manual']).default('auto'),
    acknowledged: z.string().max(128).optional(),
  })
  .strict();
export type MarketInstallBody = z.infer<typeof MarketInstallBody>;

/** Take an update that was read (`POST /api/skills/:id/market/update`). */
export const MarketUpdateBody = z
  .object({
    previewId: MarketPreview.shape.previewId,
    acknowledged: z.string().max(128).optional(),
  })
  .strict();
export type MarketUpdateBody = z.infer<typeof MarketUpdateBody>;

/** A starting point for someone who doesn't know what to look for. */
export interface MarketIdea {
  id: string;
  /** "Turn notes into slides". */
  label: string;
  /** What's searched when it's picked. */
  query: string;
  category: MarketCategory;
}

/**
 * Ideas on Discover: the everyday things people ask an assistant to get
 * better at, in their words, each a search.
 */
export const MARKET_IDEAS: readonly MarketIdea[] = [
  {
    id: 'slides',
    label: 'Turn notes into slides',
    query: 'presentation slides',
    category: 'documents',
  },
  { id: 'emails', label: 'Write clearer emails', query: 'email writing', category: 'writing' },
  { id: 'brand', label: 'Keep to a brand’s look', query: 'brand guidelines', category: 'design' },
  { id: 'research', label: 'Research a topic properly', query: 'research', category: 'research' },
  {
    id: 'meeting',
    label: 'Tidy up meeting notes',
    query: 'meeting notes',
    category: 'productivity',
  },
  {
    id: 'spreadsheet',
    label: 'Make sense of a spreadsheet',
    query: 'spreadsheet data analysis',
    category: 'data',
  },
  { id: 'poster', label: 'Design a poster', query: 'poster design', category: 'design' },
  {
    id: 'website',
    label: 'Build a small website',
    query: 'frontend design website',
    category: 'coding',
  },
];
