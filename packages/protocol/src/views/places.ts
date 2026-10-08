/**
 * Places (ADR 0060 §7): what `places` found — coffee near the Ritz, where
 * the Louvre is, how far one place is from another — drawn as a map and a
 * list instead of text.
 *
 * Everything here came from OpenStreetMap, so it's plain text from outside.
 * The map is a small mosaic of OpenStreetMap tiles the gateway fetched and
 * kept as the chat's own pictures (the page never loads a remote image),
 * laid out as a grid whose first tile is `x`/`y` at `zoom`: the page puts
 * every pin where it belongs with Web Mercator maths, no map library.
 */
import { z } from 'zod';

import { Attachment } from '../attachments';

/** Only secure web links leave a place card. */
const Https = z
  .string()
  .max(2000)
  .regex(/^https:\/\//i, 'Only secure web links.');
const Lat = z.number().min(-90).max(90);
const Lon = z.number().min(-180).max(180);
/** A time of day on the place's own clock: "18:00". */
const Clock = z.string().regex(/^\d{2}:\d{2}$/);

/** The most places one card shows. */
export const PLACES_MAX = 12;
/** The most map tiles one card carries. */
export const PLACES_TILES_MAX = 9;
/** The size of one map tile, in its own pixels. */
export const PLACES_TILE_SIZE = 256;
/** OpenStreetMap's licence asks for exactly this, always in sight. */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export const PlaceDirections = z.object({
  apple: Https,
  google: Https,
  osm: Https,
});
export type PlaceDirections = z.infer<typeof PlaceDirections>;

/** Whether a place's hours say it's open right now, on its own clock. */
export const PlaceOpen = z.object({
  open: z.boolean(),
  /** When that changes, if it does: closes at, or opens at. */
  at: Clock.optional(),
  /** The day it changes on, when that isn't today: "Mon". */
  day: z.string().max(12).optional(),
  /** Open all day, every day (`24/7`). */
  always: z.boolean().optional(),
});
export type PlaceOpen = z.infer<typeof PlaceOpen>;

export const PlaceItem = z.object({
  name: z.string().min(1).max(200),
  /** What kind of place, in a word or two: "cafe", "museum", "pharmacy". */
  category: z.string().min(1).max(60),
  lat: Lat,
  lon: Lon,
  address: z.string().max(300).optional(),
  /** From the place searched near (or `from`), in metres, as the crow flies. */
  distance: z.number().nonnegative().max(40_100_000).optional(),
  /** Its opening hours as OpenStreetMap writes them: "Mo-Fr 08:00-18:00; Sa 09:00-14:00". */
  hours: z.string().max(400).optional(),
  /** Read from `hours` by the gateway; missing when they can't be read. */
  openNow: PlaceOpen.optional(),
  website: Https.optional(),
  phone: z.string().max(60).optional(),
  cuisine: z.string().max(120).optional(),
  wheelchair: z.enum(['yes', 'limited', 'no']).optional(),
  /** Out of 5, when a source has one (OpenStreetMap doesn't). */
  rating: z.number().min(0).max(5).optional(),
  /** The place on openstreetmap.org. */
  url: Https,
  directions: PlaceDirections,
});
export type PlaceItem = z.infer<typeof PlaceItem>;

export const PlacesTiles = z
  .object({
    zoom: z.number().int().min(0).max(19),
    /** The top-left tile. */
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    cols: z.number().int().min(1).max(3),
    rows: z.number().int().min(1).max(3),
    /** Row by row from the top left; a tile that couldn't be fetched is `null`. */
    tiles: z.array(Attachment.nullable()).max(PLACES_TILES_MAX),
  })
  .refine((m) => m.tiles.length === m.cols * m.rows, 'One tile for every cell of the grid.');
export type PlacesTiles = z.infer<typeof PlacesTiles>;

export const PlacesView = z.object({
  kind: z.literal('places'),
  /** `nearby`: a list of places around one; `place`: where one place is. */
  mode: z.enum(['nearby', 'place']).default('nearby'),
  /** What was looked for, as asked: "coffee". */
  query: z.string().max(200).optional(),
  /** The place it was near (or measured from), as a small ring on the map. */
  origin: z.object({ name: z.string().max(200), lat: Lat, lon: Lon }).optional(),
  center: z.object({ lat: Lat, lon: Lon }),
  zoom: z.number().int().min(0).max(19),
  map: PlacesTiles.optional(),
  attribution: z.literal(OSM_ATTRIBUTION),
  items: z.array(PlaceItem).max(PLACES_MAX),
});
export type PlacesView = z.infer<typeof PlacesView>;
