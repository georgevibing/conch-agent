import { z } from 'zod';

export const PublishedRelease = z.object({
  tag: z.string(),
  version: z.string(),
  channel: z.enum(['stable', 'beta', 'alpha']),
  commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  name: z.string(),
  notes: z.string(),
  published: z.string().datetime(),
  downloads: z.boolean(),
});
export type PublishedRelease = z.infer<typeof PublishedRelease>;

export const SitePublication = z.object({
  channel: z.enum(['stable', 'development']),
  commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  tag: z.string().optional(),
  next: z.boolean(),
  releases: z.array(PublishedRelease),
});
export type SitePublication = z.infer<typeof SitePublication>;

export const GitHubRelease = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable().optional(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().datetime().nullable(),
  assets: z.array(z.object({ name: z.string(), state: z.string(), size: z.number() })),
});
