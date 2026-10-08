/**
 * Places: coffee near the Ritz, where the Louvre is, how far Brighton is
 * from London. Found in OpenStreetMap and drawn as a map with a list
 * (`ToolView` kind `places`), while the model reads the same places as JSON.
 *
 * What leaves the computer: the words asked about and the place named go to
 * OpenStreetMap's own services — Nominatim to find the place, Overpass to
 * find what's around it, and the tile server for a few map pictures. No
 * cookies, no sign-in, through the same SSRF-guarded public fetcher as
 * `web_fetch`.
 *
 * Their usage policies, kept: every request says it's Conch (a User-Agent
 * of its own), Nominatim is asked at most once a second across the whole
 * gateway, answers and tiles are remembered for a while so a question asked
 * twice isn't asked again, and a map is a handful of tiles (at most nine),
 * never a bulk download. The attribution is part of the view and always in
 * sight on the card.
 */
import {
  OSM_ATTRIBUTION,
  PLACES_MAX,
  PLACES_TILE_SIZE,
  type Attachment,
  type PlaceItem,
  type PlacesView,
} from '@conch/protocol';
import { z } from 'zod';

import type { AttachmentStore } from '../attachments/store';
import type { AppFetcher, AppFetchResponse } from '../conchapps/types';
import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import { SERVER_VERSION } from '../version';
import { openNow } from './hours';
import { capturePictures } from './pictures';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
export const OVERPASS = 'https://overpass-api.de/api/interpreter';
export const TILES = 'https://tile.openstreetmap.org';
/** Who's asking, as OpenStreetMap's policies want every app to say. */
export const PLACES_USER_AGENT = `Conch/${SERVER_VERSION} (self-hosted assistant; +https://github.com/conchagent/conch)`;

// ── Web Mercator ────────────────────────────────────────────────────────────

const MAX_LAT = 85.05112878;

/** A point's place on the world map at `zoom`, in tile pixels from the top left. */
export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = PLACES_TILE_SIZE * 2 ** zoom;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

/** The point at a world pixel: `worldPixel` the other way round. */
export function pixelPoint(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const size = PLACES_TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI, lon: (x / size) * 360 - 180 };
}

/** Metres between two points, as the crow flies. */
export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad,
    dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Mosaic {
  zoom: number;
  /** The top-left tile. */
  x: number;
  y: number;
  cols: number;
  rows: number;
}

/**
 * The closest zoom whose `cols` × `rows` tiles hold every point with `pad`
 * pixels to spare, and which tiles those are. One point alone is shown at
 * `maxZoom`.
 */
export function fitMosaic(
  points: readonly { lat: number; lon: number }[],
  { cols = 3, rows = 2, pad = 28, minZoom = 2, maxZoom = 17 } = {},
): Mosaic {
  const t = PLACES_TILE_SIZE;
  const at = (zoom: number) => {
    const px = points.map((p) => worldPixel(p.lat, p.lon, zoom));
    const xs = px.map((p) => p.x),
      ys = px.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const n = 2 ** zoom;
    const x = Math.max(0, Math.min(n - cols, Math.round((x0 + x1) / 2 / t - cols / 2)));
    const y = Math.max(0, Math.min(n - rows, Math.round((y0 + y1) / 2 / t - rows / 2)));
    const fits =
      x0 - pad >= x * t &&
      x1 + pad <= (x + cols) * t &&
      y0 - pad >= y * t &&
      y1 + pad <= (y + rows) * t;
    return { mosaic: { zoom, x, y, cols, rows }, fits };
  };
  for (let zoom = maxZoom; zoom > minZoom; zoom--) {
    const tried = at(zoom);
    if (tried.fits) return tried.mosaic;
  }
  return at(minZoom).mosaic;
}

/** The tiles' addresses, row by row from the top left. */
export function tileUrls(m: Mosaic): string[] {
  return Array.from({ length: m.rows * m.cols }, (_, i) => {
    const x = m.x + (i % m.cols),
      y = m.y + Math.floor(i / m.cols);
    return `${TILES}/${m.zoom}/${x}/${y}.png`;
  });
}

// ── Being a good neighbour: spacing, remembering ────────────────────────────

/** Lets one request through at a time, at least `gap` ms after the last one started. */
export class Spacing {
  #last = -Infinity;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    readonly gap: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Waits for its turn, then runs `job`. Its turn is given up if `signal` aborts while waiting. */
  run<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const turn = this.#queue.then(async () => {
      signal?.throwIfAborted();
      const wait = this.#last + this.gap - this.now();
      if (wait > 0) await this.sleep(wait);
      signal?.throwIfAborted();
      this.#last = this.now();
    });
    this.#queue = turn.catch(() => undefined);
    return turn.then(job);
  }
}

/** A small map that forgets: at most `max` entries, each for `ttl` ms. */
export class Recent<V> {
  readonly #items = new Map<string, { value: V; at: number }>();

  constructor(
    readonly max: number,
    readonly ttl: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.#items.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttl) {
      this.#items.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V) {
    this.#items.delete(key);
    this.#items.set(key, { value, at: this.now() });
    for (const key of this.#items.keys()) {
      if (this.#items.size <= this.max) break;
      this.#items.delete(key);
    }
  }
}

// ── What kind of place ──────────────────────────────────────────────────────

/** Words people use → OpenStreetMap tags (`key=value` or `key~regex`). */
const CATEGORIES: [RegExp, string[]][] = [
  [/^(coffee|coffee ?shops?|cafes?|caf[eé]s?|espresso|flat white)$/, ['amenity=cafe']],
  [/^(tea ?rooms?|tea)$/, ['amenity=cafe', 'shop=tea']],
  [
    /^(restaurants?|food|dinner|lunch|eat|eating|places to eat|brunch|breakfast)$/,
    ['amenity=restaurant'],
  ],
  [/^(bars?|pubs?|drinks?|beer|cocktails?|wine bars?)$/, ['amenity~^(bar|pub|biergarten)$']],
  [/^(fast ?food|takeaway|take-away|takeout)$/, ['amenity=fast_food']],
  [/^(ice ?cream|gelato)$/, ['amenity=ice_cream']],
  [/^(bakery|bakeries|bread|pastr(y|ies))$/, ['shop=bakery']],
  [/^(supermarkets?|groceries|grocery|food shop)$/, ['shop~^(supermarket|convenience)$']],
  [/^(pharmac(y|ies)|chemists?|drug ?stores?)$/, ['amenity=pharmacy']],
  [/^(atms?|cash ?machines?|cash)$/, ['amenity=atm']],
  [/^(banks?)$/, ['amenity=bank']],
  [/^(museums?)$/, ['tourism=museum']],
  [/^(galler(y|ies)|art)$/, ['tourism=gallery']],
  [/^(sights?|attractions?|things to do|landmarks?)$/, ['tourism~^(attraction|viewpoint)$']],
  [/^(hotels?|places to stay|accommodation|hostels?)$/, ['tourism~^(hotel|hostel|guest_house)$']],
  [/^(parks?|gardens?)$/, ['leisure~^(park|garden)$']],
  [/^(playgrounds?)$/, ['leisure=playground']],
  [/^(gyms?|fitness)$/, ['leisure=fitness_centre']],
  [/^(libraries|library)$/, ['amenity=library']],
  [/^(cinemas?|movies)$/, ['amenity=cinema']],
  [/^(theatres?|theaters?)$/, ['amenity=theatre']],
  [/^(hospitals?|a ?& ?e|emergency)$/, ['amenity=hospital']],
  [/^(doctors?|gp|clinics?)$/, ['amenity~^(doctors|clinic)$']],
  [/^(dentists?)$/, ['amenity=dentist']],
  [/^(petrol|gas|fuel|gas stations?|petrol stations?)$/, ['amenity=fuel']],
  [/^(ev ?charging|chargers?|charging( stations?)?)$/, ['amenity=charging_station']],
  [/^(parking|car ?parks?)$/, ['amenity=parking']],
  [/^(toilets?|restrooms?|loos?|wc)$/, ['amenity=toilets']],
  [/^(post ?offices?)$/, ['amenity=post_office']],
  [/^(book ?shops?|bookstores?|books)$/, ['shop=books']],
  [/^(florists?|flowers)$/, ['shop=florist']],
  [/^(hairdressers?|barbers?|haircut)$/, ['shop=hairdresser']],
  [/^(bike shops?|bicycle shops?)$/, ['shop=bicycle']],
];
/** Cuisines asked for by name: "sushi" means restaurants serving it. */
const CUISINES =
  /^(sushi|ramen|pizza|burgers?|indian|thai|chinese|italian|japanese|korean|vietnamese|mexican|french|greek|turkish|lebanese|spanish|tapas|seafood|fish and chips|steak|vegan|vegetarian|noodles?|dumplings?|kebab|falafel|bbq|barbecue|curry)$/;

const quoteOverpass = (s: string) => s.replace(/[\\"]/g, '\\$&');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The Overpass filters for what was asked: tags for a kind of place, a cuisine, or a name. */
export function filtersFor(what: string): string[] {
  const w = what
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^(?:(?:a|an|the|some|good|nice|best|great) )+/, '');
  for (const [words, tags] of CATEGORIES)
    if (words.test(w))
      return tags.map((tag) => {
        const [, k, op, v] = /^([a-z_:]+)([=~])(.+)$/.exec(tag) ?? [];
        return `[${k ?? ''}${op ?? '='}"${quoteOverpass(v ?? '')}"]`;
      });
  const cuisine = CUISINES.exec(w)?.[1];
  if (cuisine) {
    const stem = cuisine.replace(/^(burger|noodle|dumpling)s$/, '$1').replace(/^bbq$/, 'barbecue');
    if (/^(vegan|vegetarian)$/.test(stem))
      return [`[amenity~"^(restaurant|cafe|fast_food)$"]["diet:${stem}"~"^(yes|only)$"]`];
    return [
      `[amenity~"^(restaurant|fast_food)$"][cuisine~"${quoteOverpass(escapeRegex(stem.replace(/ /g, '_')))}",i]`,
    ];
  }
  const name = quoteOverpass(escapeRegex(what.trim().slice(0, 80)));
  return [
    `[name~"${name}",i][amenity]`,
    `[name~"${name}",i][shop]`,
    `[name~"${name}",i][tourism]`,
    `[name~"${name}",i][leisure]`,
  ];
}

/** One bounded Overpass question: what's within `radius` of a point, and its time zone. */
export function overpassQuery(
  filters: readonly string[],
  at: { lat: number; lon: number },
  radius: number,
): string {
  const point = `${at.lat.toFixed(6)},${at.lon.toFixed(6)}`;
  return [
    '[out:json][timeout:15][maxsize:4000000];',
    `(${filters.map((f) => `nwr(around:${Math.round(radius)},${point})${f}[name];`).join('')});`,
    'out center tags 60;',
    `is_in(${point})->.a;`,
    'area.a[timezone];',
    'out tags;',
  ].join('\n');
}

// ── Reading what came back ──────────────────────────────────────────────────

const Num = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);
export const NominatimHit = z.object({
  lat: Num,
  lon: Num,
  name: z.string().optional(),
  display_name: z.string(),
  category: z.string().optional(),
  type: z.string().optional(),
  osm_type: z.enum(['node', 'way', 'relation']).optional(),
  osm_id: z.number().optional(),
  boundingbox: z.tuple([Num, Num, Num, Num]).optional(),
  address: z.record(z.string(), z.string()).optional(),
  extratags: z.record(z.string(), z.string()).nullable().optional(),
});
export type NominatimHit = z.infer<typeof NominatimHit>;

const OverpassElement = z.object({
  type: z.enum(['node', 'way', 'relation', 'area']),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
const OverpassAnswer = z.object({ elements: z.array(z.unknown()) });

/** Single-zone countries by their ISO code, for when OpenStreetMap doesn't say the zone. */
const COUNTRY_ZONES: Record<string, string> = {
  gb: 'Europe/London',
  ie: 'Europe/Dublin',
  fr: 'Europe/Paris',
  de: 'Europe/Berlin',
  es: 'Europe/Madrid',
  it: 'Europe/Rome',
  nl: 'Europe/Amsterdam',
  be: 'Europe/Brussels',
  ch: 'Europe/Zurich',
  at: 'Europe/Vienna',
  dk: 'Europe/Copenhagen',
  se: 'Europe/Stockholm',
  no: 'Europe/Oslo',
  fi: 'Europe/Helsinki',
  pl: 'Europe/Warsaw',
  cz: 'Europe/Prague',
  hu: 'Europe/Budapest',
  gr: 'Europe/Athens',
  pt: 'Europe/Lisbon',
  tr: 'Europe/Istanbul',
  jp: 'Asia/Tokyo',
  kr: 'Asia/Seoul',
  cn: 'Asia/Shanghai',
  in: 'Asia/Kolkata',
  sg: 'Asia/Singapore',
  hk: 'Asia/Hong_Kong',
  th: 'Asia/Bangkok',
  vn: 'Asia/Ho_Chi_Minh',
  ae: 'Asia/Dubai',
  il: 'Asia/Jerusalem',
  nz: 'Pacific/Auckland',
  za: 'Africa/Johannesburg',
  eg: 'Africa/Cairo',
  ke: 'Africa/Nairobi',
  ng: 'Africa/Lagos',
  ar: 'America/Argentina/Buenos_Aires',
  co: 'America/Bogota',
  pe: 'America/Lima',
  cl: 'America/Santiago',
};

const words = (s: string) => s.replace(/_/g, ' ').replace(/;/g, ', ');
const clip = (s: string | undefined, n: number) =>
  (s ? s.trim().slice(0, n) : undefined) || undefined;

/** A web link worth offering: https only (an `http` site is asked for securely), no sign-in in it. */
export function secureLink(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim().split(/[;\s]/)[0] ?? '';
  const withScheme = /^https?:\/\//i.test(text)
    ? text
    : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(text)
      ? `https://${text}`
      : '';
  try {
    const url = new URL(withScheme.replace(/^http:/i, 'https:'));
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2000)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function categoryOf(tags: Record<string, string>): string {
  for (const key of ['amenity', 'shop', 'tourism', 'leisure', 'historic', 'office', 'craft'])
    if (tags[key] && tags[key] !== 'yes') return words(tags[key]).slice(0, 60);
  return 'place';
}

function addressOf(tags: Record<string, string>): string | undefined {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const town = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
  return clip([street, town].filter(Boolean).join(', ') || tags['addr:full'], 300);
}

export function directions(
  to: { lat: number; lon: number; name: string },
  from?: { lat: number; lon: number },
) {
  const p = `${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
  const apple = new URL('https://maps.apple.com/');
  apple.searchParams.set('daddr', p);
  apple.searchParams.set('q', to.name.slice(0, 120));
  const google = new URL('https://www.google.com/maps/dir/');
  google.searchParams.set('api', '1');
  google.searchParams.set('destination', p);
  const osm = new URL('https://www.openstreetmap.org/directions');
  if (from) {
    const f = `${from.lat.toFixed(6)},${from.lon.toFixed(6)}`;
    apple.searchParams.set('saddr', f);
    google.searchParams.set('origin', f);
    osm.searchParams.set('route', `${f};${p}`);
  } else osm.searchParams.set('to', p);
  return { apple: apple.href, google: google.href, osm: osm.href };
}

/** A place from Overpass, ready for the card; `undefined` when it has no name or no point. */
export function placeFromElement(
  raw: unknown,
  near: { lat: number; lon: number },
  zone: string | undefined,
  at: Date,
): PlaceItem | undefined {
  const parsed = OverpassElement.safeParse(raw);
  if (!parsed.success || parsed.data.type === 'area') return undefined;
  const e = parsed.data;
  const tags = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat,
    lon = e.lon ?? e.center?.lon;
  const name = clip(tags.name, 200);
  if (lat === undefined || lon === undefined || !name) return undefined;
  const hours = clip(tags.opening_hours, 400);
  const open = openNow(hours, zone, at);
  const wheelchair = tags.wheelchair;
  return {
    name,
    category: categoryOf(tags),
    lat,
    lon,
    ...(addressOf(tags) && { address: addressOf(tags) }),
    distance: Math.round(haversine(near, { lat, lon })),
    ...(hours && { hours }),
    ...(open && { openNow: open }),
    ...(secureLink(tags.website ?? tags['contact:website']) && {
      website: secureLink(tags.website ?? tags['contact:website']),
    }),
    ...(clip(tags.phone ?? tags['contact:phone'], 60) && {
      phone: clip((tags.phone ?? tags['contact:phone'] ?? '').split(';')[0], 60),
    }),
    ...(tags.cuisine && { cuisine: words(tags.cuisine).slice(0, 120) }),
    ...((wheelchair === 'yes' || wheelchair === 'limited' || wheelchair === 'no') && {
      wheelchair,
    }),
    url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    directions: directions({ lat, lon, name }),
  };
}

/** "51.5074, -0.1278": a point typed as numbers, not a name to look up. */
export function pointIn(text: string): { lat: number; lon: number } | undefined {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  const lat = Number(m[1]),
    lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}

// ── The tool ────────────────────────────────────────────────────────────────

export interface PlacesDeps {
  fetcher: AppFetcher;
  store: AttachmentStore;
  now?: () => number;
}

/** One gateway, one pace: Nominatim's one request a second, Overpass one at a time. */
const shared = {
  nominatim: new Spacing(1100),
  overpass: new Spacing(1000),
  geocoded: new Recent<NominatimHit | null>(200, 30 * 60_000),
  found: new Recent<unknown[]>(100, 10 * 60_000),
  tiles: new Recent<AppFetchResponse>(160, 24 * 60 * 60_000),
};
export type PlacesShared = typeof shared;
export const newPlacesShared = (
  now: () => number = Date.now,
  sleep?: (ms: number) => Promise<void>,
): PlacesShared => ({
  nominatim: new Spacing(1100, now, sleep),
  overpass: new Spacing(1000, now, sleep),
  geocoded: new Recent(200, 30 * 60_000, now),
  found: new Recent(100, 10 * 60_000, now),
  tiles: new Recent(160, 24 * 60 * 60_000, now),
});

const headers = (accept: string) => ({
  accept,
  'user-agent': PLACES_USER_AGENT,
  'accept-language': 'en',
});

/** The places a call found, and what the card and the model get from them. */
export class Places {
  constructor(
    private readonly deps: PlacesDeps,
    private readonly memo: PlacesShared = shared,
  ) {}

  async #json(
    who: string,
    url: string,
    signal: AbortSignal,
    init: { method?: 'GET' | 'POST'; body?: string } = {},
  ): Promise<unknown> {
    const target = new URL(url);
    const response = await this.deps.fetcher(
      { id: `places-${who}`, reaches: [target.hostname] },
      {
        url: target.href,
        method: init.method ?? 'GET',
        headers: {
          ...headers('application/json'),
          ...(init.body && { 'content-type': 'application/x-www-form-urlencoded' }),
        },
        ...(init.body && { body: init.body }),
      },
      signal,
    );
    signal.throwIfAborted();
    if (response.refused) throw new Error(response.refused);
    if (response.status === 429 || response.status === 504)
      throw new Error(
        'OpenStreetMap is busy right now. Wait a few seconds and try once more, or search the web instead.',
      );
    if (!response.ok)
      throw new Error(
        `OpenStreetMap answered ${response.status}. Try again shortly, or search the web instead.`,
      );
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new Error(
        'OpenStreetMap sent something that isn’t a list of places. Try again shortly.',
      );
    }
  }

  /** Where a place is, by name (Nominatim), or `undefined` when nothing's called that. */
  async geocode(query: string, signal: AbortSignal): Promise<NominatimHit | undefined> {
    const key = query.trim().toLowerCase();
    const known = this.memo.geocoded.get(key);
    if (known !== undefined) return known ?? undefined;
    const url = new URL(NOMINATIM);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query.trim().slice(0, 200));
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('extratags', '1');
    const body = await this.memo.nominatim.run(
      () => this.#json('nominatim', url.href, signal),
      signal,
    );
    const list = z.array(z.unknown()).safeParse(body);
    const hit =
      list.success && list.data[0] !== undefined ? NominatimHit.safeParse(list.data[0]) : undefined;
    const found = hit?.success ? hit.data : null;
    this.memo.geocoded.set(key, found);
    return found ?? undefined;
  }

  /** What's around a point (Overpass): its raw elements, places and time zones. */
  async around(
    filters: string[],
    at: { lat: number; lon: number },
    radius: number,
    signal: AbortSignal,
  ) {
    const query = overpassQuery(filters, at, radius);
    const known = this.memo.found.get(query);
    if (known) return known;
    const body = await this.memo.overpass.run(
      () =>
        this.#json('overpass', OVERPASS, signal, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
        }),
      signal,
    );
    const parsed = OverpassAnswer.safeParse(body);
    if (!parsed.success)
      throw new Error(
        'OpenStreetMap sent something that isn’t a list of places. Try again shortly.',
      );
    this.memo.found.set(query, parsed.data.elements);
    return parsed.data.elements;
  }

  /** The map's tiles, kept as the chat's own pictures. A tile fetched lately is reused. */
  async tiles(
    conversationId: string,
    m: Mosaic,
    signal: AbortSignal,
  ): Promise<(Attachment | null)[]> {
    const memo = this.memo.tiles;
    const fetcher: AppFetcher = async (app, request, sig) => {
      const known = memo.get(request.url);
      if (known) return known;
      const response = await this.deps.fetcher(
        app,
        { ...request, headers: { ...request.headers, 'user-agent': PLACES_USER_AGENT } },
        sig,
      );
      if (response.ok && response.bodyBase64) memo.set(request.url, response);
      return response;
    };
    const urls = tileUrls(m);
    const names = urls.map(
      (_, i) => `Map tile ${m.zoom}-${m.x + (i % m.cols)}-${m.y + Math.floor(i / m.cols)}`,
    );
    const got = await capturePictures(
      { fetcher, store: this.deps.store },
      conversationId,
      urls,
      signal,
      names,
    );
    return got.map((a) => a ?? null);
  }

  /** The view and the model's text for one call. */
  async find(
    conversationId: string,
    args: { what?: string; near: string; from?: string; radius: number; limit: number },
    signal: AbortSignal,
  ): Promise<{ text: string; view: PlacesView }> {
    const now = new Date(this.deps.now?.() ?? Date.now());
    const point = pointIn(args.near);
    const hit = point ? undefined : await this.geocode(args.near, signal);
    if (!point && !hit)
      throw new Error(
        `OpenStreetMap doesn’t know a place called “${args.near.slice(0, 120)}”. Try a fuller name with its town or country, or ask the person where they mean.`,
      );
    const center = point ?? { lat: Number(hit?.lat), lon: Number(hit?.lon) };
    const nearName =
      clip(hit?.name || hit?.display_name.split(',')[0], 200) ?? args.near.slice(0, 200);
    const country = hit?.address?.country_code?.toLowerCase();
    let items: PlaceItem[];
    let origin: PlacesView['origin'];
    let mode: PlacesView['mode'] = 'nearby';
    let frame: { lat: number; lon: number }[];
    let maxZoom = 17;
    if (args.what) {
      const elements = await this.around(filtersFor(args.what), center, args.radius, signal);
      const zone =
        elements.flatMap((e) => {
          const p = OverpassElement.safeParse(e);
          return p.success && p.data.type === 'area' && p.data.tags?.timezone
            ? [p.data.tags.timezone]
            : [];
        })[0] ?? (country ? COUNTRY_ZONES[country] : undefined);
      const seen = new Set<string>();
      items = elements
        .flatMap((e) => placeFromElement(e, center, zone, now) ?? [])
        .filter((p) => {
          const key = `${p.name.toLowerCase()}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
        .slice(0, Math.min(args.limit, PLACES_MAX));
      origin = { name: nearName, lat: center.lat, lon: center.lon };
      frame = [center, ...items];
    } else {
      mode = 'place';
      const fromPoint = args.from ? pointIn(args.from) : undefined;
      const fromHit = args.from && !fromPoint ? await this.geocode(args.from, signal) : undefined;
      if (args.from && !fromPoint && !fromHit)
        throw new Error(
          `OpenStreetMap doesn’t know a place called “${args.from.slice(0, 120)}”. Try a fuller name with its town or country.`,
        );
      const start =
        fromPoint ?? (fromHit ? { lat: Number(fromHit.lat), lon: Number(fromHit.lon) } : undefined);
      const fromName =
        (fromHit && clip(fromHit.name || fromHit.display_name.split(',')[0], 200)) ??
        args.from ??
        '';
      const tags = { ...(hit?.extratags ?? {}) };
      const zone = tags.timezone ?? (country ? COUNTRY_ZONES[country] : undefined);
      const hours = clip(tags.opening_hours, 400);
      const open = openNow(hours, zone, now);
      const website = secureLink(tags.website ?? tags['contact:website']);
      const phone = clip((tags.phone ?? tags['contact:phone'] ?? '').split(';')[0], 60);
      items = [
        {
          name: nearName,
          category: words(
            hit?.type && hit.type !== 'yes' ? hit.type : (hit?.category ?? 'place'),
          ).slice(0, 60),
          lat: center.lat,
          lon: center.lon,
          ...(hit && { address: clip(hit.display_name, 300) }),
          ...(start && { distance: Math.round(haversine(start, center)) }),
          ...(hours && { hours }),
          ...(open && { openNow: open }),
          ...(website && { website }),
          ...(phone && { phone }),
          url:
            hit?.osm_type && hit.osm_id
              ? `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}`
              : `https://www.openstreetmap.org/?mlat=${center.lat.toFixed(6)}&mlon=${center.lon.toFixed(6)}#map=16/${center.lat.toFixed(5)}/${center.lon.toFixed(5)}`,
          directions: directions({ ...center, name: nearName }, start),
        },
      ];
      if (start) origin = { name: fromName.slice(0, 200), ...start };
      // Its outline's box (south, north, west, east), so a city is shown whole and a café close up.
      const [south, north, west, east] = hit?.boundingbox?.map(Number) ?? [];
      frame = [
        center,
        ...(start ? [start] : []),
        ...(!start &&
        south !== undefined &&
        north !== undefined &&
        west !== undefined &&
        east !== undefined
          ? [
              { lat: south, lon: west },
              { lat: north, lon: east },
            ]
          : []),
      ];
      maxZoom = 16;
    }
    const mosaic = fitMosaic(frame, { maxZoom });
    const tiles = await this.tiles(conversationId, mosaic, signal);
    const view: PlacesView = {
      kind: 'places',
      mode,
      ...(args.what && { query: args.what.slice(0, 200) }),
      ...(origin && { origin }),
      center,
      zoom: mosaic.zoom,
      // The grid even when a tile couldn't be fetched: the card draws a quiet plan in its place.
      map: { ...mosaic, tiles },
      attribution: OSM_ATTRIBUTION,
      items,
    };
    const text = JSON.stringify({
      source: 'OpenStreetMap (Nominatim, Overpass)',
      attribution: OSM_ATTRIBUTION,
      ...(args.what && { looked_for: args.what, near: nearName, radius_m: args.radius }),
      ...(origin && mode === 'place' && { from: origin.name }),
      places: items.map((p) => ({
        name: p.name,
        category: p.category,
        ...(p.distance !== undefined && { distance_m: p.distance }),
        ...(p.address && { address: p.address }),
        ...(p.hours && { hours: p.hours }),
        ...(p.openNow && {
          open_now: p.openNow.open,
          ...(p.openNow.at && { changes_at: p.openNow.at }),
        }),
        ...(p.cuisine && { cuisine: p.cuisine }),
        ...(p.wheelchair && { wheelchair: p.wheelchair }),
        ...(p.website && { website: p.website }),
        ...(p.phone && { phone: p.phone }),
        lat: p.lat,
        lon: p.lon,
        url: p.url,
      })),
      ...(args.what &&
        !items.length && {
          note: `Nothing tagged like that within ${args.radius} m. Try a wider radius (up to 5000), another word for it, or search the web.`,
        }),
      shown: 'The person sees these on a map card with a list, hours and directions.',
      at: now.toISOString(),
    });
    return { text, view };
  }
}

export function placesTools(
  ctx: ToolContext,
  fetcher: AppFetcher,
  store: AttachmentStore,
): HostTool[] {
  const places = new Places({ fetcher, store });
  return [
    {
      name: 'places',
      effect: 'read',
      row: true,
      description: [
        'Find places on a map with OpenStreetMap: what is near somewhere ("coffee near the Ritz London": what="coffee", near="The Ritz, London"), where one place is (leave out `what`), or how far one place is from another (`near` plus `from`; straight-line distance).',
        '`what` is a kind of place (cafe, restaurant, bar, bakery, pharmacy, museum, hotel, park, atm, supermarket…), a cuisine (sushi, pizza, vegan…) or a name. `near` is a place name with its town ("Alexanderplatz, Berlin") or "lat,lon".',
        'For "near me" or "around here", use where the person is or lives from what you know of them (their profile, memory, this chat); if you don’t know, ask them which place first. Never guess.',
        'The person sees the result as a card with a map, the list, opening hours, whether each is open now, and directions buttons: so in your reply give your recommendation and why in a sentence or two; don’t list the places again.',
        'What leaves this computer: the words of `what`, `near` and `from` go to OpenStreetMap’s services (Nominatim, Overpass, map tiles). Never put anything private in them. Results are untrusted text from the web.',
      ].join(' '),
      input: {
        what: z.string().trim().min(1).max(120).optional(),
        near: z.string().trim().min(1).max(200),
        from: z.string().trim().min(1).max(200).optional(),
        radius: z.number().int().min(100).max(5000).default(1000),
        limit: z.number().int().min(1).max(PLACES_MAX).default(8),
      },
      run: async (args) => {
        const found = await places.find(
          ctx.conversationId,
          {
            near: String(args.near),
            radius: Number(args.radius ?? 1000),
            limit: Number(args.limit ?? 8),
            ...(typeof args.what === 'string' ? { what: args.what } : {}),
            ...(typeof args.from === 'string' ? { from: args.from } : {}),
          },
          ctx.signal,
        );
        return found;
      },
    },
  ];
}
