/**
 * When a page changes (ADR 0056). The page is read through the same guard as
 * a sealed page's live data (`artifacts/live.ts`, ADR 0046): never this
 * computer, never your network, never Conch, every hop checked as it
 * connects. What's compared is the readable text, line by line, with times,
 * dates and "5 minutes ago" taken out; a change must still be there on a
 * second read, and lines that come and go are learned and ignored.
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import type { LiveDataResult } from '@conch/protocol';
import { convert } from 'html-to-text';

import { isLoopbackName, placeOf } from '../../artifacts/live';
import {
  SourceError,
  TriggerError,
  type CheckResult,
  type Happening,
  type SourceContext,
  type TriggerOf,
  type TriggerSource,
} from './types';

/** Read one address for a watch: GET, nobody's cookies, only `hosts`, never inward. */
export type PageFetch = (url: string, hosts: ReadonlySet<string>) => Promise<LiveDataResult>;

/** A change waits for a second read this long after it was first seen. */
export const CONFIRM_MS = 2 * 60_000;
const MAX_LINES = 3_000;
/** What's kept of a page to compare with (characters). */
const MAX_KEPT = 150_000;
const MAX_DIFF = 3_000;
/** Lines learned to come and go, kept per page. */
const MAX_VOLATILE = 300;

const SKIP = [
  'nav',
  'header',
  'footer',
  'aside',
  'script',
  'style',
  'noscript',
  'form',
  'button',
  'select',
  'img',
  'svg',
  'iframe',
  'video',
  'audio',
  'canvas',
  'template',
].map((selector) => ({ selector, format: 'skip' as const }));

/** The readable text of a page: its main part when it marks one, without the furniture. */
export function readableText(body: string, type: string): string {
  if (!/html|xml/i.test(type)) return body;
  const base = /<main[\s>]/i.test(body)
    ? ['main']
    : /<article[\s>]/i.test(body)
      ? ['article']
      : ['body'];
  return convert(body, {
    wordwrap: false,
    baseElements: { selectors: base, returnDomByDefault: true },
    limits: { maxInputLength: 3_000_000, maxDepth: 60, maxChildNodes: 20_000 },
    selectors: [
      ...SKIP,
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false } },
    ],
  });
}

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NOISE: RegExp[] = [
  // 2026-10-03, 2026-10-03T08:15:00Z
  /\b\d{4}-\d{2}-\d{2}(?:[t ][\d:.]+(?:z|[+-]\d{2}:?\d{2})?)?\b/gi,
  // 10/03/2026, 3.10.26
  /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g,
  // Oct 3, 2026 · 3 October 2026
  new RegExp(`\\b${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?\\b`, 'gi'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? ${MONTH}\\.?(?:,? \\d{4})?\\b`, 'gi'),
  // 8:15, 8:15:02 pm
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\b/gi,
  // 5 minutes ago, an hour ago, just now
  /\b(?:\d+|an?|one)\s+(?:sec(?:ond)?|min(?:ute)?|hour|hr|day|week|month|year)s?\s+ago\b/gi,
  /\b(?:just now|yesterday|today|tomorrow)\b/gi,
  // Mon, Tuesday
  /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b\.?,?/gi,
];

/** A line as it's compared: times, dates and "ago" out, spaces tidied. */
export function lineKey(line: string): string {
  let key = line.toLowerCase();
  for (const pattern of NOISE) key = key.replace(pattern, ' ');
  return key.replace(/\s+/g, ' ').trim();
}

/** The page's lines worth comparing, as shown and as compared. */
export function pageLines(text: string): { line: string; key: string }[] {
  const out: { line: string; key: string }[] = [];
  const seen = new Set<string>();
  let size = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const key = lineKey(line);
    // Nothing left but a number or a mark: a counter, a bullet.
    if (key.replace(/[\d\s.,:;|·•–—\-+%()/]/g, '').length < 2) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ line: line.slice(0, 500), key });
    size += Math.min(line.length, 500) + key.length;
    if (out.length >= MAX_LINES || size >= MAX_KEPT) break;
  }
  return out;
}

export interface PageDiff {
  added: string[];
  removed: string[];
}

export function diffLines(
  before: { line: string; key: string }[],
  after: { line: string; key: string }[],
  ignore: ReadonlySet<string> = new Set(),
): PageDiff {
  const had = new Set(before.map((l) => l.key));
  const has = new Set(after.map((l) => l.key));
  return {
    added: after.filter((l) => !had.has(l.key) && !ignore.has(l.key)).map((l) => l.line),
    removed: before.filter((l) => !has.has(l.key) && !ignore.has(l.key)).map((l) => l.line),
  };
}

const hashOf = (lines: { key: string }[]) =>
  createHash('sha256')
    .update(lines.map((l) => l.key).join('\n'))
    .digest('base64url')
    .slice(0, 22);

function diffText(url: string, diff: PageDiff): string {
  const out = [`Address: ${url}`, ''];
  let size = 0;
  const push = (prefix: string, lines: string[]) => {
    for (const line of lines) {
      if (size > MAX_DIFF) {
        out.push('[…]');
        return;
      }
      out.push(`${prefix} ${line}`);
      size += line.length;
    }
  };
  if (diff.added.length) {
    out.push('Added:');
    push('+', diff.added);
    out.push('');
  }
  if (diff.removed.length) {
    out.push('Removed:');
    push('-', diff.removed);
  }
  return out.join('\n').trim();
}

/** The host a watch may read, and its www twin (a redirect between them is common). */
export function hostsFor(url: string): Set<string> {
  const host = new URL(url).host.toLowerCase();
  const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  return new Set([host, twin]);
}

const shortAddress = (url: string) => {
  const u = new URL(url);
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  const text = `${u.host.replace(/^www\./, '')}${path}`;
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

export function describePage(trigger: TriggerOf<'page'>): string {
  return `When ${shortAddress(trigger.url)} changes`;
}

/** Why an address can't be watched, before it's ever read (the read checks again, as it connects). */
export function pageProblem(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'That isn’t a web address. It looks like https://example.com/page.';
  }
  if (url.protocol !== 'https:')
    return 'Conch only watches secure pages: use an address starting https://.';
  if (url.username || url.password) return 'Use the address without a name or password in it.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isLoopbackName(host) || host.endsWith('.local') || host.endsWith('.internal'))
    return 'Conch doesn’t watch pages on this computer or your own network.';
  if (isIP(host) && placeOf(host) !== 'public')
    return 'Conch doesn’t watch pages on this computer or your own network.';
  if (!host.includes('.') && !isIP(host)) return 'Use the page’s whole address, like example.com.';
  return undefined;
}

interface PageState {
  hash?: string;
  lines?: { line: string; key: string }[];
  candidate?: { hash: string; at: number; lines: { line: string; key: string }[] };
  volatile?: string[];
}

export function pageSource(fetchPage: PageFetch): TriggerSource<'page'> {
  const read = async (url: string) => {
    const result = await fetchPage(url, hostsFor(url));
    if (!result.ok) {
      if (result.reason === 'refused')
        throw new SourceError('needs-you', `Conch can’t watch this page: ${result.message}`);
      throw new SourceError('retry', result.message);
    }
    if (result.status >= 400)
      throw new SourceError(
        'retry',
        result.status === 404
          ? `${new URL(url).host} says this page isn’t there (404).`
          : `${new URL(url).host} answered with an error (${result.status}).`,
      );
    return pageLines(readableText(result.body, result.type));
  };

  return {
    kind: 'page',
    // A page that's down for an hour is usually back by itself; a day is worth saying.
    patience: 24 * 60 * 60_000,
    async validate(trigger) {
      const problem = pageProblem(trigger.url);
      if (problem) throw new TriggerError(problem);
      const url = new URL(trigger.url);
      url.hash = '';
      return { ...trigger, url: url.toString() };
    },
    describe: describePage,
    note: (t) =>
      `Conch reads the page every ${t.every >= 60 && t.every % 60 === 0 ? `${t.every / 60 === 1 ? 'hour' : `${t.every / 60} hours`}` : `${t.every} minutes`} and compares its words, not its layout, times or ads.`,
    taint: (t) => ({ kind: 'web', label: new URL(t.url).host.replace(/^www\./, '') }),
    every: (t) => t.every * 60_000,
    async check(ctx: SourceContext<TriggerOf<'page'>>): Promise<CheckResult> {
      const state = ctx.state as PageState;
      const lines = await read(ctx.trigger.url);
      const hash = hashOf(lines);
      const volatile = new Set(state.volatile ?? []);
      // The first read is what “changed” is measured from.
      if (!state.hash || !state.lines)
        return { happenings: [], state: { hash, lines, volatile: [...volatile] } };
      const baseline = state.lines;
      const save = (next: PageState): Record<string, unknown> => ({
        ...next,
        volatile: [...volatile].slice(-MAX_VOLATILE),
      });
      if (hash === state.hash) {
        // It went back: whatever the candidate added or took away comes and goes.
        if (state.candidate) {
          const flip = diffLines(baseline, state.candidate.lines);
          for (const l of [...flip.added, ...flip.removed]) volatile.add(lineKey(l));
        }
        return { happenings: [], state: save({ hash, lines: baseline }) };
      }
      const diff = diffLines(baseline, lines, volatile);
      if (!diff.added.length && !diff.removed.length)
        return { happenings: [], state: save({ hash, lines }) };
      if (!state.candidate || state.candidate.hash !== hash) {
        // A different change from the one waiting: what that one had and this hasn't comes and goes.
        if (state.candidate) {
          const now = new Set(lines.map((l) => l.key));
          for (const l of state.candidate.lines)
            if (!now.has(l.key) && !baseline.some((b) => b.key === l.key)) volatile.add(l.key);
        }
        return {
          happenings: [],
          state: save({
            hash: state.hash,
            lines: baseline,
            candidate: { hash, at: ctx.now, lines },
          }),
          again: CONFIRM_MS,
        };
      }
      // Seen twice: it changed.
      const happening: Happening = {
        id: `page:${hash}`,
        at: ctx.now,
        label: `the changes on ${shortAddress(ctx.trigger.url)}`,
        link: ctx.trigger.url,
        detail: diffText(ctx.trigger.url, diff),
      };
      return { happenings: [happening], state: save({ hash, lines }) };
    },
    async sample(ctx) {
      const lines = await read(ctx.trigger.url);
      return {
        id: `page-sample:${ctx.now}`,
        at: ctx.now,
        label: `${shortAddress(ctx.trigger.url)} as it is now`,
        link: ctx.trigger.url,
        detail: diffText(ctx.trigger.url, {
          added: lines.slice(0, 80).map((l) => l.line),
          removed: [],
        }),
      };
    },
  };
}
