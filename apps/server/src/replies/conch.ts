/**
 * Conch's own replies to send next (ADR 0060 §5), read from the finished reply
 * itself: a table of numbers gets “Show it as a chart”. They need no model and
 * work with every provider, so they're also what a chat-only model gets.
 *
 * Adding one (AGENTS.md agreement 14): a rule in `RULES`, with rows in
 * `conch.test.ts` for the replies it fits and the ones it must leave alone. A
 * chip nobody wanted is worse than none, so a rule only fires when the reply
 * itself shows it fits.
 */
import type { ReplySuggestion } from '@conch/protocol';

import { MAX_REPLIES } from './tools';

/** A Markdown table in a reply: its header cells and each row's cells. */
export interface ReplyTable {
  header: string[];
  rows: string[][];
}

/** A finished reply, as a rule reads it. */
export interface FinishedReply {
  /** The reply's words, Markdown as written. */
  text: string;
  /** Its Markdown tables, outside code blocks (read once, when first asked for). */
  tables(): ReplyTable[];
}

export interface ConchRule {
  /** For tests and logs: `chart-table`. */
  id: string;
  /** The words on the chip, and the words sent. */
  text: string;
  /**
   * What answering it takes: `tools` when the assistant needs Conch's tools to
   * do it (a chart is an artifact, ADR 0034). A model that can only chat
   * (ADR 0050) isn't offered what it couldn't do.
   */
  needs?: 'tools';
  fits(reply: FinishedReply): boolean;
}

// ── Tables ──────────────────────────────────────────────────────────────────

const cellsOf = (line: string): string[] => {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
};

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line) || /\S\s*\|\s*\S/.test(line);
const isDivider = (line: string) => {
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

/** The GitHub-style tables in Markdown, leaving out anything inside a code block. */
export function markdownTables(text: string): ReplyTable[] {
  const lines = text.split(/\r?\n/);
  const tables: ReplyTable[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;
    const next = lines[i + 1];
    if (!isRow(line) || next === undefined || !isDivider(next)) continue;
    const header = cellsOf(line);
    if (cellsOf(next).length !== header.length) continue;
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && isRow(lines[j] ?? ''); j++) rows.push(cellsOf(lines[j] ?? ''));
    tables.push({ header, rows });
    i = j - 1;
  }
  return tables;
}

/** Markdown emphasis and code marks around a cell's words. */
const plain = (cell: string) => cell.replace(/[*_`~]/g, '').trim();

/**
 * A number as a person writes one in a table: “1,200”, “−3.5”, “$12k”, “48%”,
 * “4.2 kg”, “£1.1m”. Not a date, a time, a version or a phone number.
 */
const NUMBER =
  /^[-+−]?\s?[$€£¥]?\s?(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d+)?\s?(?:%|°[cf]?|[a-zµ]{1,3})?$/i;
export const isNumber = (cell: string) => NUMBER.test(plain(cell));

/**
 * What a number is counted in: its money sign and its unit, “$” or “kg” or
 * “%”. “k” and “m” are how big, not what of: “$800k” and “$1.2m” are both “$”.
 */
const unitOf = (cell: string) => {
  const text = plain(cell);
  const money = /[$€£¥]/.exec(text)?.[0] ?? '';
  const after = text.replace(/^.*\d/, '').trim().toLowerCase();
  return `${money}|${/^(k|m|bn|b)$/.test(after) ? '' : after}`;
};

const isGap = (cell: string) => !cell || /^[-–—]$/.test(cell);

/**
 * Worth a chart: the numbers are the point of the table, not a detail beside
 * the words. Three rows or more (two numbers read as well as they'd draw), a
 * column of numbers after the first (the first names the rows: “Year | Event”
 * is a list, not data) counted in one unit and not the same in every row, and
 * more such columns than columns of words: a list of things with a reason and
 * a price each is a list to read. Empty cells and dashes are gaps, not words.
 */
export function chartable(table: ReplyTable): boolean {
  if (table.rows.length < 3 || table.header.length < 2) return false;
  let measures = 0;
  let words = 0;
  for (let column = 1; column < table.header.length; column++) {
    const cells = table.rows.map((row) => plain(row[column] ?? '')).filter((c) => !isGap(c));
    if (cells.length >= 3 && cells.every(isNumber)) {
      const oneUnit = new Set(cells.map(unitOf)).size === 1;
      const varies = new Set(cells.map((c) => c.replace(/\s/g, ''))).size > 1;
      if (oneUnit && varies) measures++;
    } else if (cells.length * 2 >= table.rows.length && !cells.every(isNumber)) words++;
  }
  return measures > 0 && measures > words;
}

// ── The rules ───────────────────────────────────────────────────────────────

/** A table of numbers: see it drawn. */
const chartTable: ConchRule = {
  id: 'chart-table',
  text: 'Show it as a chart',
  needs: 'tools',
  fits: (reply) => reply.tables().some(chartable),
};

/** Conch's own rules, in the order their chips are shown. */
export const RULES: readonly ConchRule[] = [chartTable];

/** A reply as rules read it: its tables parsed once, when a rule first asks. */
export function finishedReply(text: string): FinishedReply {
  let tables: ReplyTable[] | undefined;
  return { text, tables: () => (tables ??= markdownTables(text)) };
}

/**
 * Conch's chips for a finished reply: each rule that fits, in order, at most
 * three. `tools: false` for a model that can only chat.
 */
export function conchReplies(
  text: string,
  options: { tools: boolean },
  rules: readonly ConchRule[] = RULES,
): ReplySuggestion[] {
  if (!text.trim()) return [];
  const reply = finishedReply(text);
  const out: ReplySuggestion[] = [];
  for (const rule of rules) {
    if (rule.needs === 'tools' && !options.tools) continue;
    if (out.some((r) => r.text === rule.text) || !rule.fits(reply)) continue;
    out.push({ text: rule.text });
    if (out.length === MAX_REPLIES) break;
  }
  return out;
}
