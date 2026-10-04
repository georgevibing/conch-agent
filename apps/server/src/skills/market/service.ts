/**
 * Discover (ADR 0070): skills people publish, searched in a few public
 * places and added as one of yours, held to the same rules as every other
 * skill from elsewhere.
 *
 * The path from a card to a skill in a chat:
 *
 * 1. **Search** asks each source, keeps what it said (memory and
 *    `skills-market-cache.json`), and answers from that copy when a source
 *    is offline or asks Conch to wait. Nothing a registry says is trusted:
 *    it decides only what's on the shelf.
 * 2. **Preview** downloads exactly one version (a commit, or a registry
 *    version with each file's SHA-256), checks every byte against that pin,
 *    writes it to a staging folder, never runs anything, never keeps an
 *    executable bit, and reads it like any skill (`scanSkill`), with what the
 *    registry warns about added to the findings. A licence that forbids
 *    copying, or a registry's block, stops it there.
 * 3. **Install** takes only what was previewed: the staging folder must
 *    still hash to what was read, a worrying one needs the person's OK for
 *    exactly that hash (ADR 0028), and it moves to
 *    `skills-market/<source>/<name>` (read-only to Conch, pinned when on, so
 *    any change turns it off). Where it came from is kept in
 *    `skills-market.json`, which the assistant can't touch.
 * 4. **Updates** are looked for at most once a day, never taken by
 *    themselves: an update is previewed like an install, with what changed
 *    file by file and whether it asks for more, and taken on a press. A
 *    source that serves something different for the version you already
 *    have is refused, and says so.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  MARKET_CATEGORY_LABELS,
  type MarketCategory,
  MarketListing,
  MarketPin,
  SkillName,
  SkillOrigin,
  type MarketChanges,
  type MarketFileChange,
  type MarketInstallBody,
  type MarketLicense,
  type MarketPreview,
  type MarketQuery,
  type MarketResults,
  type MarketSourceId,
  type MarketSourceState,
  type MarketUpdateBody,
  type SkillFinding,
  type SkillPermissions,
  type SkillReview,
} from '@conch/protocol';
import { z } from 'zod';

import { safeJoinPath, validRelPath } from '../../backup/paths';
import { Mutex, safeJoin, writeFileAtomic, writeJson } from '../../lib/fs';
import { readStore, type Heal } from '../../lib/recover';
import { isBinary, unifiedDiff } from '../../undo/diff';
import { slugify } from '../draft';
import { joinSkill, readKey, setKeys, splitSkill, splitTitle } from '../frontmatter';
import { readPermissions } from '../permissions';
import { scanSkill, skillHash } from '../scan';
import { SKILL_FILE_MAX, type SkillRoot, type SkillStore } from '../store';
import { MarketError } from './http';
import { licenseOf, RESTRICTED_WORDS } from './license';
import { type Fetched, type MarketSource, type SourceListing, splitId } from './types';

/** How long a search is kept before asking again; the shelf (no words) longer. */
const SEARCH_TTL_MS = 30 * 60_000;
const SHELF_TTL_MS = 6 * 60 * 60_000;
/** A preview waits this long for a yes. */
const PREVIEW_TTL_MS = 30 * 60_000;
/** Updates are looked for at most this often. */
const UPDATE_EVERY_MS = 24 * 60 * 60_000;
const MAX_CACHED = 80;
const MAX_INSTRUCTIONS = 60_000;
const MAX_DIFF = 40_000;
const STAGING = '.staging';

const Origins = z.object({
  /** By the skill's folder under `skills-market/`: `clawhub/meeting-notes`. */
  installs: z
    .record(
      z.string(),
      SkillOrigin.extend({
        /** `contentKey` of what was added: an update is a different one. */
        content: z.string(),
        /** The newest version seen, when it isn't this one. */
        latest: z.object({ pin: MarketPin, content: z.string() }).optional(),
        checkedAt: z.number().optional(),
      }),
    )
    .default({}),
});
type Install = z.infer<typeof Origins>['installs'][string];

const CacheFile = z.object({
  entries: z
    .record(z.string(), z.object({ at: z.number(), listings: z.array(z.unknown()) }))
    .default({}),
});

/** Words that put a skill on a shelf, checked against its name and description. */
const SHELVES: [MarketCategory, RegExp][] = [
  [
    'documents',
    /\b(?:pdf|docx?|word|slides?|presentations?|pptx|powerpoint|xlsx|excel|spreadsheets?|documents?|reports?|invoices?)\b/i,
  ],
  [
    'design',
    /\b(?:design|posters?|art|brand|logos?|colou?rs?|themes?|canvas|images?|illustrat\w*|visual|gif|figma|ui|ux)\b/i,
  ],
  [
    'coding',
    /\b(?:code|coding|react|typescript|javascript|python|api|sdk|git|tests?|testing|debug\w*|frontend|backend|deploy\w*|web\s?app|mcp|programming|refactor\w*)\b/i,
  ],
  ['data', /\b(?:data|csv|sql|analytics?|charts?|dashboards?|statistics?|database)\b/i],
  ['research', /\b(?:research|search|sources?|papers?|summari[sz]e|learn\w*|study|news|facts?)\b/i],
  [
    'writing',
    /\b(?:writ\w+|emails?|blog|copy\w*|essays?|edit\w*|tone|grammar|translat\w*|story|stories|newsletters?|comms|communications?)\b/i,
  ],
  [
    'business',
    /\b(?:sales|marketing|seo|customers?|crm|finance|budget|invoice|startup|business|pitch|hiring|recruit\w*|legal|contracts?)\b/i,
  ],
  [
    'productivity',
    /\b(?:meetings?|notes|calendar|tasks?|todo|plans?|planning|schedul\w*|habits?|daily|weekly|organi[sz]\w*|travel|recipes?|personal)\b/i,
  ],
];

export function categoryOf(
  listing: Pick<MarketListing, 'name' | 'title' | 'description'>,
): MarketCategory | undefined {
  const text = `${listing.name.replace(/-/g, ' ')} ${listing.title} ${listing.description}`;
  // The shelf whose words it uses most; the first in the list wins a tie.
  let best: { category: MarketCategory; hits: number } | undefined;
  for (const [category, words] of SHELVES) {
    const hits = text.match(new RegExp(words.source, 'gi'))?.length ?? 0;
    if (hits && (!best || hits > best.hits)) best = { category, hits };
  }
  return best?.category;
}

/** What a category is searched for, when it's picked with no words. */
const CATEGORY_WORDS: Record<MarketCategory, string> = {
  writing: 'writing',
  documents: 'documents',
  design: 'design',
  research: 'research',
  productivity: 'productivity',
  coding: 'coding',
  data: 'data analysis',
  business: 'marketing',
};

interface Preview {
  id: string;
  at: number;
  listingId: string;
  source: MarketSourceId;
  /** The folder it goes to under `skills-market/<source>/`. */
  folder: string;
  dir: string;
  fetched: Fetched;
  license: MarketLicense;
  review: SkillReview;
  blocked?: string;
  /** For an update: the skill it updates. */
  updates?: string;
  answer: MarketPreview;
}

export interface SkillMarketDeps {
  home: string;
  store: SkillStore;
  sources: MarketSource[];
  heal?: Heal;
  now?: () => number;
  /** Something about your skills changed: the list should be read again. */
  changed?: () => void;
}

/** `market-clawhub_meeting-notes` ↔ `clawhub/meeting-notes`. */
export const idPrefix = (source: MarketSourceId) => `market-${source}`;

export class SkillMarket {
  readonly dir: string;
  readonly #originsPath: string;
  readonly #cachePath: string;
  readonly #sources: Map<MarketSourceId, MarketSource>;
  readonly #now: () => number;
  readonly #mutex = new Mutex();
  /** Searches as last answered: `<source>|<words>`. */
  readonly #cache = new Map<string, { at: number; listings: SourceListing[] }>();
  /** Listings seen lately, by id: what the chat may offer, and a card's details. */
  readonly #seen = new Map<string, SourceListing>();
  /** A source that asked Conch to wait, until when. */
  readonly #quiet = new Map<MarketSourceId, number>();
  /** How each source answered last. */
  readonly #states = new Map<MarketSourceId, MarketSourceState>();
  readonly #previews = new Map<string, Preview>();
  #installs: Record<string, Install> = {};
  #loaded?: Promise<void>;
  #cacheDirty = false;

  constructor(private readonly deps: SkillMarketDeps) {
    this.dir = join(deps.home, 'skills-market');
    this.#originsPath = join(deps.home, 'skills-market.json');
    this.#cachePath = join(deps.home, 'skills-market-cache.json');
    this.#sources = new Map(deps.sources.map((s) => [s.id, s]));
    this.#now = deps.now ?? Date.now;
  }

  // ── What the skill store needs ──────────────────────────────────────────

  /** One folder per source, read-only to the store (ADR 0070). */
  roots(): SkillRoot[] {
    return [...this.#sources.values()].map((s) => ({
      source: 'market' as const,
      label: s.label,
      dir: join(this.dir, s.id),
      depth: 1 as const,
      idPrefix: idPrefix(s.id),
    }));
  }

  /** Where each skill you added came from, by the skill's id. */
  origins(): Map<string, SkillOrigin> {
    const out = new Map<string, SkillOrigin>();
    for (const [folder, install] of Object.entries(this.#installs)) {
      const [source, name] = folder.split('/') as [MarketSourceId, string];
      const { content: _c, latest, checkedAt: _at, ...origin } = install;
      out.set(`${idPrefix(source)}_${name}`, { ...origin, ...(latest && { update: true }) });
    }
    return out;
  }

  /** Read what was added and the last searches. Repeatable; once is enough. */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      const origins = await readStore(this.#originsPath, Origins, {
        onRepair: () =>
          this.deps.heal?.(
            'skills',
            'The list of where your added skills came from couldn’t be read, so Conch kept a copy and started it again. The skills are still there.',
          ),
      }).catch(() => ({ value: Origins.parse({}) }));
      this.#installs = origins.value.installs;
      const cache = await readStore(this.#cachePath, CacheFile).catch(() => ({
        value: CacheFile.parse({}),
      }));
      for (const [key, entry] of Object.entries(cache.value.entries)) {
        const listings = entry.listings.flatMap((l) => {
          const parsed = MarketListing.omit({ category: true, installed: true }).safeParse(l);
          return parsed.success ? [parsed.data] : [];
        });
        this.#cache.set(key, { at: entry.at, listings });
        for (const l of listings) this.#seen.set(l.id, l);
      }
    })();
    return this.#loaded;
  }

  async #saveOrigins() {
    await writeJson(this.#originsPath, { installs: this.#installs });
  }

  async #saveCache() {
    if (!this.#cacheDirty) return;
    this.#cacheDirty = false;
    const entries = Object.fromEntries(
      [...this.#cache]
        .slice(-MAX_CACHED)
        .map(([key, v]) => [key, { at: v.at, listings: v.listings }]),
    );
    await writeJson(this.#cachePath, { entries }).catch(() => undefined);
  }

  // ── Searching ───────────────────────────────────────────────────────────

  #remember(key: string, listings: SourceListing[]) {
    this.#cache.delete(key);
    this.#cache.set(key, { at: this.#now(), listings });
    while (this.#cache.size > MAX_CACHED) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    for (const l of listings) this.#seen.set(l.id, l);
    this.#cacheDirty = true;
  }

  /** One source's answer: fresh, from the copy when it's fresh enough, or from before. */
  async #ask(
    source: MarketSource,
    words: string,
    signal?: AbortSignal,
  ): Promise<{ listings: SourceListing[]; state: MarketSourceState }> {
    const key = `${source.id}|${words}`;
    const cached = this.#cache.get(key);
    const ttl = words ? SEARCH_TTL_MS : SHELF_TTL_MS;
    const state = (s: MarketSourceState['state'], at?: number): MarketSourceState => ({
      id: source.id,
      label: source.label,
      state: s,
      ...(at && { at }),
    });
    if (cached && this.#now() - cached.at < ttl)
      return { listings: cached.listings, state: state('ok', cached.at) };
    const quietUntil = this.#quiet.get(source.id) ?? 0;
    if (this.#now() < quietUntil)
      return { listings: cached?.listings ?? [], state: state('limited', cached?.at) };
    try {
      const listings = (await source.search?.(words, signal)) ?? [];
      this.#remember(key, listings);
      return { listings, state: state('ok', this.#now()) };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof MarketError && error.code === 'limited')
        this.#quiet.set(source.id, error.retryAt ?? this.#now() + 60_000);
      const kind = error instanceof MarketError && error.code === 'limited' ? 'limited' : 'offline';
      return { listings: cached?.listings ?? [], state: state(kind, cached?.at) };
    }
  }

  /** What's installed, by listing id, and whether a newer version is there. */
  #installedBy(): Map<string, { skillId: string; update?: boolean }> {
    const out = new Map<string, { skillId: string; update?: boolean }>();
    for (const [folder, install] of Object.entries(this.#installs)) {
      const [source, name] = folder.split('/') as [MarketSourceId, string];
      out.set(install.listingId, {
        skillId: `${idPrefix(source)}_${name}`,
        ...(install.latest && { update: true }),
      });
    }
    return out;
  }

  #finish(
    listing: SourceListing,
    installed: Map<string, { skillId: string; update?: boolean }>,
  ): MarketListing {
    const category = categoryOf(listing);
    const mine = installed.get(listing.id);
    return { ...listing, ...(category && { category }), ...(mine && { installed: mine }) };
  }

  /**
   * The shelf, or what matches the words, from every source: Anthropic's
   * first, then the registries' by how many people use them. Blocked ones
   * never show, and Anthropic's skills aren't listed twice.
   */
  async search(query: MarketQuery = {}, signal?: AbortSignal): Promise<MarketResults> {
    await this.load();
    const typed = (query.q ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
    const words = typed || (query.category ? CATEGORY_WORDS[query.category] : '');
    const asked = [...this.#sources.values()].filter(
      (s) =>
        s.search &&
        (!query.source ||
          s.id === query.source ||
          (query.source === 'skills-sh' && s.id === 'clawhub')),
    );
    const answers = await Promise.all(asked.map((s) => this.#ask(s, words, signal)));
    for (const { state } of answers) this.#states.set(state.id, state);
    void this.#saveCache();
    const installed = this.#installedBy();
    const seen = new Set<string>();
    const listings: MarketListing[] = [];
    for (const { listings: found } of answers)
      for (const l of found) {
        if (seen.has(l.id) || l.trust === 'blocked') continue;
        // Anthropic's own repository is read directly, with its licences.
        if (l.id.startsWith('skills-sh:anthropics/skills/')) continue;
        if (query.source && l.source !== query.source) continue;
        seen.add(l.id);
        const done = this.#finish(l, installed);
        if (query.category && done.category !== query.category) continue;
        listings.push(done);
      }
    const states = answers.map((a) => a.state);
    return {
      listings,
      sources: states,
      ...(states.some((s) => s.state !== 'ok') && { stale: true }),
    };
  }

  /** A listing seen lately, or asked of its source. */
  async listing(id: string, signal?: AbortSignal): Promise<MarketListing> {
    await this.load();
    const { source, key } = splitId(id);
    let listing = this.#seen.get(id);
    if (!listing) {
      listing = await this.#source(source).listing(key, signal);
      this.#seen.set(id, listing);
    }
    return this.#finish(listing, this.#installedBy());
  }

  /** For the chat (ADR 0060): a listing it may offer — seen in a search, not blocked, not yours. */
  offerable(id: string): MarketListing | undefined {
    const listing = this.#seen.get(id);
    if (!listing || listing.trust === 'blocked' || listing.trust === 'flagged') return undefined;
    if (this.#installedBy().has(id)) return undefined;
    return this.#finish(listing, new Map());
  }

  /** The skill you added from this listing, if you did. */
  installedFor(listingId: string): string | undefined {
    return this.#installedBy().get(listingId)?.skillId;
  }

  #source(id: MarketSourceId): MarketSource {
    const source = this.#sources.get(id);
    if (!source) throw new MarketError('not-found', 'Conch doesn’t look there for skills.');
    return source;
  }

  // ── Reading one before it's added ───────────────────────────────────────

  /** The folder an install goes to: its own name, unless one of your skills already answers to it. */
  async #folderFor(source: MarketSourceId, name: string): Promise<string> {
    const base = SkillName.safeParse(name).success ? name : slugify(name);
    const { skills } = await this.deps.store.list({ fresh: true });
    const taken = new Set(skills.map((s) => s.name.toLowerCase()));
    let folder = base;
    for (let n = 2; taken.has(folder) || (await exists(join(this.dir, source, folder))); n++)
      folder = `${base.slice(0, 60)}-${n}`;
    return folder;
  }

  /** Write what was downloaded into a fresh staging folder: plain files, never runnable. */
  async #stage(
    files: ReadonlyMap<string, Buffer>,
    rename?: string,
  ): Promise<{ id: string; dir: string }> {
    const id = `mp_${randomBytes(12).toString('base64url')}`;
    const dir = safeJoin(join(this.dir, STAGING), id);
    await mkdir(dir, { recursive: true });
    for (const [path, bytes] of files) {
      if (!validRelPath(path))
        throw new MarketError(
          'refused',
          `The skill has a file Conch won’t open: “${path.slice(0, 120)}”.`,
        );
      let out = bytes;
      if (path === 'SKILL.md' && rename) {
        // Named after its folder, as the standard asks, when that had to change.
        const file = splitSkill(bytes.toString('utf8'));
        out = Buffer.from(
          joinSkill({ front: setKeys(file.front, [['name', rename]]), body: file.body }),
        );
      }
      // 0600: never executable, whatever git or the registry said.
      await writeFileAtomic(safeJoinPath(dir, path), out, 0o600);
    }
    return { id, dir };
  }

  async #read(
    id: string,
    fetched: Fetched,
    updates?: { skillId: string; folder: string; install: Install },
  ): Promise<MarketPreview> {
    const { source } = splitId(id);
    const skillText = fetched.files.get('SKILL.md');
    if (!skillText)
      throw new MarketError('not-found', 'There’s no SKILL.md in it, so it isn’t a skill.');
    if (skillText.length > SKILL_FILE_MAX)
      throw new MarketError('too-big', 'Its SKILL.md is bigger than Conch reads.');
    const { front, body } = splitSkill(skillText.toString('utf8'));
    const description = readKey(front, 'description')?.trim();
    const describes = Boolean(description && /[\p{L}\p{N}]/u.test(description));
    const license = licenseOf(fetched.files, fetched.licenseHint);
    const blocked =
      fetched.blocked ??
      (license.kind === 'restricted' ? RESTRICTED_WORDS : undefined) ??
      (front === undefined || !describes
        ? 'Its own file doesn’t say what it does, so an assistant wouldn’t know when to use it.'
        : undefined);
    const ownName = readKey(front, 'name')?.trim() ?? fetched.listing.name;
    const folder = updates?.folder ?? (await this.#folderFor(source, ownName));
    const staged = await this.#stage(fetched.files, folder !== ownName ? folder : undefined);
    const scanned = await scanSkill(staged.dir);
    const registry: SkillFinding[] =
      fetched.listing.trust === 'flagged' && fetched.listing.trustNote
        ? [{ kind: 'registry', severity: 'danger', message: fetched.listing.trustNote }]
        : [];
    const findings = [...registry, ...scanned.findings];
    const review: SkillReview = {
      ...scanned,
      findings,
      verdict: findings.some((f) => f.severity === 'danger')
        ? 'danger'
        : findings.some((f) => f.severity === 'warning')
          ? 'caution'
          : 'clean',
    };
    const permissions = readPermissions(front);
    const changes = updates ? await this.#changes(updates, staged.dir, permissions) : undefined;
    const listing = this.#finish(fetched.listing, this.#installedBy());
    const answer: MarketPreview = {
      previewId: staged.id,
      listing,
      pin: fetched.pin,
      review,
      permissions,
      instructions: splitTitle(body).instructions.slice(0, MAX_INSTRUCTIONS),
      files: [...fetched.files.keys()]
        .filter((p) => p !== 'SKILL.md')
        .sort()
        .slice(0, 200),
      license,
      ...(blocked && { blocked }),
      ...(changes && { changes }),
    };
    this.#previews.set(staged.id, {
      id: staged.id,
      at: this.#now(),
      listingId: id,
      source,
      folder,
      dir: staged.dir,
      fetched,
      license,
      review,
      ...(blocked && { blocked }),
      ...(updates && { updates: updates.skillId }),
      answer,
    });
    void this.#sweep();
    return answer;
  }

  /** Download one version, check it, and read it, for a person to look at. Nothing is added. */
  async preview(id: string, signal?: AbortSignal): Promise<MarketPreview> {
    await this.load();
    const { source, key } = splitId(id);
    const fetched = await this.#source(source).fetch(key, signal);
    this.#seen.set(id, fetched.listing);
    return this.#read(id, fetched);
  }

  /** Add exactly what was previewed. */
  install(body: MarketInstallBody): Promise<string> {
    return this.#mutex.run(async () => {
      const preview = this.#take(body.previewId);
      if (preview.updates)
        throw new MarketError('refused', 'That was a look at an update, not a new skill.');
      await this.#checkStaged(preview, body.acknowledged);
      const target = join(this.dir, preview.source, preview.folder);
      if (await exists(target)) throw new MarketError('refused', 'You have that skill already.');
      if (this.#installedBy().has(preview.listingId))
        throw new MarketError('refused', 'You have that skill already.');
      await mkdir(join(this.dir, preview.source), { recursive: true });
      await rename(preview.dir, target);
      this.#previews.delete(preview.id);
      const { listing, pin } = preview.fetched;
      this.#installs[`${preview.source}/${preview.folder}`] = {
        source: preview.source,
        sourceLabel: listing.sourceLabel,
        listingId: preview.listingId,
        publisher: listing.publisher,
        trust: listing.trust,
        pin,
        url: listing.url,
        license: preview.license,
        installedAt: this.#now(),
        content: preview.fetched.content,
      };
      await this.#saveOrigins();
      const skillId = `${idPrefix(preview.source)}_${preview.folder}`;
      this.deps.store.invalidate();
      // On, pinned as it is now (ADR 0028): any change turns it off until it's looked at again.
      await this.deps.store.setMode(
        skillId,
        body.mode,
        preview.review.verdict === 'danger' ? await skillHash(target) : undefined,
      );
      this.deps.changed?.();
      return skillId;
    });
  }

  /** A preview still waiting, or a sentence saying it isn't. */
  #take(previewId: string): Preview {
    const preview = this.#previews.get(previewId);
    if (!preview || this.#now() - preview.at > PREVIEW_TTL_MS)
      throw new MarketError(
        'not-found',
        'That look at the skill has expired. Open it again to read it first.',
      );
    return preview;
  }

  /** What's in staging is still what was read, it may be added, and a worrying one was looked at. */
  async #checkStaged(preview: Preview, acknowledged?: string) {
    if (preview.blocked) throw new MarketError('refused', preview.blocked);
    const now = await scanSkill(preview.dir).catch(() => undefined);
    if (!now || now.hash !== preview.review.hash) {
      this.#previews.delete(preview.id);
      await rm(preview.dir, { recursive: true, force: true }).catch(() => undefined);
      throw new MarketError(
        'changed',
        'The downloaded copy changed after Conch read it, so nothing was added. Open it again to read it afresh.',
      );
    }
    if (preview.review.verdict === 'danger' && acknowledged !== preview.review.hash)
      throw new MarketError(
        'refused',
        'Conch found something worrying in this skill. Look at what it found, then add it if you still want it.',
      );
  }

  // ── Updates ─────────────────────────────────────────────────────────────

  #install(skillId: string): { folder: string; install: Install } {
    for (const [folder, install] of Object.entries(this.#installs)) {
      const [source, name] = folder.split('/') as [MarketSourceId, string];
      if (`${idPrefix(source)}_${name}` === skillId) return { folder, install };
    }
    throw new MarketError('not-found', 'That skill wasn’t added from Discover.');
  }

  /**
   * Look for newer versions of what you added, at most once a day each. A
   * source that's down is left for next time. Returns how many have one.
   */
  async checkUpdates(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<number> {
    await this.load();
    let changed = false;
    for (const [folder, install] of Object.entries(this.#installs)) {
      if (!options.force && install.checkedAt && this.#now() - install.checkedAt < UPDATE_EVERY_MS)
        continue;
      const source = this.#sources.get(install.source);
      if (!source) continue;
      const { key } = splitId(install.listingId);
      const latest = await source.latest(key, options.signal).catch(() => null);
      if (latest === null) continue;
      install.checkedAt = this.#now();
      if (latest && latest.content !== install.content && !samePin(latest.pin, install.pin))
        install.latest = latest;
      else delete install.latest;
      this.#installs[folder] = install;
      changed = true;
    }
    if (changed) {
      await this.#saveOrigins();
      this.deps.changed?.();
    }
    return Object.values(this.#installs).filter((i) => i.latest).length;
  }

  /** The newest version of a skill you added, read and compared with yours, for a press. */
  async previewUpdate(skillId: string, signal?: AbortSignal): Promise<MarketPreview> {
    await this.load();
    const { folder, install } = this.#install(skillId);
    const { key } = splitId(install.listingId);
    const fetched = await this.#source(install.source).fetch(key, signal);
    if (samePin(fetched.pin, install.pin)) {
      if (fetched.content !== install.content)
        throw new MarketError(
          'changed',
          `${install.sourceLabel} now serves something different for the version you have. Conch kept yours and won’t take it.`,
        );
      throw new MarketError('not-found', 'You have the newest version already.');
    }
    return this.#read(install.listingId, fetched, {
      skillId,
      folder: folder.split('/')[1] as string,
      install,
    });
  }

  /** Take an update that was read: swap the folder, keep its mode, pin it again. */
  update(skillId: string, body: MarketUpdateBody): Promise<void> {
    return this.#mutex.run(async () => {
      const preview = this.#take(body.previewId);
      if (preview.updates !== skillId)
        throw new MarketError('refused', 'That look was at something else.');
      await this.#checkStaged(preview, body.acknowledged);
      const { folder, install } = this.#install(skillId);
      const before = (await this.deps.store.list({ fresh: true })).skills.find(
        (s) => s.id === skillId,
      );
      const mode = before?.mode ?? 'off';
      const target = join(this.dir, folder);
      const old = join(this.dir, STAGING, `old-${preview.id}`);
      await rename(target, old);
      try {
        await rename(preview.dir, target);
      } catch (error) {
        await rename(old, target).catch(() => undefined);
        throw error;
      }
      await rm(old, { recursive: true, force: true }).catch(() => undefined);
      this.#previews.delete(preview.id);
      const { listing, pin } = preview.fetched;
      const { latest: _latest, ...rest } = install;
      this.#installs[folder] = {
        ...rest,
        trust: listing.trust,
        publisher: listing.publisher,
        pin,
        license: preview.license,
        content: preview.fetched.content,
        checkedAt: this.#now(),
      };
      await this.#saveOrigins();
      this.deps.store.invalidate();
      // Pinned again to what you just read; off stays off.
      await this.deps.store.setMode(
        skillId,
        mode,
        preview.review.verdict === 'danger' ? await skillHash(target) : undefined,
      );
      this.deps.changed?.();
    });
  }

  /** What an update changes: each file, and whether it asks to do more. */
  async #changes(
    updates: { folder: string; install: Install; skillId: string },
    staged: string,
    after: SkillPermissions,
  ): Promise<MarketChanges> {
    const current = join(this.dir, updates.install.source, updates.folder);
    const [was, now] = await Promise.all([readTree(current), readTree(staged)]);
    const files: MarketFileChange[] = [];
    let budget = MAX_DIFF * 4;
    for (const path of [...new Set([...was.keys(), ...now.keys()])].sort()) {
      const a = was.get(path);
      const b = now.get(path);
      if (a && b && a.equals(b)) continue;
      const change: MarketFileChange['change'] = !a ? 'added' : !b ? 'removed' : 'changed';
      const text = !(a && isBinary(a)) && !(b && isBinary(b));
      const diff = text
        ? unifiedDiff(a?.toString('utf8') ?? '', b?.toString('utf8') ?? '', path)
        : undefined;
      const capped = diff && diff.length <= Math.min(MAX_DIFF, budget) ? diff : undefined;
      if (capped) budget -= capped.length;
      files.push({ path, change, ...(capped && { diff: capped }) });
    }
    const before = readPermissions(splitSkill(was.get('SKILL.md')?.toString('utf8') ?? '').front);
    return {
      files,
      permissions: { before, after },
      wider: wider(before, after),
      from: updates.install.pin,
    };
  }

  // ── Taking one away, and tidying ────────────────────────────────────────

  /** Whether Discover put this skill here. */
  owns(skillId: string): boolean {
    try {
      this.#install(skillId);
      return true;
    } catch {
      return skillId.startsWith('market-');
    }
  }

  /** Remove a skill you added from Discover: its folder and where it came from. */
  remove(skillId: string): Promise<void> {
    return this.#mutex.run(async () => {
      let folder: string | undefined;
      try {
        folder = this.#install(skillId).folder;
      } catch {
        const skill = await this.deps.store.get(skillId);
        folder = relative(this.dir, skill.path).split(sep).join('/');
      }
      if (!folder || !/^[a-z-]+\/[A-Za-z0-9._-]+$/.test(folder))
        throw new MarketError('not-found', 'That skill wasn’t added from Discover.');
      await rm(safeJoinPath(this.dir, folder), { recursive: true, force: true });
      const gone = folder;
      this.#installs = Object.fromEntries(
        Object.entries(this.#installs).filter(([key]) => key !== gone),
      );
      await this.#saveOrigins();
      this.deps.store.invalidate();
    });
  }

  /** Staging folders nobody will press for any more. Returns how many went. */
  async #sweep(): Promise<number> {
    const now = this.#now();
    let gone = 0;
    for (const [id, p] of this.#previews)
      if (now - p.at > PREVIEW_TTL_MS) {
        this.#previews.delete(id);
        await rm(p.dir, { recursive: true, force: true }).catch(() => undefined);
        gone++;
      }
    const root = join(this.dir, STAGING);
    const names = await readdir(root).catch(() => [] as string[]);
    for (const name of names) {
      if (this.#previews.has(name)) continue;
      const info = await stat(join(root, name)).catch(() => undefined);
      if (info && now - info.mtimeMs < PREVIEW_TTL_MS) continue;
      await rm(join(root, name), { recursive: true, force: true }).catch(() => undefined);
      gone++;
    }
    return gone;
  }

  /**
   * Repair everything's look (ADR 0070): added skills whose folder is gone,
   * and leftovers from looks nobody pressed for.
   */
  async health(repair: boolean): Promise<{ missing: string[]; swept: number }> {
    await this.load();
    const missing: string[] = [];
    for (const folder of Object.keys(this.#installs))
      if (!(await exists(join(this.dir, folder)))) missing.push(folder);
    let swept = 0;
    if (repair) {
      this.#installs = Object.fromEntries(
        Object.entries(this.#installs).filter(([key]) => !missing.includes(key)),
      );
      if (missing.length) await this.#saveOrigins();
      swept = await this.#sweep();
    }
    return { missing, swept };
  }

  /** For a source's state on Settings → Health. */
  states(): MarketSourceState[] {
    return [...this.#states.values()];
  }

  categoryLabel(category: MarketCategory): string {
    return MARKET_CATEGORY_LABELS[category];
  }
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Two pins for the same version. */
export function samePin(a: MarketPin, b: MarketPin): boolean {
  if (a.kind === 'commit' && b.kind === 'commit')
    return (
      a.commit === b.commit && a.path === b.path && a.owner.toLowerCase() === b.owner.toLowerCase()
    );
  if (a.kind === 'version' && b.kind === 'version') return a.version === b.version;
  return false;
}

/** It asks to do something the list before didn't. */
export function wider(before: SkillPermissions, after: SkillPermissions): boolean {
  if (after.capabilities.some((c) => !before.capabilities.includes(c))) return true;
  if (after.capabilities.includes('commands')) {
    if (before.commands && !after.commands) return true;
    if (before.commands && after.commands?.some((c) => !before.commands?.includes(c))) return true;
  }
  if (after.capabilities.includes('apps')) {
    if (before.apps && !after.apps) return true;
    if (before.apps && after.apps?.some((a) => !before.apps?.includes(a))) return true;
  }
  return false;
}

/** Every regular file under `dir`, relative with `/`, hidden ones skipped. */
async function readTree(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const visit = async (at: string, depth: number) => {
    if (depth > 8 || out.size > 400) return;
    const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile())
        out.set(relative(dir, path).split(sep).join('/'), await readFile(path));
    }
  };
  await visit(dir, 1);
  return out;
}
