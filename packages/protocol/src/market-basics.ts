/**
 * The parts of Discover (ADR 0074) a skill of yours carries: where it came
 * from, who published it, and the version it's pinned to. Kept apart from
 * `skill-market.ts` so `skills.ts` can use them without a cycle.
 */
import { z } from 'zod';

/** The places Conch looks (ADR 0074 says why these and not others). */
export const MarketSourceId = z.enum([
  /** Anthropic's own skills on GitHub (`anthropics/skills`), the openly licensed ones. */
  'anthropic',
  /** skills.sh, Vercel's directory of skills kept in GitHub repositories. */
  'skills-sh',
  /** ClawHub, OpenClaw's registry. */
  'clawhub',
]);
export type MarketSourceId = z.infer<typeof MarketSourceId>;

/**
 * One skill in one place: `<source>:<its key there>`. The key is a GitHub
 * `owner/repo/path` or a registry's own slug, never a URL.
 */
export const MarketId = z
  .string()
  .max(240)
  .regex(
    /^(?:anthropic|skills-sh|clawhub):[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*){0,8}$/,
    'Invalid skill.',
  )
  .refine(
    (id) => !id.split(/[:/]/).some((part) => part === '.' || part === '..'),
    'Invalid skill.',
  );
export type MarketId = z.infer<typeof MarketId>;

export const marketText = (max: number) => z.string().max(max);
export const MarketUrl = z
  .string()
  .max(500)
  .regex(/^https:\/\/[^\s"'<>]+$/, 'Invalid address.');

/** Who published it, as the place says. Only GitHub's own account or a registry's handle. */
export const MarketPublisher = z.object({
  name: marketText(80),
  /** The account it's under: `anthropics`, `vercel-labs`, a ClawHub handle. */
  handle: marketText(80).optional(),
  url: MarketUrl.optional(),
});
export type MarketPublisher = z.infer<typeof MarketPublisher>;

/**
 * How far to trust it before Conch has read it, from what the place itself
 * says. The scan, the list of what it may do and the pin still apply to all.
 */
export const MarketTrust = z.enum([
  /** Published by the company that makes the models, in its own repository. */
  'official',
  /** The registry vouches for who published it (a verified publisher or an organisation it knows). */
  'verified',
  /** Anyone could have published it. */
  'community',
  /** The registry warns about it (a suspicious scan, held for review). */
  'flagged',
  /** The registry found harmful code in it, or took it down: never added. */
  'blocked',
]);
export type MarketTrust = z.infer<typeof MarketTrust>;

/**
 * Exactly what's added: a commit of a GitHub repository, or a registry's
 * version and the SHA-256 of what it served. Never a branch or "latest".
 */
export const MarketPin = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('commit'),
    owner: marketText(40),
    repo: marketText(100),
    /** The skill's folder in it. */
    path: marketText(300),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  z.object({
    kind: z.literal('version'),
    version: marketText(64),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);
export type MarketPin = z.infer<typeof MarketPin>;

/** What its licence lets you do, as far as Conch can tell. */
export const MarketLicense = z.object({
  /** "Apache-2.0", "MIT", "Proprietary", or what the file starts with. */
  name: marketText(80).optional(),
  /** `open`: you may copy and use it; `restricted`: only inside its maker's own apps; `unknown`: it doesn't say. */
  kind: z.enum(['open', 'restricted', 'unknown']),
});
export type MarketLicense = z.infer<typeof MarketLicense>;

/** Where one of your skills came from, when it came from Discover. */
export const SkillOrigin = z.object({
  source: MarketSourceId,
  sourceLabel: marketText(40),
  listingId: MarketId,
  publisher: MarketPublisher,
  trust: MarketTrust,
  pin: MarketPin,
  url: MarketUrl,
  license: MarketLicense.optional(),
  installedAt: z.number(),
  /** A newer version is there (looked at most once a day). */
  update: z.boolean().optional(),
});
export type SkillOrigin = z.infer<typeof SkillOrigin>;
