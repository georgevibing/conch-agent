/**
 * Show me (ADR 0034): things the assistant makes that you can see and use —
 * a page or a small app, a document, a picture, a diagram, a chart, a table —
 * beside the chat, with every version kept. Pin one and it's an app in the
 * sidebar that opens instantly, and can fetch fresh data on request.
 */
import { z } from 'zod';

export const ArtifactKind = z.enum([
  /** A page or a small app: HTML with its own CSS and JavaScript, run sealed off. */
  'html',
  /** A document, in Markdown. */
  'markdown',
  /** A picture or diagram, as SVG. */
  'svg',
  /** A diagram written in Mermaid (flowchart, sequence, timeline…). */
  'mermaid',
  /** A chart: a `ChartSpec` as JSON. */
  'chart',
  /** A table: CSV with a header row. */
  'table',
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/** The biggest version Conch keeps (characters). */
export const ARTIFACT_MAX = 400_000;
/** Versions kept per artifact; older ones go, the first always stays. */
export const ARTIFACT_VERSIONS = 30;

/** A chart, as data: Conch draws it, so it always looks right and reads aloud as a table. */
export const ChartSpec = z.object({
  type: z.enum(['bar', 'line', 'area', 'pie']),
  title: z.string().max(120).optional(),
  /** One label per point: the categories or the dates. */
  labels: z.array(z.string().max(60)).min(1).max(500),
  series: z
    .array(
      z.object({
        name: z.string().max(60),
        values: z.array(z.number().finite().nullable()).min(1).max(500),
      }),
    )
    .min(1)
    .max(8),
  /** What the numbers are: "€", "%", "visitors". */
  unit: z.string().max(20).optional(),
  /** Stack the series (bar and area). */
  stacked: z.boolean().optional(),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const ArtifactVersion = z.object({
  n: z.number().int().positive(),
  at: z.number(),
  /** What changed, in the assistant's words: "Added a dark mode". */
  note: z.string().max(200).optional(),
  size: z.number().int().nonnegative(),
  /** Made by a refresh rather than in the chat. */
  refreshed: z.boolean().optional(),
  /** This version has code or links that could send you elsewhere: shown with scripts off until allowed. */
  navigates: z.boolean().optional(),
});
export type ArtifactVersion = z.infer<typeof ArtifactVersion>;

export const Artifact = z.object({
  id: z.string(),
  title: z.string().min(1).max(80),
  kind: ArtifactKind,
  /** The chat it was made in. */
  conversationId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  versions: z.array(ArtifactVersion).min(1),
  /** In the sidebar as an app. */
  pinned: z.object({ at: z.number() }).optional(),
  /** What a refresh asks for: the request it was made from, in the person's words. */
  refresh: z.object({ prompt: z.string().max(4000) }).optional(),
  /** A refresh is running in this chat. */
  refreshing: z.string().optional(),
  /**
   * A page that can send you somewhere else (links out, forms, scripts that
   * navigate): it opens with its scripts off until you say it may run them.
   */
  navigates: z.boolean().optional(),
});
export type Artifact = z.infer<typeof Artifact>;

export const ArtifactContent = z.object({
  artifactId: z.string(),
  n: z.number().int().positive(),
  content: z.string(),
});
export type ArtifactContent = z.infer<typeof ArtifactContent>;

export const ArtifactList = z.object({ artifacts: z.array(Artifact) });
export type ArtifactList = z.infer<typeof ArtifactList>;

export const UpdateArtifactBody = z
  .object({
    title: z.string().trim().min(1).max(80),
    pinned: z.boolean(),
    /** Change what a refresh asks for. */
    refresh: z.string().trim().max(4000).nullable(),
  })
  .partial();
export type UpdateArtifactBody = z.infer<typeof UpdateArtifactBody>;

/** Where a file of each kind is saved, and what it is. */
export const ARTIFACT_FILES: Record<ArtifactKind, { ext: string; type: string }> = {
  html: { ext: 'html', type: 'text/html' },
  markdown: { ext: 'md', type: 'text/markdown' },
  svg: { ext: 'svg', type: 'image/svg+xml' },
  mermaid: { ext: 'mmd', type: 'text/plain' },
  chart: { ext: 'json', type: 'application/json' },
  table: { ext: 'csv', type: 'text/csv' },
};
