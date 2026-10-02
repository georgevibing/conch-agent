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
  /** Made by you, by hand (ADR 0039): the assistant builds on it rather than over it. */
  edited: z.boolean().optional(),
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

// ── Edit by hand (ADR 0039) ─────────────────────────────────────────────

/** "Line 3, near column 5": where `JSON.parse` stopped, in the words of the editor's gutter. */
function jsonWhere(content: string, error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const at = /line (\d+) column (\d+)/i.exec(message);
  if (at) return `on line ${at[1]}, near column ${at[2]}`;
  const position = /position (\d+)/i.exec(message);
  if (!position) return '';
  const before = content.slice(0, Number(position[1]));
  const line = before.split('\n').length;
  return `on line ${line}, near column ${before.length - before.lastIndexOf('\n')}`;
}

/** A chart that doesn't fit `ChartSpec`, said the way a person would fix it. */
function chartProblem(content: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    const where = jsonWhere(content, error);
    return `The chart’s JSON has a mistake${where ? ` ${where}` : ''}: look for a missing comma, quote or bracket.`;
  }
  const spec = ChartSpec.safeParse(json);
  if (!spec.success) {
    const issue = spec.error.issues[0];
    const path = (issue?.path ?? []).map((p) => (typeof p === 'number' ? p + 1 : String(p)));
    const [top, index, field, value] = path;
    if (top === 'type') return 'A chart’s "type" is one of "bar", "line", "area" or "pie".';
    if (top === 'labels' && index === undefined) return 'A chart needs a list of "labels".';
    if (top === 'labels') return `Label ${index} isn’t text, or is too long.`;
    if (top === 'series' && index === undefined)
      return 'A chart needs at least one series, and at most 8.';
    if (top === 'series' && field === 'values' && value !== undefined)
      return `Value ${value} of series ${index} isn’t a number.`;
    if (top === 'series' && field === 'values')
      return `Series ${index} needs a list of "values" (numbers).`;
    if (top === 'series' && field === 'name') return `Series ${index} needs a "name".`;
    return `The chart’s "${path.join('.') || 'spec'}" doesn’t fit: ${issue?.message ?? 'it’s not right'}.`;
  }
  const short = spec.data.series.find((s) => s.values.length !== spec.data.labels.length);
  if (short)
    return `Each series needs one value per label: “${short.name}” has ${short.values.length} and there ${spec.data.labels.length === 1 ? 'is 1 label' : `are ${spec.data.labels.length} labels`}.`;
  return undefined;
}

/** The delimiter a table uses: commas, unless its header is clearly tabs or semicolons. */
export function tableDelimiter(csv: string): ',' | '\t' | ';' {
  const first = csv.split(/\r?\n/, 1)[0] ?? '';
  if (first.includes('\t') && !first.includes(',')) return '\t';
  if (first.includes(';') && !first.includes(',')) return ';';
  return ',';
}

/** A table that won't read as rows, with the line to look at. */
function tableProblem(csv: string): string | undefined {
  const delimiter = tableDelimiter(csv);
  const rows: { line: number; cells: number }[] = [];
  let cells = 1;
  let quoted = false;
  let line = 1;
  let start = 1;
  let quoteLine = 0;
  let empty = true;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') i++;
      else if (c === '"') quoted = false;
      else if (c === '\n') line++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      quoteLine = line;
      empty = false;
    } else if (c === delimiter) {
      cells++;
      empty = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      if (!empty) rows.push({ line: start, cells });
      line++;
      start = line;
      cells = 1;
      empty = true;
    } else if (c !== ' ') empty = false;
  }
  if (quoted) return `A quote on line ${quoteLine} is never closed.`;
  if (!empty) rows.push({ line: start, cells });
  const header = rows[0];
  if (!header || rows.length < 2) return 'A table needs a header row and at least one row of data.';
  const odd = rows.find((r) => r.cells !== header.cells);
  if (odd)
    return `Line ${odd.line} has ${odd.cells} ${odd.cells === 1 ? 'value' : 'values'}, but the header has ${header.cells}.`;
  return undefined;
}

/**
 * What's wrong with content for its kind, in a sentence a person (or a
 * model) can act on; `undefined` when it's fine. The gateway refuses a
 * version that has one, and the editor says it as you type.
 */
export function artifactProblem(kind: ArtifactKind, content: string): string | undefined {
  if (!content.trim()) return 'It’s empty. Send the whole thing.';
  if (content.length > ARTIFACT_MAX)
    return `That’s more than ${ARTIFACT_MAX.toLocaleString('en')} characters.`;
  if (kind === 'chart') return chartProblem(content);
  if (kind === 'svg' && !/<svg[\s>]/i.test(content)) return 'An svg must start with <svg …>.';
  if (kind === 'table') return tableProblem(content);
  return undefined;
}

/** A version you made by hand. `base`: the version you started from. */
export const SaveArtifactVersionBody = z.object({
  content: z.string().min(1).max(ARTIFACT_MAX),
  base: z.number().int().positive(),
  /** Save even though a newer version came in while you were editing. */
  force: z.boolean().optional(),
});
export type SaveArtifactVersionBody = z.infer<typeof SaveArtifactVersionBody>;

/** A page you're editing, so its preview runs sealed off like any other (ADR 0039). */
export const ArtifactDraftBody = z.object({ content: z.string().max(ARTIFACT_MAX) });
export type ArtifactDraftBody = z.infer<typeof ArtifactDraftBody>;

export const ArtifactDraft = z.object({
  rev: z.number().int().nonnegative(),
  /** It has links or code that could send you elsewhere. */
  navigates: z.boolean(),
});
export type ArtifactDraft = z.infer<typeof ArtifactDraft>;

// ── Live data (ADR 0039) ─────────────────────────────────────────────────

/** How much a page may read, and how often. */
export const LIVE_DATA = {
  /** The biggest answer a page gets (bytes). */
  maxBytes: 1_000_000,
  /** How long Conch waits for one (ms). */
  timeoutMs: 10_000,
  /** Sources one page may declare. */
  maxSources: 8,
  /** A source's address, as the page wrote it. */
  maxTemplate: 300,
  /** The address Conch asks for, with the page's choices filled in. */
  maxUrl: 1024,
  /** Different addresses one page may read in an hour. */
  perHour: 30,
  /** The same address is read again after this long at most (ms); sooner, it's the last answer. */
  reuseMs: 15_000,
  /** The shortest auto-refresh (seconds). */
  minEvery: 60,
  /** How many values a number parameter may take (min to max, by step). */
  maxSteps: 10_000,
} as const;

export const DATA_SOURCE_NAME = /^[a-z][a-z0-9_-]{0,31}$/i;

/** What the page may put into a source's address: one of a list, or a number in a range. */
export const DataParam = z.union([
  z.object({ choices: z.array(z.string().min(1).max(64)).min(1).max(50) }).strict(),
  z
    .object({
      min: z.number().finite(),
      max: z.number().finite(),
      /** Numbers are rounded to this. Default 1. */
      step: z.number().positive().finite().optional(),
    })
    .strict(),
]);
export type DataParam = z.infer<typeof DataParam>;

/**
 * One source a page reads, declared in the page itself:
 * `<script type="application/conch-data">{"weather": {"url": "https://…?city={city}", …}}</script>`.
 * The host is fixed in the address; the page fills in only the `{name}`s,
 * and only with what `params` allows.
 */
export const DataSource = z
  .object({
    url: z.string().min(8).max(LIVE_DATA.maxTemplate),
    params: z.record(z.string().regex(DATA_SOURCE_NAME), DataParam).optional(),
    /** Read again every this many seconds while the page is open. */
    every: z.number().int().min(LIVE_DATA.minEvery).max(86_400).optional(),
  })
  .strict();
export type DataSource = z.infer<typeof DataSource>;

/** A source as the panel shows it: where it reads from, and whether you said it may. */
export const LiveDataSource = z.object({
  name: z.string(),
  url: z.string(),
  host: z.string(),
  every: z.number().optional(),
  /** On this computer (localhost): needs its own, explicit OK. */
  local: z.boolean(),
  allowed: z.boolean(),
  /** The host is allowed, but this address on it is new since. */
  changed: z.boolean(),
});
export type LiveDataSource = z.infer<typeof LiveDataSource>;

export const LiveDataInfo = z.object({
  sources: z.array(LiveDataSource),
  /** The page's sources don't read, in plain words. */
  problem: z.string().optional(),
  /** The chat it was made in read something untrusted (ADR 0028), as the card says it. */
  tainted: z.string().optional(),
});
export type LiveDataInfo = z.infer<typeof LiveDataInfo>;

/** One host a page may read from, which you allowed. */
export const LiveDataApproval = z.object({
  artifactId: z.string(),
  host: z.string(),
  /** The addresses on it you saw when you said yes. A different one asks again. */
  urls: z.array(z.string()).max(40),
  at: z.number(),
  /** It's on this computer, and you said that's fine too. */
  local: z.boolean().optional(),
});
export type LiveDataApproval = z.infer<typeof LiveDataApproval>;

export const LiveDataApprovals = z.object({
  approvals: z.array(LiveDataApproval.extend({ title: z.string() })),
});
export type LiveDataApprovals = z.infer<typeof LiveDataApprovals>;

/** Which version a page is: a saved one, or what you're editing. */
export const ArtifactVersionRef = z.union([z.number().int().positive(), z.literal('draft')]);
export type ArtifactVersionRef = z.infer<typeof ArtifactVersionRef>;

export const ApproveLiveDataBody = z.object({
  version: ArtifactVersionRef,
  host: z.string().min(1).max(253),
  /** Yes, even though it's on this computer. */
  local: z.boolean().optional(),
});
export type ApproveLiveDataBody = z.infer<typeof ApproveLiveDataBody>;

/** What a page asked for, by `postMessage`, passed on by the panel. */
export const LiveDataRequest = z.object({
  source: z.string().regex(DATA_SOURCE_NAME),
  params: z
    .record(z.string().regex(DATA_SOURCE_NAME), z.union([z.string().max(64), z.number().finite()]))
    .optional()
    .refine((p) => !p || Object.keys(p).length <= 10, 'Too many parameters.'),
});
export type LiveDataRequest = z.infer<typeof LiveDataRequest>;

export const LiveDataResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: z.number().int(),
    /** The answer's type, `application/json` or `text/csv`. */
    type: z.string(),
    body: z.string(),
    /** When it was read. */
    at: z.number(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['needs-approval', 'refused', 'failed', 'too-big', 'timeout', 'busy']),
    message: z.string(),
    host: z.string().optional(),
  }),
]);
export type LiveDataResult = z.infer<typeof LiveDataResult>;
