/**
 * Live data for a sealed page (ADR 0046).
 *
 * A page still has no network of its own (`connect-src 'none'`, ADR 0034).
 * What it can do is name a source it declared — in the page itself, as
 * `<script type="application/conch-data">` — and ask the panel for it over
 * the frame's `postMessage` bridge. The panel asks the gateway, and the
 * gateway reads it, on these terms:
 *
 * - **Declared, with the host fixed.** The address is written in the page:
 *   the host can't be a placeholder, and the page fills in only the
 *   `{name}`s it declared, with one of a list or a number in a range. It
 *   can't build an address, so it can't spell your data into one.
 * - **With your OK, per page and host.** The OK covers the addresses you saw
 *   when you gave it. A new address on the same host, a new host, or a page
 *   moved to another one asks again. You can take it back at any time.
 * - **GET, nobody's.** No cookies, no sign-ins, no headers from the page; at
 *   most a megabyte, within ten seconds, text only.
 * - **Never inward.** Every address a name resolves to is checked at the
 *   moment of connecting (no rebinding between check and use), and every
 *   redirect again: never link-local or cloud metadata, never your network,
 *   never Conch itself, and this computer only when you said so for that page.
 * - **Little and seldom.** At most 30 different addresses an hour per page,
 *   and the same one is answered from the last read for 15 seconds. That caps
 *   what even an allowed host could learn from which choices a page makes.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { join } from 'node:path';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import {
  DATA_SOURCE_NAME,
  DataSource,
  LIVE_DATA,
  LiveDataApproval,
  type DataParam,
  type LiveDataInfo,
  type LiveDataRequest,
  type LiveDataResult,
  type LiveDataSource,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

// ── What a page declares ────────────────────────────────────────────────

const MANIFEST =
  /<script\b[^>]*\btype\s*=\s*["']?application\/conch-data["']?[^>]*>([\s\S]*?)<\/script\s*>/i;
const PLACEHOLDER = /\{([^{}]*)\}/g;
/** The scheme and the host are written out; placeholders only come after. */
const ADDRESS = /^(https?):\/\/([^/?#{}\s\\@]+)(\/[^\s#\\]*)?$/i;

export interface Source extends DataSource {
  name: string;
  /** `host:port` as written (lower case). */
  host: string;
  local: boolean;
}

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, '').toLowerCase();

/** localhost, 127.x, ::1: an address on this computer, which needs its own OK. */
export function isLoopbackName(hostname: string): boolean {
  const h = bare(hostname);
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    (isIP(h) === 4 && h.startsWith('127.'))
  );
}

function sourceProblem(name: string, raw: DataSource): string | undefined {
  const address = ADDRESS.exec(raw.url);
  if (!address)
    return `“${name}” needs a whole address, starting https://, with its host written out.`;
  const [, scheme = '', hostPart = ''] = address;
  const used = [...raw.url.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '');
  const declared = Object.keys(raw.params ?? {});
  const unknown = used.find((p) => !declared.includes(p));
  if (unknown !== undefined)
    return `“${name}” uses {${unknown}} in its address, but doesn’t say what it may be.`;
  const unused = declared.find((p) => !used.includes(p));
  if (unused) return `“${name}” declares “${unused}”, but its address doesn’t use it.`;
  let url: URL;
  try {
    url = new URL(raw.url.replace(PLACEHOLDER, 'x'));
  } catch {
    return `“${name}” has an address that isn’t one.`;
  }
  if (url.host.toLowerCase() !== hostPart.toLowerCase() || url.username || url.password)
    return `“${name}” has an address with a sign-in in it, which pages can’t use.`;
  const local = isLoopbackName(url.hostname);
  if (scheme.toLowerCase() !== 'https' && !local)
    return `“${name}” must use a secure address (https).`;
  for (const [param, rule] of Object.entries(raw.params ?? {})) {
    if ('choices' in rule) continue;
    const step = rule.step ?? 1;
    if (rule.max <= rule.min) return `“${param}” in “${name}” needs a max bigger than its min.`;
    if ((rule.max - rule.min) / step > LIVE_DATA.maxSteps)
      return `“${param}” in “${name}” allows too many values: use a bigger step or a smaller range.`;
  }
  return undefined;
}

/**
 * The sources a page declares, checked. A page with none reads nothing; one
 * whose list doesn't read says why, once, and reads nothing either.
 */
export function readSources(html: string): { sources: Source[]; problem?: string } {
  const block = MANIFEST.exec(html)?.[1];
  if (block === undefined) return { sources: [] };
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    return { sources: [], problem: 'The page’s list of live data isn’t valid JSON.' };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json))
    return { sources: [], problem: 'The page’s list of live data must name each source.' };
  const entries = Object.entries(json);
  if (entries.length > LIVE_DATA.maxSources)
    return {
      sources: [],
      problem: `A page can read from at most ${LIVE_DATA.maxSources} sources.`,
    };
  const sources: Source[] = [];
  for (const [name, value] of entries) {
    if (!DATA_SOURCE_NAME.test(name))
      return { sources: [], problem: `“${name.slice(0, 40)}” isn’t a name a source can have.` };
    const parsed = DataSource.safeParse(value);
    if (!parsed.success)
      return {
        sources: [],
        problem:
          `“${name}” doesn’t fit: ${parsed.error.issues[0]?.path.join('.') || 'it'} ${parsed.error.issues[0]?.message ?? ''}.`.trim(),
      };
    const wrong = sourceProblem(name, parsed.data);
    if (wrong) return { sources: [], problem: wrong };
    const url = new URL(parsed.data.url.replace(PLACEHOLDER, 'x'));
    sources.push({
      ...parsed.data,
      name,
      host: url.host.toLowerCase(),
      local: isLoopbackName(url.hostname),
    });
  }
  return { sources };
}

const formatNumber = (n: number) => String(Number(n.toFixed(6)));

function fillValue(rule: DataParam, value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if ('choices' in rule) {
    const text = String(value);
    return rule.choices.includes(text) ? text : undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < rule.min || n > rule.max) return undefined;
  const step = rule.step ?? 1;
  return formatNumber(Math.min(rule.max, rule.min + Math.round((n - rule.min) / step) * step));
}

/** The address to read: the page's values in, each checked, or why not. */
export function fillSource(
  source: Source,
  values: LiveDataRequest['params'] = {},
): { url: string } | { problem: string } {
  const rules = source.params ?? {};
  const extra = Object.keys(values).find((k) => !(k in rules));
  if (extra) return { problem: `“${source.name}” doesn’t take “${extra}”.` };
  let missing: string | undefined;
  const url = source.url.replace(PLACEHOLDER, (_, name: string) => {
    const rule = rules[name];
    const filled = rule ? fillValue(rule, values[name]) : undefined;
    if (filled === undefined) missing ??= name;
    return encodeURIComponent(filled ?? '');
  });
  if (missing !== undefined)
    return { problem: `“${source.name}” got a value for “${missing}” it doesn’t allow.` };
  if (url.length > LIVE_DATA.maxUrl) return { problem: 'That address is too long to read.' };
  return { url };
}

// ── Where a request may land ────────────────────────────────────────────

const never = new BlockList();
never.addSubnet('0.0.0.0', 8, 'ipv4');
never.addSubnet('169.254.0.0', 16, 'ipv4');
never.addSubnet('224.0.0.0', 3, 'ipv4');
never.addSubnet('fe80::', 10, 'ipv6');
never.addSubnet('ff00::', 8, 'ipv6');
never.addAddress('::', 'ipv6');
never.addAddress('fd00:ec2::254', 'ipv6');
// IPv4 hidden in IPv6 (NAT64, 6to4, Teredo) could point anywhere: no.
never.addSubnet('64:ff9b::', 96, 'ipv6');
never.addSubnet('2002::', 16, 'ipv6');
never.addSubnet('2001::', 32, 'ipv6');

const loopback = new BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');

const privateNets = new BlockList();
privateNets.addSubnet('10.0.0.0', 8, 'ipv4');
privateNets.addSubnet('172.16.0.0', 12, 'ipv4');
privateNets.addSubnet('192.168.0.0', 16, 'ipv4');
privateNets.addSubnet('100.64.0.0', 10, 'ipv4');
privateNets.addSubnet('198.18.0.0', 15, 'ipv4');
privateNets.addSubnet('192.0.0.0', 24, 'ipv4');
privateNets.addSubnet('fc00::', 7, 'ipv6');
privateNets.addSubnet('fec0::', 10, 'ipv6');

export type Place = 'public' | 'this-computer' | 'your-network' | 'never';

/** Where an address is, as far as a page's request is concerned. */
export function placeOf(address: string): Place {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const a = (mapped?.[1] ?? address).toLowerCase();
  const family = isIP(a) === 6 ? 'ipv6' : 'ipv4';
  if (!isIP(a) || never.check(a, family)) return 'never';
  if (loopback.check(a, family)) return 'this-computer';
  if (privateNets.check(a, family)) return 'your-network';
  return 'public';
}

export interface Reach {
  /** This page may read from this computer (you said so). */
  local: boolean;
  /** Conch's own port: never, on this computer. */
  gatewayPort: number;
  /** The hosts this page may read from (`host:port`). A redirect elsewhere stops. */
  hosts: ReadonlySet<string>;
}

export type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;

export const systemResolve: Resolve = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => ({
    address: r.address,
    family: r.family,
  }));

class Refused extends Error {}

/**
 * A `lookup` for `node:http(s)` that checks every address a name resolves
 * to at the moment of connecting, so the address checked is the address
 * dialled (no rebinding between the two). `why` says why an address is
 * refused; `refused` hears it, so the caller can say it instead of a
 * socket error. Shared by live data and Conch apps' `app.fetch`.
 */
export function guardedLookup(
  resolve: Resolve,
  why: (address: string) => string | undefined,
  refused: (why: string) => void,
): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    resolve(hostname).then(
      (found) => {
        const no = found.length
          ? found.map((f) => why(f.address)).find(Boolean)
          : `Couldn’t find ${hostname}.`;
        if (no) {
          refused(no);
          return callback(new Refused(no), '', 0);
        }
        const first = found[0] as { address: string; family: number };
        if ((lookupOptions as { all?: boolean }).all)
          return (callback as unknown as (e: null, a: typeof found) => void)(null, found);
        callback(null, first.address, first.family);
      },
      () => callback(new Error(`Couldn’t find ${hostname}.`), '', 0),
    );
  };
}

const portOf = (url: URL) => Number(url.port) || (url.protocol === 'https:' ? 443 : 80);

/** Why a page may not read from `address` for `url`, or nothing when it may. */
function refusal(address: string, url: URL, reach: Reach): string | undefined {
  const place = placeOf(address);
  if (place === 'never') return `${url.hostname} points somewhere Conch never connects to.`;
  if (place === 'your-network')
    return `${url.hostname} is on your own network, which pages can’t read from.`;
  if (place === 'this-computer') {
    if (portOf(url) === reach.gatewayPort) return 'A page can’t read from Conch itself.';
    if (!reach.local)
      return `${url.hostname} is on this computer, and this page hasn’t been allowed to read from it.`;
  }
  return undefined;
}

const TEXTUAL =
  /^(?:text\/[a-z0-9.+-]+|application\/(?:json|xml|csv|ld\+json|geo\+json|[a-z0-9.-]+\+(?:json|xml)))$/i;

const fail = (
  reason: Extract<LiveDataResult, { ok: false }>['reason'],
  message: string,
  host?: string,
): LiveDataResult => ({ ok: false, reason, message, ...(host && { host }) });

/**
 * GET one address for a page: no cookies, no credentials, nothing from the
 * page but the address. Every hop's addresses are checked as it connects,
 * and a redirect is followed only to a host the page may read from.
 */
export async function fetchLive(
  start: string,
  reach: Reach,
  options: { resolve?: Resolve; timeoutMs?: number; maxBytes?: number } = {},
): Promise<LiveDataResult> {
  const resolve = options.resolve ?? systemResolve;
  const maxBytes = options.maxBytes ?? LIVE_DATA.maxBytes;
  const signal = AbortSignal.timeout(options.timeoutMs ?? LIVE_DATA.timeoutMs);
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackName(url.hostname)))
      return fail('refused', `${url.host} isn’t a secure (https) address.`, url.host);
    if (url.username || url.password)
      return fail('refused', 'Addresses with a sign-in in them aren’t read.', url.host);
    if (!reach.hosts.has(url.host.toLowerCase()))
      return hop === 0
        ? fail('needs-approval', `This page wants to read from ${url.host}.`, url.host)
        : fail('refused', `It was sent on to ${url.host}, which this page may not read from.`);
    // Node doesn't look up an address that is one already: check it here.
    const literal = bare(url.hostname);
    if (isIP(literal)) {
      const why = refusal(literal, url, reach);
      if (why) return fail('refused', why, url.host);
    }
    const target = url;
    let refused: string | undefined;
    const lookup = guardedLookup(
      resolve,
      (address) => refusal(address, target, reach),
      (why) => {
        refused = why;
      },
    );
    let response: IncomingMessage;
    try {
      response = await new Promise<IncomingMessage>((done, failed) => {
        const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const req = send(target, {
          method: 'GET',
          agent: false,
          lookup,
          signal,
          headers: {
            accept: 'application/json, text/csv, text/plain;q=0.9, */*;q=0.1',
            'accept-encoding': 'gzip, deflate, br',
            'user-agent': 'Conch live data',
          },
        });
        req.on('response', done);
        req.on('error', failed);
        req.end();
      });
    } catch (error) {
      if (refused) return fail('refused', refused, target.host);
      if (signal.aborted)
        return fail('timeout', `${target.host} took too long to answer.`, target.host);
      return fail(
        'failed',
        error instanceof Error && /Couldn’t find/.test(error.message)
          ? error.message
          : `Couldn’t reach ${target.host}.`,
        target.host,
      );
    }
    const location = response.headers.location;
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
      response.resume();
      if (!location) return fail('failed', `${target.host} sent nowhere to go.`, target.host);
      try {
        url = new URL(location, target);
      } catch {
        return fail('failed', `${target.host} sent an address that isn’t one.`, target.host);
      }
      continue;
    }
    const type = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!TEXTUAL.test(type)) {
      response.destroy();
      return fail('refused', `${target.host} sent a file, not data a page can read.`, target.host);
    }
    if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
      response.destroy();
      return fail('too-big', `${target.host} sent more than a page can take.`, target.host);
    }
    const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
    const stream =
      encoding === 'gzip'
        ? response.pipe(createGunzip())
        : encoding === 'deflate'
          ? response.pipe(createInflate())
          : encoding === 'br'
            ? response.pipe(createBrotliDecompress())
            : response;
    const read = await new Promise<Buffer | 'too-big' | 'failed'>((done) => {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          stream.destroy();
          done('too-big');
        } else chunks.push(chunk);
      });
      stream.on('end', () => done(Buffer.concat(chunks)));
      stream.on('error', () => done('failed'));
      response.on('error', () => done('failed'));
    });
    if (read === 'too-big')
      return fail('too-big', `${target.host} sent more than a page can take.`, target.host);
    if (read === 'failed')
      return signal.aborted
        ? fail('timeout', `${target.host} took too long to answer.`, target.host)
        : fail('failed', `${target.host} stopped answering halfway.`, target.host);
    return {
      ok: true,
      status: response.statusCode ?? 0,
      type,
      body: new TextDecoder('utf-8').decode(read),
      at: Date.now(),
    };
  }
  return fail('failed', 'Too many redirects.');
}

// ── Who said yes ────────────────────────────────────────────────────────

const AccessFile = z.object({ approvals: z.array(LiveDataApproval).default([]) });

/**
 * `~/.conch/artifacts/access.json`: the hosts each page may read from, and
 * the addresses you saw when you said so. Only a person in the web app
 * writes it (the assistant has no tool for it); a damaged copy is set aside
 * and pages simply ask again.
 */
export class LiveDataAccess {
  readonly path: string;
  readonly #mutex = new Mutex();

  constructor(
    home: string,
    private readonly heal?: Heal,
  ) {
    this.path = join(home, 'artifacts', 'access.json');
  }

  async list(): Promise<LiveDataApproval[]> {
    const read = await readStore(this.path, AccessFile, {
      onRepair: () =>
        this.heal?.(
          'conversations',
          'Reset the sites your pages may read from. Pages will ask again.',
        ),
    });
    return read.value.approvals;
  }

  #change(change: (list: LiveDataApproval[]) => LiveDataApproval[]) {
    return this.#mutex.run(async () => {
      const next = change(await this.list());
      await writeJson(this.path, { approvals: next });
      return next;
    });
  }

  allow(entry: LiveDataApproval) {
    return this.#change((list) => {
      const old = list.find((a) => a.artifactId === entry.artifactId && a.host === entry.host);
      const urls = [...new Set([...(old?.urls ?? []), ...entry.urls])].slice(-40);
      return [
        ...list.filter((a) => a !== old),
        { ...entry, urls, ...((entry.local || old?.local) && { local: true }) },
      ];
    });
  }

  revoke(artifactId: string, host?: string) {
    return this.#change((list) =>
      list.filter((a) => a.artifactId !== artifactId || (host !== undefined && a.host !== host)),
    );
  }
}

// ── Putting it together ─────────────────────────────────────────────────

export interface LiveDataDeps {
  access: LiveDataAccess;
  /** A page's text, by version or the draft you're editing; undefined if it's not a page. */
  page: (id: string, version: number | 'draft') => Promise<{ html: string; title: string }>;
  /** What the chat it was made in has read, in the guard's words (ADR 0028). */
  tainted: (id: string) => Promise<string | undefined>;
  gatewayPort: number;
  fetch?: typeof fetchLive;
  now?: () => number;
}

export class LiveDataError extends Error {
  constructor(
    readonly code: 'invalid' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export class LiveData {
  /** Per page: when each address was first read in the last hour. */
  readonly #reads = new Map<string, Map<string, number>>();
  /** The last answer per address, reused for a moment; and reads already on their way. */
  readonly #recent = new Map<string, { at: number; result: Promise<LiveDataResult> }>();

  constructor(private readonly deps: LiveDataDeps) {}

  get access() {
    return this.deps.access;
  }

  #now() {
    return this.deps.now?.() ?? Date.now();
  }

  #sourceView(source: Source, approvals: LiveDataApproval[], id: string): LiveDataSource {
    const approval = approvals.find((a) => a.artifactId === id && a.host === source.host);
    const known = Boolean(approval?.urls.includes(source.url));
    return {
      name: source.name,
      url: source.url,
      host: source.host,
      ...(source.every && { every: source.every }),
      local: source.local,
      allowed: Boolean(approval && known && (!source.local || approval.local)),
      changed: Boolean(approval && !known),
    };
  }

  /** What a page reads from, and what you've said about each. */
  async info(id: string, version: number | 'draft'): Promise<LiveDataInfo> {
    const { html } = await this.deps.page(id, version);
    const { sources, problem } = readSources(html);
    const approvals = await this.deps.access.list();
    const tainted = sources.length ? await this.deps.tainted(id) : undefined;
    return {
      sources: sources.map((s) => this.#sourceView(s, approvals, id)),
      ...(problem && { problem }),
      ...(tainted && { tainted }),
    };
  }

  /** You said this page may read from this host: the addresses on it you saw, and only those. */
  async approve(id: string, version: number | 'draft', host: string, local?: boolean) {
    const { html } = await this.deps.page(id, version);
    const on = readSources(html).sources.filter((s) => s.host === host.toLowerCase());
    if (!on.length) throw new LiveDataError('invalid', 'This page doesn’t read from there.');
    if (on.some((s) => s.local) && !local)
      throw new LiveDataError(
        'invalid',
        'That address is on this computer. Say it may read from this computer too.',
      );
    this.#forgetReads(id);
    await this.deps.access.allow({
      artifactId: id,
      host: host.toLowerCase(),
      urls: on.map((s) => s.url),
      at: this.#now(),
      ...(on.some((s) => s.local) && { local: true }),
    });
    return this.info(id, version);
  }

  /** At most `perHour` different addresses an hour, per page. */
  #budget(id: string, url: string): boolean {
    const now = this.#now();
    const reads = this.#reads.get(id) ?? new Map<string, number>();
    for (const [u, at] of reads) if (now - at > 3_600_000) reads.delete(u);
    this.#reads.set(id, reads);
    if (reads.has(url)) return true;
    if (reads.size >= LIVE_DATA.perHour) return false;
    reads.set(url, now);
    return true;
  }

  /** A page asked for a source: read it, if it may. */
  async read(
    id: string,
    version: number | 'draft',
    request: LiveDataRequest,
  ): Promise<LiveDataResult> {
    const { html } = await this.deps.page(id, version);
    const { sources, problem } = readSources(html);
    if (problem) return fail('refused', problem);
    const source = sources.find((s) => s.name === request.source);
    if (!source) return fail('refused', `This page doesn’t declare “${request.source}”.`);
    const filled = fillSource(source, request.params);
    if ('problem' in filled) return fail('refused', filled.problem);
    const approvals = (await this.deps.access.list()).filter((a) => a.artifactId === id);
    const view = this.#sourceView(source, approvals, id);
    if (!view.allowed)
      return fail(
        'needs-approval',
        view.changed
          ? `This page now reads a different address on ${source.host}.`
          : `This page wants to read from ${source.host}.`,
        source.host,
      );
    const key = `${id}\n${filled.url}`;
    const recent = this.#recent.get(key);
    if (recent && this.#now() - recent.at < LIVE_DATA.reuseMs) return recent.result;
    if (!this.#budget(id, filled.url))
      return fail(
        'busy',
        'This page has read a lot in the last hour, so Conch is holding off for a while.',
        source.host,
      );
    const result = (this.deps.fetch ?? fetchLive)(filled.url, {
      local: Boolean(approvals.find((a) => a.host === source.host)?.local),
      gatewayPort: this.deps.gatewayPort,
      hosts: new Set(approvals.map((a) => a.host)),
    });
    this.#recent.set(key, { at: this.#now(), result });
    if (this.#recent.size > 200)
      for (const [k, v] of this.#recent)
        if (this.#now() - v.at > LIVE_DATA.reuseMs) this.#recent.delete(k);
    return result;
  }

  /** Answers kept for a moment are from before this change: read afresh. */
  #forgetReads(id: string) {
    for (const key of this.#recent.keys()) if (key.startsWith(`${id}\n`)) this.#recent.delete(key);
  }

  /** You took it back: the page asks again, and nothing read before is reused. */
  revoke(id: string, host: string) {
    this.#forgetReads(id);
    return this.deps.access.revoke(id, host.toLowerCase());
  }

  /** A deleted page takes what it was allowed with it. */
  forget(id: string) {
    this.#reads.delete(id);
    this.#forgetReads(id);
    return this.deps.access.revoke(id);
  }
}
