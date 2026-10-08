import {
  Accessibility,
  ArrowUpRight,
  ChevronDown,
  Clock,
  Globe,
  Maximize2,
  Minus,
  Navigation,
  Phone,
  Plus,
  UtensilsCrossed,
  MapPin,
} from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { useNacreTheme } from '../../theme';
import { cx } from '../../utils/cx';
import {
  centreOn,
  clampView,
  distanceWords,
  gridAround,
  onGrid,
  openWords,
  zoomAt,
  type Grid,
  type PlaceOpenState,
  type View,
} from './geo';
import { glyphFor } from './glyphs';
import styles from './Places.module.css';

export type { PlaceOpenState } from './geo';

export interface PlaceDirections {
  apple: string;
  google: string;
  osm: string;
}

export interface Place {
  name: string;
  /** What kind of place: "cafe", "museum". */
  category: string;
  lat: number;
  lon: number;
  address?: string;
  /** From where it was searched near (or measured from), in metres. */
  distance?: number;
  /** Its hours as written: "Mo-Fr 08:00-18:00". */
  hours?: string;
  openNow?: PlaceOpenState;
  website?: string;
  phone?: string;
  cuisine?: string;
  wheelchair?: 'yes' | 'limited' | 'no';
  /** Out of 5, when a source has one. */
  rating?: number;
  /** The place on the map's own site. */
  url: string;
  directions: PlaceDirections;
}

export interface PlacesMosaic extends Grid {
  /** Each tile's picture, row by row from the top left (same-origin addresses); `null` for a missing one. */
  tiles: readonly (string | null | undefined)[];
}

export interface PlacesProps extends Omit<ComponentProps<'section'>, 'onSelect'> {
  places: Place[];
  /** `nearby`: places around one; `place`: where one place is. */
  mode?: 'nearby' | 'place';
  /** What was looked for: "coffee". */
  query?: string;
  /** Where it was near, or measured from: a small ring on the map. */
  origin?: { name: string; lat: number; lon: number };
  center: { lat: number; lon: number };
  zoom: number;
  map?: PlacesMosaic;
  /** The map's credit, always in sight: "© OpenStreetMap contributors". */
  attribution: string;
  /** Which place is open in the details (controlled). */
  selected?: number | null;
  defaultSelected?: number | null;
  onSelectedChange?: (index: number | null) => void;
  /** Draw it at rest: no pins dropping in (a chat read back later). */
  still?: boolean;
}

/** Only secure web links leave the card. */
const secure = (url: string | undefined) => (url && /^https:\/\//i.test(url) ? url : undefined);
const outside = { target: '_blank', rel: 'noopener noreferrer' } as const;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const WHEELCHAIR: Record<NonNullable<Place['wheelchair']>, string> = {
  yes: 'Wheelchair accessible',
  limited: 'Partly wheelchair accessible',
  no: 'Not wheelchair accessible',
};

/** "Open now · closes 18:00", with the state in words and a mark beside it. */
export function OpenLine({ state, className }: { state: PlaceOpenState; className?: string }) {
  const words = openWords(state);
  return (
    <span className={cx(styles.open, className)} data-open={state.open ? '' : undefined}>
      <span className={styles.openDot} aria-hidden />
      <span className={styles.openState}>{words.state}</span>
      {words.next && <span className={styles.openNext}>· {words.next}</span>}
    </span>
  );
}

/** How many rows a long list shows before "Show all". */
const FOLD = 5;

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── The map ─────────────────────────────────────────────────────────────────

export interface PlacesMapProps extends Omit<ComponentProps<'div'>, 'onSelect'> {
  places: Place[];
  origin?: PlacesProps['origin'];
  grid: Grid;
  tiles?: readonly (string | null | undefined)[];
  attribution: string;
  /** What the map shows, for screen readers: "Map of 8 cafés near The Ritz". */
  label: string;
  selected: number | null;
  /** The place whose row or pin is under the pointer or focus. */
  lit: number | null;
  onSelect: (index: number) => void;
  onLight: (index: number | null) => void;
  /** Ask the map to move to a place: changes each time. */
  focus?: { index: number; seq: number; zoom?: boolean };
  still?: boolean;
  /** One place alone, shown large: its pin without a number. */
  hero?: boolean;
}

/**
 * Tiles laid out as one picture, with numbered pins put where Web Mercator
 * says. It moves with CSS transforms only — drag, pinch, ctrl-scroll, the
 * buttons or the keys — and never asks for a tile it doesn't have.
 */
export function PlacesMap({
  places,
  origin,
  grid,
  tiles,
  attribution,
  label,
  selected,
  lit,
  onSelect,
  onLight,
  focus,
  still = false,
  hero = false,
  className,
  style,
  ...props
}: PlacesMapProps) {
  const { resolvedMode } = useNacreTheme();
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const hint = useId();
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    view: View;
    x: number;
    y: number;
    distance?: number;
    moved: boolean;
  } | null>(null);
  const spots = useMemo(() => places.map((p) => onGrid(grid, p.lat, p.lon)), [places, grid]);
  const home = origin ? onGrid(grid, origin.lat, origin.lon) : undefined;

  // Pressing a row brings its place into the middle, a little closer if the map shows it all.
  const [moved, setMoved] = useState(focus?.seq);
  if (focus && focus.seq !== moved) {
    setMoved(focus.seq);
    const spot = spots[focus.index];
    if (spot) setView(centreOn(spot, focus.zoom ? Math.max(view.s, 1.6) : view.s));
  }

  // Pinching a trackpad (ctrl + wheel) zooms; a plain wheel scrolls the chat as ever.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY / 220);
      setView((v) =>
        zoomAt(v, factor, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height),
      );
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const fraction = (x: number, y: number) => {
    const r = frame.current?.getBoundingClientRect();
    return r && r.width && r.height
      ? { x: (x - r.left) / r.width, y: (y - r.top) / r.height, w: r.width, h: r.height }
      : { x: 0.5, y: 0.5, w: 1, h: 1 };
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    gesture.current = {
      view,
      x: e.clientX,
      y: e.clientY,
      ...(a && b && { distance: Math.hypot(a.x - b.x, a.y - b.y) }),
      moved: false,
    };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.current.values()];
    const f = fraction(e.clientX, e.clientY);
    if (a && b && g.distance) {
      const mid = fraction((a.x + b.x) / 2, (a.y + b.y) / 2);
      g.moved = true;
      setDragging(true);
      setView(zoomAt(g.view, Math.hypot(a.x - b.x, a.y - b.y) / g.distance, mid.x, mid.y));
      return;
    }
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    setDragging(true);
    setView(clampView({ s: g.view.s, tx: g.view.tx + dx / f.w, ty: g.view.ty + dy / f.h }));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    } else {
      // One finger left of a pinch: carry on dragging from here.
      const [rest] = [...pointers.current.values()];
      if (rest) gesture.current = { view, x: rest.x, y: rest.y, moved: true };
    }
  };

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = 0.12;
    const moves: Record<string, () => View> = {
      ArrowLeft: () => clampView({ ...view, tx: view.tx + step }),
      ArrowRight: () => clampView({ ...view, tx: view.tx - step }),
      ArrowUp: () => clampView({ ...view, ty: view.ty + step }),
      ArrowDown: () => clampView({ ...view, ty: view.ty - step }),
      '+': () => zoomAt(view, 1.4),
      '=': () => zoomAt(view, 1.4),
      '-': () => zoomAt(view, 1 / 1.4),
      _: () => zoomAt(view, 1 / 1.4),
      '0': () => ({ s: 1, tx: 0, ty: 0 }),
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    setView(next());
  };

  const zoomed = view.s > 1.001;
  const worldStyle = {
    '--pm-s': view.s,
    transform: `translate(${view.tx * 100}%, ${view.ty * 100}%) scale(${view.s})`,
  } as CSSProperties;
  const cells = grid.cols * grid.rows;

  return (
    <div
      {...props}
      className={cx(styles.map, className)}
      data-scheme={resolvedMode}
      data-dragging={dragging ? '' : undefined}
      data-still={still ? '' : undefined}
      style={{ '--pm-ratio': `${grid.cols} / ${grid.rows}`, ...style } as CSSProperties}
    >
      {/* The map is moved by its keys as by a pointer (WCAG 2.1.1): it takes focus and listens. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={frame}
        className={styles.frame}
        role="region"
        aria-roledescription="map"
        aria-label={label}
        aria-describedby={hint}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onKeyDown={keys}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-zoomed={zoomed ? '' : undefined}
      >
        <div className={styles.world} style={worldStyle}>
          <div
            className={styles.tiles}
            style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` } as CSSProperties}
            aria-hidden
          >
            {Array.from({ length: cells }, (_, i) => {
              const src = tiles?.[i];
              return src ? (
                <img key={i} className={styles.tile} src={src} alt="" draggable={false} />
              ) : (
                <span key={i} className={cx(styles.tile, styles.blank)} />
              );
            })}
          </div>
          {home && (
            <span
              className={styles.home}
              style={{ left: `${home.x * 100}%`, top: `${home.y * 100}%` } as CSSProperties}
              aria-hidden
            >
              <span className={styles.homeRing} />
              {!hero && origin && <span className={styles.homeName}>{origin.name}</span>}
            </span>
          )}
          <div className={styles.pins} aria-hidden>
            {places.map((place, i) => {
              const spot = spots[i];
              if (!spot) return null;
              const on = selected === i;
              // Where the pin sits in the frame now, so its callout opens toward the middle.
              const fx = view.tx + spot.x * view.s,
                fy = view.ty + spot.y * view.s;
              return (
                <span
                  key={`${place.name}-${i}`}
                  className={styles.spot}
                  style={
                    {
                      left: `${spot.x * 100}%`,
                      top: `${spot.y * 100}%`,
                      '--pm-i': i,
                      zIndex: on ? 3 : lit === i ? 2 : 1,
                    } as CSSProperties
                  }
                  data-selected={on ? '' : undefined}
                  data-lit={lit === i ? '' : undefined}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={styles.pin}
                    onClick={() => onSelect(i)}
                    onPointerEnter={() => onLight(i)}
                    onPointerLeave={() => onLight(null)}
                  >
                    <span className={styles.pinDrop}>
                      <span className={styles.pinHead}>
                        <span className={styles.pinNum}>
                          {hero ? <MapPin className={styles.pinGlyph} /> : i + 1}
                        </span>
                      </span>
                    </span>
                  </button>
                  {on && !hero && (
                    <span
                      className={styles.callout}
                      data-below={fy < 0.38 ? '' : undefined}
                      data-edge={fx < 0.22 ? 'start' : fx > 0.78 ? 'end' : undefined}
                    >
                      <span className={styles.calloutName}>{place.name}</span>
                      {place.openNow ? (
                        <OpenLine state={place.openNow} className={styles.calloutOpen} />
                      ) : (
                        <span className={styles.calloutMeta}>{sentence(place.category)}</span>
                      )}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <span id={hint} className="nc-visually-hidden">
        Drag, or use the arrow keys, to move the map. Plus and minus zoom; 0 shows it all.
      </span>
      <div className={styles.controls}>
        <IconButton
          size="sm"
          variant="surface"
          label="Zoom in"
          tooltip={false}
          disabled={view.s >= 3.99}
          onClick={() => setView((v) => zoomAt(v, 1.5))}
        >
          <Plus />
        </IconButton>
        <IconButton
          size="sm"
          variant="surface"
          label="Zoom out"
          tooltip={false}
          disabled={!zoomed}
          onClick={() => setView((v) => zoomAt(v, 1 / 1.5))}
        >
          <Minus />
        </IconButton>
        {zoomed && (
          <IconButton
            size="sm"
            variant="surface"
            label="Show the whole map"
            tooltip={false}
            onClick={() => setView({ s: 1, tx: 0, ty: 0 })}
          >
            <Maximize2 />
          </IconButton>
        )}
      </div>
      <a className={styles.credit} href="https://www.openstreetmap.org/copyright" {...outside}>
        {attribution}
      </a>
    </div>
  );
}

// ── A place, opened ─────────────────────────────────────────────────────────

function Directions({ place }: { place: Place }) {
  const links = [
    { label: 'Apple Maps', href: secure(place.directions.apple) },
    { label: 'Google Maps', href: secure(place.directions.google) },
    { label: 'OpenStreetMap', href: secure(place.directions.osm) },
  ].filter((l): l is { label: string; href: string } => Boolean(l.href));
  if (!links.length) return null;
  return (
    <div className={styles.directions} role="group" aria-label={`Directions to ${place.name}`}>
      <span className={styles.directionsLabel}>
        <Navigation aria-hidden />
        Directions
      </span>
      {links.map((l) => (
        <Button key={l.label} asChild size="sm" variant="surface" tone="neutral">
          <a href={l.href} {...outside} aria-label={`Directions in ${l.label}`}>
            {l.label}
          </a>
        </Button>
      ))}
    </div>
  );
}

/** What there is to know about one place: where, when, how to reach it and how to get there. */
export function PlaceDetails({
  place,
  from,
  open = true,
  className,
  ...props
}: {
  place: Place;
  /** Where its distance is measured from, said beside it. */
  from?: string;
  /** Say whether it's open now (a list's row already does). */
  open?: boolean;
} & ComponentProps<'div'>) {
  const website = secure(place.website);
  const url = secure(place.url);
  return (
    <div className={cx(styles.details, className)} {...props}>
      <dl className={styles.facts}>
        {place.address && (
          <div className={styles.fact}>
            <dt>
              <MapPin aria-hidden />
              <span className="nc-visually-hidden">Address</span>
            </dt>
            <dd>{place.address}</dd>
          </div>
        )}
        {from && place.distance !== undefined && (
          <div className={styles.fact}>
            <dt>
              <Navigation aria-hidden />
              <span className="nc-visually-hidden">Distance</span>
            </dt>
            <dd>
              {distanceWords(place.distance)} from {from}, as the crow flies
            </dd>
          </div>
        )}
        {((open && place.openNow) || place.hours) && (
          <div className={styles.fact}>
            <dt>
              <Clock aria-hidden />
              <span className="nc-visually-hidden">Hours</span>
            </dt>
            <dd>
              {open && place.openNow && <OpenLine state={place.openNow} />}
              {place.hours && <span className={styles.hours}>{place.hours}</span>}
            </dd>
          </div>
        )}
        {place.cuisine && (
          <div className={styles.fact}>
            <dt>
              <UtensilsCrossed aria-hidden />
              <span className="nc-visually-hidden">Food</span>
            </dt>
            <dd>{sentence(place.cuisine)}</dd>
          </div>
        )}
        {place.phone && (
          <div className={styles.fact}>
            <dt>
              <Phone aria-hidden />
              <span className="nc-visually-hidden">Phone</span>
            </dt>
            <dd className={styles.selectable}>{place.phone}</dd>
          </div>
        )}
        {website && (
          <div className={styles.fact}>
            <dt>
              <Globe aria-hidden />
              <span className="nc-visually-hidden">Website</span>
            </dt>
            <dd>
              <a className={styles.link} href={website} {...outside}>
                {hostOf(website)}
                <ArrowUpRight aria-hidden />
              </a>
            </dd>
          </div>
        )}
        {place.wheelchair && (
          <div className={styles.fact}>
            <dt>
              <Accessibility aria-hidden />
              <span className="nc-visually-hidden">Access</span>
            </dt>
            <dd>{WHEELCHAIR[place.wheelchair]}</dd>
          </div>
        )}
      </dl>
      <Directions place={place} />
      {url && (
        <a className={styles.onMap} href={url} {...outside}>
          See it on OpenStreetMap
          <ArrowUpRight aria-hidden />
        </a>
      )}
    </div>
  );
}

// ── The card ────────────────────────────────────────────────────────────────

function Row({ place, index, distance }: { place: Place; index: number; distance: boolean }) {
  return (
    <>
      <span className={styles.number} aria-hidden>
        {index + 1}
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowTop}>
          <span className={styles.rowName}>{place.name}</span>
          {distance && place.distance !== undefined && (
            <span className={styles.rowDistance}>{distanceWords(place.distance)}</span>
          )}
        </span>
        <span className={styles.rowMeta}>
          <span className={styles.rowKind}>
            <span className={styles.rowKindGlyph} aria-hidden>
              {glyphFor(place.category)}
            </span>
            {sentence(place.category)}
          </span>
          {place.rating !== undefined && (
            <span className={styles.rating}>
              {place.rating.toFixed(1)}
              <span aria-hidden> ★</span>
              <span className="nc-visually-hidden"> out of 5</span>
            </span>
          )}
          {place.openNow && <OpenLine state={place.openNow} className={styles.rowOpen} />}
        </span>
      </span>
    </>
  );
}

/**
 * What a place search found, as a map and a list (ADR 0060): numbered pins
 * that drop in, a list beside or under them, each row and its pin lit
 * together, and the chosen place opened with its hours and directions. One
 * place alone is a large map with its address card. Everything in it came
 * from outside and is drawn as plain text; links are https only, in a tab of
 * their own.
 */
export function Places({
  places,
  mode = 'nearby',
  query,
  origin,
  center,
  zoom,
  map,
  attribution,
  selected: selectedProp,
  defaultSelected = null,
  onSelectedChange,
  still = false,
  className,
  ...props
}: PlacesProps) {
  const [own, setOwn] = useState<number | null>(defaultSelected);
  const selected = selectedProp !== undefined ? selectedProp : own;
  const [lit, setLit] = useState<number | null>(null);
  const [focus, setFocus] = useState<PlacesMapProps['focus']>();
  const seq = useRef(0);
  const select = useCallback(
    (index: number | null, from: 'list' | 'pin') => {
      setOwn(index);
      onSelectedChange?.(index);
      if (index !== null) setFocus({ index, seq: ++seq.current, zoom: from === 'list' });
    },
    [onSelectedChange],
  );
  const grid = useMemo<Grid>(
    () => map ?? gridAround([center, ...places, ...(origin ? [origin] : [])], Math.min(zoom, 17)),
    [map, center, places, origin, zoom],
  );

  const one = mode === 'place' || places.length === 1;
  // A long list shows its first few; choosing a pin further down shows them all.
  const [all, setAll] = useState(false);
  const folded = !all && places.length > FOLD + 1 && (selected === null || selected < FOLD);
  const shown = folded ? places.slice(0, FOLD) : places;
  const place = one ? places[0] : undefined;
  const near = origin?.name;
  const heading = one
    ? place?.name
    : `${query ? sentence(query) : 'Places'}${near ? ` near ${near}` : ''}`;
  const label = one
    ? `Map of ${place?.name ?? 'the place'}`
    : `Map of ${places.length} ${places.length === 1 ? 'place' : 'places'}${near ? ` near ${near}` : ''}`;

  if (!places.length)
    return (
      <section aria-label={heading} className={cx(styles.root, className)} {...props}>
        <p className={styles.empty}>
          Nothing like that{near ? ` near ${near}` : ''} on the map. A wider search, or other words,
          may find it.
        </p>
        <span className={styles.footCredit}>{attribution}</span>
      </section>
    );

  return (
    <section
      aria-label={heading}
      className={cx(styles.root, className)}
      data-mode={one ? 'place' : 'nearby'}
      {...props}
    >
      <div className={styles.body}>
        <PlacesMap
          className={styles.mapArea}
          places={places}
          origin={origin}
          grid={grid}
          tiles={map?.tiles}
          attribution={attribution}
          label={label}
          selected={one ? 0 : selected}
          lit={lit}
          onSelect={(i) => !one && select(selected === i ? null : i, 'pin')}
          onLight={setLit}
          focus={focus}
          still={still}
          hero={one}
        />
        {one && place ? (
          <div className={styles.hero}>
            <div className={styles.heroHead}>
              <span className={styles.rowGlyph} aria-hidden>
                {glyphFor(place.category)}
              </span>
              <span className={styles.rowText}>
                <span className={styles.heroName}>{place.name}</span>
                <span className={styles.rowMeta}>{sentence(place.category)}</span>
              </span>
            </div>
            <PlaceDetails place={place} {...(near && { from: near })} />
          </div>
        ) : (
          <div className={styles.side}>
            <div className={styles.head}>
              <span className={styles.title}>{heading}</span>
              <span className={styles.count}>
                {places.length} {places.length === 1 ? 'place' : 'places'}
              </span>
            </div>
            <ToggleGroup.Root
              type="single"
              orientation="vertical"
              loop={false}
              className={styles.list}
              aria-label={`${heading}: ${places.length} places`}
              value={selected === null ? '' : String(selected)}
              onValueChange={(v) => select(v === '' ? null : Number(v), 'list')}
            >
              {shown.map((p, i) => (
                <div
                  key={`${p.name}-${i}`}
                  className={styles.item}
                  data-selected={selected === i ? '' : undefined}
                >
                  <ToggleGroup.Item
                    value={String(i)}
                    className={styles.row}
                    data-lit={lit === i ? '' : undefined}
                    onPointerEnter={() => setLit(i)}
                    onPointerLeave={() => setLit(null)}
                    onFocus={() => setLit(i)}
                    onBlur={() => setLit(null)}
                    data-lustre=""
                  >
                    <Row place={p} index={i} distance={Boolean(near)} />
                  </ToggleGroup.Item>
                  {selected === i && (
                    <PlaceDetails place={p} open={false} className={styles.opened} />
                  )}
                </div>
              ))}
            </ToggleGroup.Root>
            {folded && (
              <div className={styles.more}>
                <Button variant="ghost" size="sm" tone="neutral" onClick={() => setAll(true)}>
                  Show all {places.length} places
                  <ChevronDown aria-hidden />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
