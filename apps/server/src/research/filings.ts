/**
 * How a company is doing, out of its own filings.
 *
 * From **SEC EDGAR**'s XBRL API (`data.sec.gov`), which is official, free and
 * needs no key — only a `User-Agent` that names the program, which the public
 * fetcher sends (`outside.ts` `USER_AGENT`). `company_tickers.json` turns a
 * ticker or a company's name into its CIK; `companyconcept` gives one measure
 * across every filing that reported it, each with the form it was filed on
 * and the day it was filed.
 *
 * Two honesty rules live here:
 *
 * - **Only companies that file with the SEC have figures.** For anyone else —
 *   a European or Asian listing with no US filing — this returns nothing and
 *   the card says so in a sentence. It never substitutes a guess, a
 *   competitor's number, or a figure from somewhere else.
 * - **A figure never loses its period.** Each point keeps the period it
 *   covers, the day that period ended, the form and the filing date, so the
 *   card can always show where a number came from.
 */
import type { FiledFigure, FiledSeries } from '@conch/protocol';

import { getJson, numOf, rec, strOf, type OutsideDeps } from './outside';

const TICKERS = 'https://www.sec.gov/files/company_tickers.json';
const CONCEPT = 'https://data.sec.gov/api/xbrl/companyconcept/';

/** One row of the regulator's own ticker list. */
export interface Filer {
  cik: string;
  ticker: string;
  name: string;
}

/** The regulator's ticker list, as a lookup by ticker and by name. */
export interface FilerIndex {
  byTicker: Map<string, Filer>;
  all: Filer[];
}

/** `company_tickers.json`: `{ "0": { cik_str, ticker, title }, … }`. */
export function parseFilers(body: unknown): FilerIndex {
  const byTicker = new Map<string, Filer>();
  const all: Filer[] = [];
  for (const row of Object.values(rec(body))) {
    const fields = rec(row);
    const cik = numOf(fields.cik_str);
    const ticker = strOf(fields.ticker)?.toUpperCase();
    const name = strOf(fields.title);
    if (cik === undefined || !ticker || !name || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) continue;
    const filer: Filer = { cik: String(Math.trunc(cik)), ticker, name: name.slice(0, 140) };
    all.push(filer);
    if (!byTicker.has(ticker)) byTicker.set(ticker, filer);
  }
  return { byTicker, all };
}

/** The ten-digit, zero-padded form EDGAR wants: `CIK0000320193`. */
export const cikPath = (cik: string) => `CIK${cik.padStart(10, '0')}`;

/**
 * The filer a person means. A ticker wins; otherwise the company whose name
 * matches best — the shortest name that starts with what was typed, else the
 * shortest that contains it, so "apple" finds Apple Inc. and not
 * "Applewood Holdings".
 */
export function findFiler(index: FilerIndex, query: string): Filer | undefined {
  const text = query.trim().replace(/^\$/, '');
  if (!text) return undefined;
  const upper = text.toUpperCase();
  const exact = index.byTicker.get(upper) ?? index.byTicker.get(upper.replace(/\.[A-Z]{1,3}$/, ''));
  if (exact) return exact;
  /**
   * Words that could be a ticker ("APPLE", "AIR") only ever match a company's
   * whole name, never the start of one: otherwise an unlisted ticker would
   * quietly become somebody else's company.
   */
  const couldBeTicker = /^[A-Z]{1,6}$/.test(upper);
  const wanted = upper
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (wanted.length < 2) return undefined;
  const simple = (name: string) =>
    name
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(
        /\b(?:INC|CORP|CORPORATION|CO|COMPANY|PLC|LTD|LIMITED|SA|NV|AG|HOLDINGS|GROUP|CLASS [A-C]|COM|THE)\b/g,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
  let starts: Filer | undefined;
  let contains: Filer | undefined;
  for (const filer of index.all) {
    const name = simple(filer.name);
    if (!name) continue;
    if (name === wanted) return filer;
    if (couldBeTicker) continue;
    if (name.startsWith(wanted) && (!starts || name.length < simple(starts.name).length))
      starts = filer;
    else if (
      !starts &&
      wanted.length >= 4 &&
      name.includes(wanted) &&
      (!contains || name.length < simple(contains.name).length)
    )
      contains = filer;
  }
  return starts ?? contains;
}

/** One `companyconcept` fact, before it's sorted and thinned. */
interface Fact {
  value: number;
  start?: string;
  end: string;
  form?: string;
  filed?: string;
  frame?: string;
  fy?: number;
  fp?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The facts of one unit, read defensively. */
function facts(units: Record<string, unknown>, unit: string): Fact[] {
  const list = units[unit];
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const f = rec(raw);
    const value = numOf(f.val);
    const end = strOf(f.end);
    if (value === undefined || !end || !DATE.test(end)) return [];
    const start = strOf(f.start);
    const filed = strOf(f.filed);
    return [
      {
        value,
        ...(start && DATE.test(start) && { start }),
        end,
        ...(strOf(f.form) && { form: strOf(f.form)?.slice(0, 12) }),
        ...(filed && DATE.test(filed) && { filed }),
        ...(strOf(f.frame) && { frame: strOf(f.frame) }),
        ...(numOf(f.fy) !== undefined && { fy: Math.trunc(numOf(f.fy) ?? 0) }),
        ...(strOf(f.fp) && { fp: strOf(f.fp) }),
      },
    ];
  });
}

/** The period's name as the filing tells it: `CY2025` when it says so, else `FY2025`. */
function periodName(fact: Fact, basis: 'annual' | 'quarterly'): string {
  const frame = fact.frame;
  if (frame && /^CY\d{4}(Q[1-4])?$/.test(frame)) return frame;
  const year = fact.end.slice(0, 4);
  if (basis === 'annual') return `FY${year}`;
  const month = Number(fact.end.slice(5, 7));
  return `Q${Math.min(4, Math.max(1, Math.ceil(month / 3)))} ${year}`;
}

/**
 * The facts that cover one whole year (or one quarter), newest last, one per
 * period, each from the latest filing that reported it.
 */
export function periodFigures(
  units: Record<string, unknown>,
  unit: string,
  basis: 'annual' | 'quarterly',
  most: number,
  /** An instant measure (shares, employees) has no start date. */
  instant = false,
): FiledFigure[] {
  const window = basis === 'annual' ? [330, 400] : [75, 105];
  const kept = new Map<string, Fact>();
  for (const fact of facts(units, unit)) {
    if (!instant) {
      if (!fact.start) continue;
      const length = days(fact.start, fact.end);
      if (length < (window[0] ?? 0) || length > (window[1] ?? 0)) continue;
      // A whole year is reported on a 10-K (or a 20-F/40-F); a quarter on a 10-Q.
      if (basis === 'annual' && fact.form && !/^(?:10-K|20-F|40-F)/.test(fact.form)) continue;
    }
    const key = fact.end;
    const seen = kept.get(key);
    // The latest filing wins: a restated figure is the one the company stands behind.
    if (!seen || (fact.filed ?? '') >= (seen.filed ?? '')) kept.set(key, fact);
  }
  return [...kept.values()]
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-most)
    .map((fact) => ({
      value: fact.value,
      period: periodName(fact, basis),
      periodEnd: fact.end,
      ...(fact.form && { form: fact.form }),
      ...(fact.filed && { filed: fact.filed }),
    }));
}

export interface ConceptRequest {
  label: string;
  unit: FiledSeries['unit'];
  /** The taxonomy and tags to try, in order: the first that has figures wins. */
  taxonomy: 'us-gaap' | 'dei';
  tags: readonly string[];
  /** Which unit of the answer to read: `USD`, `USD/shares`, `shares`, `pure`. */
  measure: string;
  instant?: boolean;
}

/** The measures a fundamentals card draws, in the order it draws them. */
export const CONCEPTS: readonly ConceptRequest[] = [
  {
    label: 'Revenue',
    unit: 'currency',
    taxonomy: 'us-gaap',
    tags: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueNet',
    ],
    measure: 'USD',
  },
  {
    label: 'Gross profit',
    unit: 'currency',
    taxonomy: 'us-gaap',
    tags: ['GrossProfit'],
    measure: 'USD',
  },
  {
    label: 'Net income',
    unit: 'currency',
    taxonomy: 'us-gaap',
    tags: ['NetIncomeLoss', 'ProfitLoss'],
    measure: 'USD',
  },
  {
    label: 'Earnings per share',
    unit: 'perShare',
    taxonomy: 'us-gaap',
    tags: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    measure: 'USD/shares',
  },
  {
    label: 'Dividend per share',
    unit: 'perShare',
    taxonomy: 'us-gaap',
    tags: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
    measure: 'USD/shares',
  },
];

/** Shares outstanding, for working out what a company is worth at today's price. */
export const SHARES: ConceptRequest = {
  label: 'Shares outstanding',
  unit: 'shares',
  taxonomy: 'dei',
  tags: ['EntityCommonStockSharesOutstanding'],
  measure: 'shares',
  instant: true,
};

/** How many employees the company last told the regulator it had. */
export const EMPLOYEES: ConceptRequest = {
  label: 'Employees',
  unit: 'people',
  taxonomy: 'dei',
  tags: ['EntityNumberOfEmployees'],
  measure: 'pure',
  instant: true,
};

/** The regulator's answer for one concept: its facts, and the name it has for the company. */
export interface ConceptAnswer {
  tag: string;
  entityName?: string;
  units: Record<string, unknown>;
}

/** One measure out of EDGAR, trying each tag until one has figures. */
export async function readConcept(
  deps: Pick<OutsideDeps, 'fetcher'>,
  id: string,
  cik: string,
  concept: ConceptRequest,
  signal: AbortSignal,
): Promise<ConceptAnswer | undefined> {
  for (const tag of concept.tags) {
    const url = `${CONCEPT}${cikPath(cik)}/${concept.taxonomy}/${encodeURIComponent(tag)}.json`;
    const body = await getJson(deps, id, url, signal, 'SEC EDGAR').catch(() => undefined);
    if (!body) continue;
    const answer = rec(body);
    const units = rec(answer.units);
    if (!Array.isArray(units[concept.measure])) continue;
    return {
      tag,
      ...(strOf(answer.entityName) && { entityName: strOf(answer.entityName)?.slice(0, 140) }),
      units,
    };
  }
  return undefined;
}

/** The regulator's ticker list. */
export async function readFilers(
  deps: Pick<OutsideDeps, 'fetcher'>,
  id: string,
  signal: AbortSignal,
): Promise<FilerIndex> {
  const body = await getJson(deps, id, TICKERS, signal, 'SEC EDGAR');
  return parseFilers(body);
}

/** A concept's answer as a series the card can chart, or nothing when it had no figures. */
export function seriesOf(
  concept: ConceptRequest,
  answer: ConceptAnswer | undefined,
  basis: 'annual' | 'quarterly',
  most = 12,
): FiledSeries | undefined {
  if (!answer) return undefined;
  const points = periodFigures(answer.units, concept.measure, basis, most, concept.instant);
  if (!points.length) return undefined;
  return { label: concept.label, unit: concept.unit, tag: answer.tag, points };
}
