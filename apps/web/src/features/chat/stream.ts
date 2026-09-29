/** Helpers for rendering a reply while it streams. Pure, so they're cheap to test. */

export interface Block {
  text: string;
  /** Offset of the block in the full text. */
  start: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Split Markdown into top-level blocks at blank lines (never inside a code
 * fence, never before an indented continuation), so finished blocks can be
 * memoised and only the growing tail is re-parsed on every frame.
 */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let fence: string | undefined;
  let start = 0;
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker.charAt(0);
      else if (marker.charAt(0) === fence) fence = undefined;
    }
    offset += line.length + 1;
    const next = lines[i + 1];
    if (
      !fence &&
      line.trim() === '' &&
      next !== undefined &&
      next.trim() !== '' &&
      !/^\s/.test(next)
    ) {
      blocks.push({ text: text.slice(start, offset), start });
      start = offset;
    }
  }
  if (start < text.length) blocks.push({ text: text.slice(start), start });
  return blocks;
}

/**
 * Close Markdown that's still open mid-stream (a code fence, `**bold`, an
 * `inline code` span) so half-arrived syntax renders as what it will become
 * instead of flashing raw asterisks and backticks.
 */
export function closeOpenMarkdown(text: string): string {
  let fence: string | undefined;
  const prose: string[] = [];
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (marker && (!fence || marker.charAt(0) === fence.charAt(0))) {
      fence = fence ? undefined : marker;
      continue;
    }
    if (!fence) prose.push(line);
  }
  if (fence) return `${text}\n${fence}`;
  const lastParagraph =
    prose
      .join('\n')
      .split(/\n\s*\n/)
      .at(-1) ?? '';
  const withoutCode = lastParagraph.replace(/`[^`]*`/g, '');
  let suffix = '';
  if ((lastParagraph.match(/`/g)?.length ?? 0) % 2 === 1) suffix += '`';
  else if ((withoutCode.match(/\*\*/g)?.length ?? 0) % 2 === 1) suffix += '**';
  return suffix ? text.trimEnd() + suffix : text;
}

/* ── Verbs: what the wait says ──────────────────────────────────────────── */

export type ThinkingPhase = 'starting' | 'thinking' | 'after-tool';

const THEMES: [RegExp, string[]][] = [
  [
    /\b(bug|error|fix|broken|crash|fail|failing|issue|wrong|debug)\w*/i,
    ['Tracing the problem', 'Following the clues', 'Narrowing it down', 'Testing a theory'],
  ],
  [
    /\b(write|draft|email|letter|reply|post|story|poem|essay|message|rewrite)\w*/i,
    ['Finding the words', 'Sketching a draft', 'Choosing the tone', 'Polishing phrases'],
  ],
  [
    /\b(summar|tl;?dr|recap|digest|overview)\w*/i,
    ['Reading closely', 'Finding what matters', 'Distilling it'],
  ],
  [/\btranslat\w*/i, ['Finding the words', 'Carrying the meaning across']],
  [
    /\b(plan|design|architect|idea|brainstorm|strategy|should i|options?)\b/i,
    ['Sketching options', 'Weighing trade-offs', 'Mapping it out', 'Looking for the elegant path'],
  ],
  [
    /\b(code|function|refactor|repo|build|implement|component|test|api|script|class)\w*/i,
    ['Reading the code', 'Mapping the pieces', 'Planning the change', 'Checking the edges'],
  ],
  [
    /\b(explain|why|how|what|understand|mean|difference|teach)\b/i,
    ['Untangling it', 'Connecting the dots', 'Finding the clearest way', 'Shaping an explanation'],
  ],
];

const GENERAL = ['Thinking it through', 'Gathering thoughts', 'Diving deeper', 'Turning it over'];
const AFTER_TOOL = ['Taking that in', 'Reading the results', 'Piecing it together'];
const LONG = ['Diving deeper still', 'Worth getting right', 'Still with you'];

/**
 * The words the wait shows, chosen from what was asked: a bug gets "Tracing
 * the problem", an email gets "Finding the words". It always opens by
 * listening, and admits to a long think instead of pretending it's nearly done.
 */
export function verbsFor(prompt: string, phase: ThinkingPhase, elapsedMs = 0): string[] {
  if (phase === 'after-tool') return AFTER_TOOL;
  const themed = THEMES.find(([pattern]) => pattern.test(prompt))?.[1] ?? GENERAL;
  const verbs = elapsedMs > 25_000 ? [...themed, ...LONG] : themed;
  return phase === 'starting' ? ['Listening', ...verbs] : verbs;
}
