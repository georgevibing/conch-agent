import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentStore } from '../attachments/store';
import type { AppFetcher, AppFetchRequest, AppFetchResponse } from '../conchapps/types';
import { cleanView } from '../conversations/views';
import { sinkReason, taintFrom } from '../conversations/taint';
import {
  Places,
  PLACES_USER_AGENT,
  Recent,
  Spacing,
  filtersFor,
  fitMosaic,
  haversine,
  newPlacesShared,
  overpassQuery,
  pixelPoint,
  placeFromElement,
  pointIn,
  secureLink,
  tileUrls,
  worldPixel,
} from './places';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const signal = new AbortController().signal;
let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const RITZ = { lat: 51.50715, lon: -0.14168 };

/** Nominatim's answer for the Ritz, trimmed. */
const NOMINATIM_RITZ = [
  {
    lat: '51.5071500',
    lon: '-0.1416800',
    name: 'The Ritz',
    display_name: 'The Ritz, 150, Piccadilly, St. James’s, London, W1J 9BR, United Kingdom',
    category: 'tourism',
    type: 'hotel',
    osm_type: 'way',
    osm_id: 4256268,
    boundingbox: ['51.5068', '51.5075', '-0.1423', '-0.1410'],
    address: { city: 'London', country_code: 'gb' },
    extratags: { website: 'http://www.theritzlondon.com/', opening_hours: '24/7' },
  },
];
/** Overpass's answer: two cafés (one a way with a centre), a nameless one, and the zone. */
const OVERPASS_CAFES = {
  elements: [
    {
      type: 'node',
      id: 1,
      lat: 51.5079,
      lon: -0.1401,
      tags: {
        amenity: 'cafe',
        name: 'Caffè Concerto',
        opening_hours: 'Mo-Fr 08:00-18:00; Sa 09:00-14:00',
        'addr:housenumber': '12',
        'addr:street': 'Piccadilly',
        website: 'https://example.cafe/',
        phone: '+44 20 0000 0000;+44 20 1111 1111',
        cuisine: 'coffee_shop;italian',
        wheelchair: 'limited',
      },
    },
    {
      type: 'way',
      id: 2,
      center: { lat: 51.5062, lon: -0.1428 },
      tags: { amenity: 'cafe', name: 'Green Park Kiosk', website: 'javascript:alert(1)' },
    },
    { type: 'node', id: 3, lat: 51.5, lon: -0.14, tags: { amenity: 'cafe' } },
    { type: 'area', id: 3600062149, tags: { timezone: 'Europe/London', name: 'United Kingdom' } },
  ],
};

function fakeOsm(overrides: Partial<Record<'nominatim' | 'overpass' | 'tile', unknown>> = {}) {
  const calls: AppFetchRequest[] = [];
  const fetcher = vi.fn<AppFetcher>(async (_app, request): Promise<AppFetchResponse> => {
    calls.push(request);
    const host = new URL(request.url).hostname;
    if (host === 'nominatim.openstreetmap.org') {
      const body = overrides.nominatim ?? NOMINATIM_RITZ;
      return { ok: true, status: 200, headers: {}, body: JSON.stringify(body) };
    }
    if (host === 'overpass-api.de') {
      if (overrides.overpass === 429) return { ok: false, status: 429, headers: {}, body: '' };
      return {
        ok: true,
        status: 200,
        headers: {},
        body: JSON.stringify(overrides.overpass ?? OVERPASS_CAFES),
      };
    }
    if (host === 'tile.openstreetmap.org') {
      if (overrides.tile === 'refuse') return { ok: false, status: 403, headers: {}, body: '' };
      return {
        ok: true,
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: PNG.toString('base64'),
        bodyBase64: true,
      };
    }
    return { ok: false, status: 404, headers: {}, body: '', refused: 'Not allowed.' };
  });
  return { fetcher, calls };
}

async function places(fetcher: AppFetcher) {
  dir = await mkdtemp(join(tmpdir(), 'conch-places-'));
  const store = new AttachmentStore(dir);
  const memo = newPlacesShared(Date.now, async () => undefined);
  return {
    store,
    places: new Places(
      { fetcher, store, now: () => Date.parse('2026-10-07T10:00:00+01:00') },
      memo,
    ),
  };
}

describe('tile maths', () => {
  it('puts points where Web Mercator does, and back again', () => {
    expect(worldPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(worldPixel(85.05112878, -180, 1).y).toBeCloseTo(0, 3);
    const p = worldPixel(RITZ.lat, RITZ.lon, 16);
    // The Ritz is in tile 16/32742/21792.
    expect(Math.floor(p.x / 256)).toBe(32742);
    expect(Math.floor(p.y / 256)).toBe(21792);
    const back = pixelPoint(p.x, p.y, 16);
    expect(back.lat).toBeCloseTo(RITZ.lat, 6);
    expect(back.lon).toBeCloseTo(RITZ.lon, 6);
  });

  it('fits every point in a small mosaic at the closest zoom', () => {
    const points = [RITZ, { lat: 51.5079, lon: -0.1401 }, { lat: 51.5062, lon: -0.1428 }];
    const m = fitMosaic(points);
    expect(m).toMatchObject({ cols: 3, rows: 2 });
    for (const p of points) {
      const px = worldPixel(p.lat, p.lon, m.zoom);
      expect(px.x).toBeGreaterThanOrEqual(m.x * 256 + 28);
      expect(px.x).toBeLessThanOrEqual((m.x + 3) * 256 - 28);
      expect(px.y).toBeGreaterThanOrEqual(m.y * 256 + 28);
      expect(px.y).toBeLessThanOrEqual((m.y + 2) * 256 - 28);
    }
    // One step closer no longer fits.
    expect(fitMosaic(points, { maxZoom: m.zoom + 1 }).zoom).toBe(m.zoom);
    // Places far apart zoom out; one alone is as close as allowed.
    expect(fitMosaic([RITZ, { lat: 50.8225, lon: -0.1372 }]).zoom).toBeLessThan(m.zoom);
    expect(fitMosaic([RITZ], { maxZoom: 16 }).zoom).toBe(16);
    const urls = tileUrls(m);
    expect(urls).toHaveLength(6);
    expect(urls[0]).toBe(`https://tile.openstreetmap.org/${m.zoom}/${m.x}/${m.y}.png`);
    expect(urls[5]).toBe(`https://tile.openstreetmap.org/${m.zoom}/${m.x + 2}/${m.y + 1}.png`);
  });

  it('stays on the world at its edges', () => {
    const m = fitMosaic([{ lat: 84, lon: 179.9 }], { maxZoom: 3 });
    expect(m.x + m.cols).toBeLessThanOrEqual(2 ** m.zoom);
    expect(m.y).toBeGreaterThanOrEqual(0);
  });

  it('measures as the crow flies', () => {
    // The Ritz to Brighton Pier is about 75 km.
    expect(haversine(RITZ, { lat: 50.8167, lon: -0.1367 }) / 1000).toBeCloseTo(76.8, 0);
  });
});

describe('asking OpenStreetMap', () => {
  it('turns words into bounded Overpass filters', () => {
    expect(filtersFor('coffee')).toEqual(['[amenity="cafe"]']);
    expect(filtersFor('a good Coffee shop')).toEqual(['[amenity="cafe"]']);
    expect(filtersFor('bars')).toEqual(['[amenity~"^(bar|pub|biergarten)$"]']);
    expect(filtersFor('sushi')[0]).toBe('[amenity~"^(restaurant|fast_food)$"][cuisine~"sushi",i]');
    expect(filtersFor('vegan')[0]).toContain('["diet:vegan"~"^(yes|only)$"]');
    // A name is a name, with its quotes and pattern characters made harmless.
    const named = filtersFor('Joe "x"] (out);');
    // Overpass reads `\\` as one backslash, so the pattern gets `\]` and `\(`: literal characters.
    expect(named[0]).toBe('[name~"Joe \\"x\\"\\\\] \\\\(out\\\\);",i][amenity]');
    const q = overpassQuery(['[amenity="cafe"]'], RITZ, 800);
    expect(q).toContain('[out:json][timeout:15]');
    expect(q).toContain('nwr(around:800,51.507150,-0.141680)[amenity="cafe"][name];');
    expect(q).toContain('out center tags 60;');
    expect(q).toContain('area.a[timezone];');
  });

  it('reads a place from Overpass as the card shows it', () => {
    const item = placeFromElement(
      OVERPASS_CAFES.elements[0],
      RITZ,
      'Europe/London',
      new Date('2026-10-07T10:00:00+01:00'),
    );
    expect(item).toMatchObject({
      name: 'Caffè Concerto',
      category: 'cafe',
      address: '12 Piccadilly',
      openNow: { open: true, at: '18:00' },
      website: 'https://example.cafe/',
      phone: '+44 20 0000 0000',
      cuisine: 'coffee shop, italian',
      wheelchair: 'limited',
      url: 'https://www.openstreetmap.org/node/1',
    });
    expect(item?.distance).toBeGreaterThan(100);
    expect(item?.directions.google).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
    expect(item?.directions.apple).toMatch(/^https:\/\/maps\.apple\.com\/\?daddr=/);
    expect(item?.directions.osm).toMatch(/^https:\/\/www\.openstreetmap\.org\/directions\?to=/);
    expect(
      placeFromElement(OVERPASS_CAFES.elements[2], RITZ, undefined, new Date()),
    ).toBeUndefined();
  });

  it('only ever links securely', () => {
    expect(secureLink('http://www.theritzlondon.com/')).toBe('https://www.theritzlondon.com/');
    expect(secureLink('example.org/menu')).toBe('https://example.org/menu');
    expect(secureLink('javascript:alert(1)')).toBeUndefined();
    expect(secureLink('https://me:pw@example.org')).toBeUndefined();
    expect(pointIn('51.5, -0.14')).toEqual({ lat: 51.5, lon: -0.14 });
    expect(pointIn('The Ritz')).toBeUndefined();
  });

  it('finds what’s near a place: list, hours, map and the model’s text', async () => {
    const { fetcher, calls } = fakeOsm();
    const { places: p } = await places(fetcher);
    const { text, view } = await p.find(
      'c1',
      { what: 'coffee', near: 'The Ritz, London', radius: 800, limit: 8 },
      signal,
    );
    const nominatim = calls.find((c) => c.url.includes('nominatim'));
    expect(new URL(nominatim?.url ?? '').searchParams.get('format')).toBe('jsonv2');
    expect(nominatim?.headers['user-agent']).toBe(PLACES_USER_AGENT);
    const overpass = calls.find((c) => c.url.includes('overpass'));
    expect(overpass?.method).toBe('POST');
    expect(decodeURIComponent(overpass?.body ?? '')).toContain('around:800');
    const tiles = calls.filter((c) => c.url.includes('tile.openstreetmap.org'));
    expect(tiles).toHaveLength(6);
    expect(tiles.every((t) => t.headers['user-agent'] === PLACES_USER_AGENT)).toBe(true);

    expect(view).toMatchObject({
      kind: 'places',
      mode: 'nearby',
      query: 'coffee',
      origin: { name: 'The Ritz' },
      attribution: '© OpenStreetMap contributors',
      map: { cols: 3, rows: 2 },
    });
    expect(view.items.map((i) => i.name)).toEqual(['Green Park Kiosk', 'Caffè Concerto']);
    expect(view.items[0]?.website).toBeUndefined();
    expect(view.map?.tiles.every((t) => t?.kind === 'image')).toBe(true);
    // What's logged is what was made: the view survives the gateway's own check.
    expect(cleanView(view)).toEqual(view);
    const read = JSON.parse(text) as { places: { name: string; open_now?: boolean }[] };
    expect(read.places[1]).toMatchObject({ name: 'Caffè Concerto', open_now: true });
    expect(text).toContain('map card');
  });

  it('remembers what it was told, and asks Nominatim no more than once a second', async () => {
    const { fetcher, calls } = fakeOsm();
    const { places: p } = await places(fetcher);
    await p.find('c1', { what: 'coffee', near: 'The Ritz, London', radius: 800, limit: 8 }, signal);
    await p.find('c2', { what: 'coffee', near: 'the ritz, london', radius: 800, limit: 8 }, signal);
    expect(calls.filter((c) => c.url.includes('nominatim'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('overpass'))).toHaveLength(1);
    // Tiles too: the second chat keeps its own copies, without asking the tile server again.
    expect(calls.filter((c) => c.url.includes('tile.'))).toHaveLength(6);
  });

  it('says where one place is, and how far from another', async () => {
    const brighton = [
      {
        lat: '50.8214626',
        lon: '-0.1400561',
        name: 'Brighton',
        display_name: 'Brighton, Brighton and Hove, England, United Kingdom',
        category: 'place',
        type: 'city',
        osm_type: 'relation',
        osm_id: 114085,
        address: { country_code: 'gb' },
      },
    ];
    const { fetcher } = fakeOsm({ nominatim: brighton });
    const { places: p } = await places(fetcher);
    const { view } = await p.find(
      'c1',
      { near: 'Brighton', from: '51.5072, -0.1276', radius: 1000, limit: 8 },
      signal,
    );
    expect(view.mode).toBe('place');
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      name: 'Brighton',
      category: 'city',
      url: 'https://www.openstreetmap.org/relation/114085',
    });
    expect((view.items[0]?.distance ?? 0) / 1000).toBeCloseTo(75, -1);
    expect(view.items[0]?.directions.google).toContain('origin=');
    expect(view.origin).toMatchObject({ lat: 51.5072, lon: -0.1276 });
    expect(cleanView(view)).toEqual(view);
  });

  it('fails in words a model can act on', async () => {
    const nothing = await places(fakeOsm({ nominatim: [] }).fetcher);
    await expect(
      nothing.places.find(
        'c1',
        { what: 'coffee', near: 'Nowhere-at-all', radius: 800, limit: 8 },
        signal,
      ),
    ).rejects.toThrow(/doesn’t know a place called “Nowhere-at-all”/);
    const busy = await places(fakeOsm({ overpass: 429 }).fetcher);
    await expect(
      busy.places.find(
        'c1',
        { what: 'coffee', near: '51.5, -0.14', radius: 800, limit: 8 },
        signal,
      ),
    ).rejects.toThrow(/busy/);
  });

  it('still answers without a map when the tiles can’t be fetched', async () => {
    const { places: p } = await places(fakeOsm({ tile: 'refuse' }).fetcher);
    const { view } = await p.find(
      'c1',
      { what: 'coffee', near: '51.5, -0.14', radius: 800, limit: 8 },
      signal,
    );
    expect(view.map?.tiles).toEqual([null, null, null, null, null, null]);
    expect(view.items.length).toBeGreaterThan(0);
    expect(cleanView(view)).toEqual(view);
  });
});

describe('being a good neighbour', () => {
  it('spaces requests out, one after another', async () => {
    let clock = 0;
    const slept: number[] = [];
    const spacing = new Spacing(
      1000,
      () => clock,
      async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    );
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => spacing.run(async () => order.push(n))));
    expect(order).toEqual([1, 2, 3]);
    expect(slept).toEqual([1000, 1000]);
    // A request whose wait is called off gives up its turn without blocking the next.
    const stop = new AbortController();
    stop.abort();
    await expect(spacing.run(async () => 'no', stop.signal)).rejects.toThrow();
    await expect(spacing.run(async () => 'yes')).resolves.toBe('yes');
  });

  it('forgets after a while, and keeps only so many', () => {
    let clock = 0;
    const recent = new Recent<number>(2, 100, () => clock);
    recent.set('a', 1);
    recent.set('b', 2);
    recent.set('c', 3);
    expect(recent.get('a')).toBeUndefined();
    expect(recent.get('c')).toBe(3);
    clock = 101;
    expect(recent.get('c')).toBeUndefined();
  });

  it('marks the chat as having read the web, and asks before a long search goes out', () => {
    expect(taintFrom('mcp__conch__places', { near: 'x' })).toEqual({
      kind: 'web',
      label: 'OpenStreetMap places',
    });
    const ctx = { workspace: '/w' };
    expect(sinkReason('places', { what: 'coffee', near: 'The Ritz' }, ctx)).toBeUndefined();
    expect(sinkReason('places', { what: 'x'.repeat(100), near: 'y'.repeat(100) }, ctx)).toMatch(
      /long place search/,
    );
  });
});
