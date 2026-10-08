/**
 * A knowledge card from Wikipedia: the article's own summary (its plain-text
 * opening, never its HTML), its picture kept as the chat's attachment, and a
 * few facts from Wikidata (born, died, population, founded…).
 *
 * Only the name asked about leaves the computer, to Wikipedia and Wikidata.
 */
import { KNOWLEDGE_EXTRACT_MAX, type KnowledgeFact, type KnowledgeView } from '@conch/protocol';

import { httpsUrl, plain } from './pageData';
import { capturePicture } from './pictures';
import { getJson, OutsideError, rec, strOf, numOf, type OutsideDeps } from './outside';

/** How wide a picture the card asks for: sharp at twice its drawn size. */
const PICTURE_WIDTH = 960;

/** A Wikipedia language code (`en`, `pt-br`, `zh-yue`), or `en`. */
export function wikiLang(raw: unknown): string {
  const lang = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(lang) ? lang : 'en';
}

/** An article's opening, cut at a sentence's end so it never stops mid-word. */
export function cutExtract(text: string, max = KNOWLEDGE_EXTRACT_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (end > max * 0.4) return head.slice(0, end + 1);
  return `${head.slice(0, head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : max - 1)}…`;
}

/**
 * The picture to fetch: the original when it's small enough, otherwise a
 * thumbnail about `PICTURE_WIDTH` wide (Wikimedia draws any width from the
 * `/NNNpx-` address, SVGs as PNG).
 */
export function pictureAddress(summary: Record<string, unknown>): string | undefined {
  const original = rec(summary.originalimage);
  const thumb = rec(summary.thumbnail);
  const originalUrl = strOf(original.source);
  const width = numOf(original.width) ?? 0;
  if (originalUrl && !/\.svg$/i.test(originalUrl) && width > 0 && width <= PICTURE_WIDTH)
    return originalUrl;
  const thumbUrl = strOf(thumb.source);
  if (thumbUrl && /\/thumb\//.test(thumbUrl) && /\/\d+px-/.test(thumbUrl))
    return thumbUrl.replace(/\/\d+px-/, `/${PICTURE_WIDTH}px-`);
  return thumbUrl ?? originalUrl;
}

const titlePath = (title: string) => encodeURIComponent(title.trim().replace(/ /g, '_'));

interface Found {
  summary: Record<string, unknown>;
  lang: string;
}

async function summaryOf(
  deps: OutsideDeps,
  id: string,
  lang: string,
  title: string,
  signal: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  const body = await getJson(
    deps,
    id,
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${titlePath(title)}?redirect=true`,
    signal,
    'Wikipedia',
  );
  const summary = rec(body);
  if (summary.type !== 'standard' || !strOf(summary.extract)) return undefined;
  return summary;
}

/** The article for a name: asked for directly, then searched for (skipping disambiguation pages). */
export async function findArticle(
  deps: OutsideDeps,
  id: string,
  lang: string,
  queries: readonly string[],
  signal: AbortSignal,
): Promise<Found | undefined> {
  for (const query of queries) {
    const direct = await summaryOf(deps, id, lang, query, signal);
    if (direct) return { summary: direct, lang };
  }
  const search = rec(
    await getJson(
      deps,
      id,
      `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(queries.at(-1) ?? '')}&limit=3`,
      signal,
      'Wikipedia',
    ),
  );
  const pages = Array.isArray(search.pages) ? search.pages.map(rec) : [];
  for (const page of pages.slice(0, 3)) {
    const key = strOf(page.key) ?? strOf(page.title);
    if (!key || /disambiguation|referred to by the same term/i.test(strOf(page.description) ?? ''))
      continue;
    const summary = await summaryOf(deps, id, lang, key, signal);
    if (summary) return { summary, lang };
  }
  return undefined;
}

// ── Facts, from Wikidata ────────────────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A Wikidata time (`+1452-04-15T00:00:00Z`, precision 11) in words: "15 April 1452". */
export function wikidataDate(time: string, precision = 11): string | undefined {
  const m = /^([+-])(\d{1,16})-(\d\d)-(\d\d)T/.exec(time);
  if (!m) return undefined;
  const bce = m[1] === '-';
  const year = Number(m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  const era = bce ? ' BC' : '';
  if (precision >= 11 && month && day) return `${day} ${MONTHS[month - 1]} ${year}${era}`;
  if (precision === 10 && month) return `${MONTHS[month - 1]} ${year}${era}`;
  if (precision === 9) return `${year}${era}`;
  if (precision === 8) return `${Math.floor(year / 10) * 10}s${era}`;
  if (precision === 7) {
    const century = Math.ceil(year / 100);
    const suffix =
      century % 100 >= 11 && century % 100 <= 13
        ? 'th'
        : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[century % 10] ?? 'th');
    return `${century}${suffix} century${era}`;
  }
  return precision > 9 ? `${year}${era}` : undefined;
}

type Claim = Record<string, unknown>;

/** A property's best claims: preferred ones, else the normal ones; never deprecated. */
function best(claims: Record<string, unknown>, property: string): Claim[] {
  const list = (Array.isArray(claims[property]) ? claims[property] : []).map(rec);
  const kept = list.filter((c) => c.rank !== 'deprecated');
  const preferred = kept.filter((c) => c.rank === 'preferred');
  return preferred.length ? preferred : kept;
}

const valueOf = (claim: Claim) => rec(rec(claim.mainsnak).datavalue).value;
const entityOf = (claim: Claim) => strOf(rec(valueOf(claim)).id);

function timeOf(claim: Claim): string | undefined {
  const v = rec(valueOf(claim));
  const time = strOf(v.time);
  return time ? wikidataDate(time, numOf(v.precision) ?? 11) : undefined;
}

/** The latest of several dated values (a population counted many times). */
function latest(claims: Claim[]): Claim | undefined {
  const when = (c: Claim) => {
    const point = (rec(c.qualifiers).P585 as unknown[] | undefined)?.[0];
    return strOf(rec(rec(rec(point).datavalue).value).time) ?? '';
  };
  return [...claims].sort((a, b) => when(b).localeCompare(when(a)))[0];
}

function quantity(claim: Claim | undefined, unit?: string): string | undefined {
  if (!claim) return undefined;
  const v = rec(valueOf(claim));
  const amount = Number(strOf(v.amount));
  if (!Number.isFinite(amount)) return undefined;
  if (unit === 'area') {
    if (!/Q712226$/.test(strOf(v.unit) ?? '')) return undefined;
    return `${amount.toLocaleString('en', { maximumFractionDigits: 1 })} km²`;
  }
  return Math.round(amount).toLocaleString('en');
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Up to eight facts for an item, in a reading order. Never throws: a card without facts is still a card. */
export async function wikidataFacts(
  deps: OutsideDeps,
  id: string,
  item: string,
  lang: string,
  signal: AbortSignal,
): Promise<KnowledgeFact[]> {
  if (!/^Q\d{1,12}$/.test(item)) return [];
  try {
    const body = rec(
      await getJson(
        deps,
        id,
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${item}&props=claims&format=json`,
        signal,
        'Wikidata',
      ),
    );
    const claims = rec(rec(rec(body.entities)[item]).claims);
    const one = (p: string) => best(claims, p)[0];
    const date = (p: string) => {
      const claim = one(p);
      return claim && timeOf(claim);
    };
    const entities = (p: string, n = 1) =>
      best(claims, p)
        .slice(0, n)
        .flatMap((c) => entityOf(c) ?? []);
    const wanted = {
      birthplace: entities('P19'),
      deathplace: entities('P20'),
      occupation: entities('P106', 2),
      country: entities('P17'),
      capital: entities('P36'),
      foundedBy: entities('P112', 2),
      hq: entities('P159'),
      location: entities('P276'),
    };
    const ids = [...new Set(Object.values(wanted).flat())].filter((q) => /^Q\d+$/.test(q));
    const labels: Record<string, string> = {};
    if (ids.length) {
      const named = rec(
        await getJson(
          deps,
          id,
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(0, 40).join('|')}&props=labels&languages=${lang === 'en' ? 'en' : `${lang}|en`}&languagefallback=1&format=json`,
          signal,
          'Wikidata',
        ),
      );
      for (const [q, entity] of Object.entries(rec(named.entities))) {
        const all = rec(rec(entity).labels);
        const label = strOf(rec(all[lang]).value) ?? strOf(rec(all.en).value);
        if (label) labels[q] = label;
      }
    }
    const names = (list: string[]) => list.flatMap((q) => labels[q] ?? []).join(', ') || undefined;
    const withPlace = (date: string | undefined, place: string | undefined) =>
      date && place ? `${date}, ${place}` : (date ?? place);
    const occupation = names(wanted.occupation);
    const facts: [string, string | undefined][] = [
      ['Born', withPlace(date('P569'), names(wanted.birthplace))],
      ['Died', withPlace(date('P570'), names(wanted.deathplace))],
      ['Occupation', occupation && capital(occupation)],
      ['Date', date('P585')],
      ['Founded', date('P571')],
      ['Founded by', names(wanted.foundedBy)],
      ['Country', names(wanted.country)],
      ['Capital', names(wanted.capital)],
      ['Headquarters', names(wanted.hq)],
      ['Location', names(wanted.location)],
      ['Population', quantity(latest(best(claims, 'P1082')))],
      ['Area', quantity(one('P2046'), 'area')],
    ];
    return facts
      .flatMap(([label, value]) => {
        const text = plain(value, 200);
        return text ? [{ label, value: text }] : [];
      })
      .slice(0, 8);
  } catch (error) {
    if (signal.aborted) throw error;
    return [];
  }
}

// ── The card ────────────────────────────────────────────────────────────────

export interface KnowledgeFound {
  view: KnowledgeView;
  /** What the model reads. */
  data: Record<string, unknown>;
}

/** A knowledge card for the first of these names Wikipedia has an article for. */
export async function knowledgeCard(
  deps: OutsideDeps,
  conversationId: string,
  queries: readonly string[],
  rawLang: unknown,
  signal: AbortSignal,
): Promise<KnowledgeFound> {
  const lang = wikiLang(rawLang);
  const id = `knowledge-${conversationId}`;
  const found = await findArticle(deps, id, lang, queries, signal);
  if (!found)
    throw new OutsideError(
      `Wikipedia (${lang}) has no article for “${queries.at(-1)}”. Try another name or spelling, or web_search.`,
    );
  const { summary } = found;
  const title = plain(summary.title, 200) ?? queries.at(-1) ?? 'Wikipedia';
  const desktop = rec(rec(summary.content_urls).desktop);
  const url =
    httpsUrl(strOf(desktop.page) ?? '') ??
    `https://${lang}.wikipedia.org/wiki/${titlePath(String(summary.title ?? title))}`;
  // `extract` is Wikipedia's own plain text; `extract_html` is never read.
  const extract = cutExtract(plain(summary.extract, 20_000) ?? '');
  const description = plain(summary.description, 200);
  const item = strOf(summary.wikibase_item);
  const [picture, facts] = await Promise.all([
    capturePicture(deps, conversationId, pictureAddress(summary), signal, title),
    item ? wikidataFacts(deps, id, item, lang, signal) : Promise.resolve([]),
  ]);
  const view: KnowledgeView = {
    kind: 'knowledge',
    title,
    ...(description && { description }),
    extract,
    ...(picture && { picture }),
    ...(facts.length && { facts }),
    url,
    lang,
    source: 'Wikipedia',
  };
  return {
    view,
    data: {
      title,
      ...(description && { description }),
      extract,
      ...(facts.length && { facts }),
      url,
      source: `Wikipedia (${lang})`,
      picture: picture ? 'shown on the card' : 'none',
    },
  };
}
