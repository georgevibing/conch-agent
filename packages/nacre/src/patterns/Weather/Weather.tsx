import { TriangleAlert } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { SegmentedControl } from '../../components/SegmentedControl';
import { cx } from '../../utils/cx';
import { ShowAll, useShowAll } from '../ToolViews/shared';
import { HourStrip } from './HourStrip';
import {
  airReading,
  compass,
  conditionOf,
  conditionWords,
  intensityOf,
  minutesOf,
  skyTimeOf,
  tempHue,
  timeLabel,
  toCelsius,
  uvWords,
  weekday,
  type Condition,
} from './sky';
import type { WeatherData, WeatherDay } from './types';
import { inUnits, type WeatherUnits } from './units';
import { ConditionGlyph, WeatherArt } from './WeatherArt';
import styles from './Weather.module.css';

export interface WeatherCardProps extends Omit<ComponentProps<'section'>, 'children'> {
  weather: WeatherData;
  /** How the reader writes times and numbers; the browser's own by default. */
  locale?: string;
  /** Days shown before **Show all**. */
  days?: number;
  /**
   * The units it's shown in, when the app holds the person's choice: °C with
   * km/h and mm, or °F with mph and inches. Left out, the forecast's own, and
   * the card's switch changes them for this card.
   */
  units?: WeatherUnits;
  /** The person chose the other units on the card's switch. */
  onUnitsChange?: (units: WeatherUnits) => void;
  /**
   * The card's share bar (Nacre `CardShare`), in the footer beside the units:
   * save the forecast as a picture, copy it, or send it to a chat app. Left
   * out, the footer is as it was.
   */
  share?: ReactNode;
}

/** The sky's mood, for its colours: bright, between, grey, milky, snowy or stormy. */
function toneOf(condition: Condition) {
  switch (condition) {
    case 'clear':
    case 'partly':
      return 'clear';
    case 'cloudy':
      return 'cloudy';
    case 'fog':
      return 'fog';
    case 'snow':
      return 'snow';
    case 'storm':
      return 'storm';
    default:
      return 'grey';
  }
}

const wetWord = (code: number) => (conditionOf(code) === 'snow' ? 'snow' : 'rain');

/**
 * The weather, as a card in the chat (ADR 0060 §7). A sky that matches the
 * hour and the condition, with its own drawn art; the temperature large; the
 * next day as a line you can scrub; the days ahead on one shared scale; wind,
 * rain, UV, the air and the sun at a glance. Every reading has its words, so
 * nothing is told by colour alone, and the whole card is one sentence for a
 * screen reader.
 */
export function WeatherCard({
  weather: given,
  locale,
  days = 7,
  units: unitsProp,
  onUnitsChange,
  share,
  className,
  ...props
}: WeatherCardProps) {
  const [ownUnits, setOwnUnits] = useState<WeatherUnits>(given.units);
  const units = unitsProp ?? ownUnits;
  const weather = useMemo(() => inUnits(given, units), [given, units]);
  const chooseUnits = (next: WeatherUnits) => {
    if (unitsProp === undefined) setOwnUnits(next);
    onUnitsChange?.(next);
  };
  const { current, hourly, daily, place } = weather;
  const imperial = weather.units === 'imperial';
  const unit = imperial ? 'F' : 'C';
  const speed = imperial ? 'mph' : 'km/h';
  const depth = imperial ? 'in' : 'mm';
  const clock = { locale };
  const n0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const deg = (t: number) => `${n0.format(Math.round(t))}°`;

  const [index, setIndex] = useState(0);
  const [returning, setReturning] = useState(false);
  // History is drawn still: the headline only crossfades once someone has scrubbed.
  const [touched, setTouched] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);
  const goTo = (i: number) => {
    setTouched(true);
    setReturning(false);
    setIndex(i);
  };
  const backToNow = () => {
    if (index === 0) return;
    setReturning(true);
    setIndex(0);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setReturning(false), 700);
  };

  const today = daily[0];
  const hour = index === 0 ? undefined : hourly[index];
  const shown = hour ?? {
    time: weather.at,
    temp: current.temp,
    code: current.code,
    isDay: current.isDay,
    precipProb: current.precipProb,
  };
  const dayOfShown = daily.find((d) => d.date === shown.time.slice(0, 10)) ?? today;
  const condition = conditionOf(shown.code);
  const sky = skyTimeOf(shown.time, shown.isDay, dayOfShown?.sunrise, dayOfShown?.sunset);
  const tone = toneOf(condition);
  const words = conditionWords(shown.code);

  const where = [place.region, place.country].filter((p) => p && p !== place.name).join(', ');
  const placeName = place.name;

  const describeHour = (i: number) => {
    const h = i === 0 ? undefined : hourly[i];
    const t = h?.temp ?? current.temp;
    const code = h?.code ?? current.code;
    const prob = h ? h.precipProb : current.precipProb;
    const when = h ? timeLabel(h.time, clock) : 'Now';
    return `${when}: ${deg(t)}${unit}, ${conditionWords(code).toLowerCase()}${
      prob !== undefined && prob >= 10 ? `, ${prob}% chance of ${wetWord(code)}` : ''
    }`;
  };

  const summary = [
    `${[placeName, where].filter(Boolean).join(', ')}.`,
    `Now ${deg(current.temp)}${unit} and ${conditionWords(current.code).toLowerCase()}, feels like ${deg(current.feels)}.`,
    today &&
      `Today ${deg(today.min)} to ${deg(today.max)}${
        today.precipProb !== undefined
          ? `, ${today.precipProb}% chance of ${wetWord(today.code)}`
          : ''
      }.`,
    `Wind ${n0.format(current.wind)} ${speed} from the ${compass(current.windDir)}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      aria-label={`Weather in ${placeName}`}
      className={cx(styles.root, className)}
      data-returning={returning || undefined}
      data-touched={touched || undefined}
      {...props}
    >
      <p className={styles.srOnly}>{summary}</p>

      <div className={styles.hero} data-sky={sky} data-tone={tone} data-condition={condition}>
        <div className={styles.layers} aria-hidden>
          <span className={styles.glow} />
          <span className={styles.starfield} />
          <span className={styles.veil} />
          <span className={styles.flash} />
        </div>

        <WeatherArt
          key={`${condition}-${sky === 'night'}`}
          className={styles.heroArt}
          condition={condition}
          time={sky}
          intensity={intensityOf(shown.code)}
        />

        <div className={styles.head} aria-hidden>
          <div className={styles.place}>
            <span className={styles.placeName}>{placeName}</span>
            {where && <span className={styles.placeWhere}>{where}</span>}
          </div>
          <div className={styles.when}>
            <span key={index} className={styles.swap}>
              {hour
                ? `${weekdayIfNotToday(hour.time, today?.date, clock)}${timeLabel(hour.time, clock)}`
                : 'Now'}
            </span>
          </div>
          <div className={styles.temp}>
            <span key={index} className={styles.swap}>
              {deg(shown.temp)}
            </span>
            <span className={styles.unit}>{unit}</span>
          </div>
          <div className={styles.condition}>
            <span key={index} className={styles.swap}>
              {words}
            </span>
          </div>
          <div className={styles.sub}>
            {hour ? (
              <span key={index} className={styles.swap}>
                {hour.precipProb !== undefined
                  ? `${hour.precipProb}% chance of ${wetWord(hour.code)}`
                  : 'No rain expected'}
              </span>
            ) : (
              <span>Feels like {deg(current.feels)}</span>
            )}
            {dayOfShown && (
              <span className={styles.hilo}>
                H {deg(dayOfShown.max)} <span className={styles.lo}>L {deg(dayOfShown.min)}</span>
              </span>
            )}
          </div>
        </div>

        {hourly.length > 1 && (
          <HourStrip
            hours={hourly}
            imperial={imperial}
            index={index}
            onIndex={goTo}
            onReturn={backToNow}
            describe={describeHour}
            locale={locale}
          />
        )}
      </div>

      {weather.alerts?.map((alert, i) => (
        <div key={i} className={styles.alert} data-severity={alert.severity ?? 'moderate'}>
          <TriangleAlert aria-hidden className={styles.alertIcon} />
          <span>
            <strong>{alert.title}</strong>
            {alert.until && ` until ${timeLabel(alert.until, clock)}`}
          </span>
        </div>
      ))}

      <Glance
        weather={weather}
        today={today}
        tomorrow={daily[1]}
        speed={speed}
        depth={depth}
        n0={n0}
        n1={n1}
        locale={locale}
      />

      {daily.length > 0 && (
        <Days
          daily={daily}
          now={current.temp}
          imperial={imperial}
          unit={unit}
          deg={deg}
          limit={days}
          locale={locale}
        />
      )}

      <div className={styles.foot}>
        <p className={styles.small}>
          {weather.source ? `${weather.source} · ` : ''}
          {timeLabel(weather.at, clock)} in {placeName}
        </p>
        <div className={styles.footEnd}>
          {share}
          <SegmentedControl
            size="sm"
            aria-label="Units"
            className={styles.units}
            value={units}
            onValueChange={(next) => chooseUnits(next === 'imperial' ? 'imperial' : 'metric')}
          >
            <SegmentedControl.Item value="metric">°C</SegmentedControl.Item>
            <SegmentedControl.Item value="imperial">°F</SegmentedControl.Item>
          </SegmentedControl>
        </div>
      </div>
    </section>
  );
}

/** "Tomorrow " before an hour of tomorrow, nothing before one of today. */
function weekdayIfNotToday(time: string, today: string | undefined, clock: { locale?: string }) {
  if (!today || time.startsWith(today)) return '';
  return `${weekday(time.slice(0, 10), clock)} `;
}

interface GlanceProps {
  weather: WeatherData;
  today?: WeatherDay;
  tomorrow?: WeatherDay;
  speed: string;
  depth: string;
  n0: Intl.NumberFormat;
  n1: Intl.NumberFormat;
  locale?: string;
}

/** Wind, rain, humidity, UV, the air and the sun: each a small tile with its words. */
function Glance({ weather, today, tomorrow, speed, depth, n0, n1, locale }: GlanceProps) {
  const { current } = weather;
  const imperial = weather.units === 'imperial';
  const uv = current.uv ?? today?.uvMax;
  const air = airReading(weather.airQuality, imperial);
  const pressure =
    current.pressure === undefined
      ? undefined
      : imperial
        ? `${n1.format(Math.round(current.pressure * 0.02953 * 100) / 100)} inHg`
        : `${n0.format(current.pressure)} hPa`;
  return (
    <div className={styles.glance}>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>Wind</span>
        <span className={styles.tileRow}>
          <span className={styles.compass} aria-hidden>
            <svg viewBox="0 0 32 32" focusable="false">
              <circle className={styles.compassRing} cx="16" cy="16" r="14" />
              <text className={styles.compassN} x="16" y="7.2" textAnchor="middle">
                N
              </text>
              <g transform={`rotate(${(current.windDir + 180) % 360} 16 16)`}>
                <g className={styles.windArrow}>
                  <path d="M16 6.5 L20.5 17 L16 14.6 L11.5 17 Z" />
                  <rect x="15" y="14" width="2" height="11" rx="1" />
                </g>
              </g>
            </svg>
          </span>
          <span className={styles.tileValue}>
            {n0.format(current.wind)}
            <span className={styles.tileUnit}> {speed}</span>
          </span>
        </span>
        <span className={styles.tileDetail}>
          From {compass(current.windDir)}
          {current.gusts !== undefined && ` · gusts ${n0.format(current.gusts)}`}
        </span>
      </div>

      {today?.precipSum !== undefined && (
        <div className={styles.tile}>
          <span className={styles.tileLabel}>
            {wetWord(today.code) === 'snow' ? 'Snow' : 'Rain'}
          </span>
          <span className={styles.tileValue}>
            {today.precipSum > 0 ? (
              <>
                {n1.format(today.precipSum)}
                <span className={styles.tileUnit}> {depth}</span>
              </>
            ) : (
              'None'
            )}
          </span>
          <span className={styles.tileDetail}>
            Today{today.precipProb !== undefined && ` · ${today.precipProb}% chance`}
          </span>
        </div>
      )}

      <div className={styles.tile}>
        <span className={styles.tileLabel}>Humidity</span>
        <span className={styles.tileValue}>
          {n0.format(current.humidity)}
          <span className={styles.tileUnit}>%</span>
        </span>
        {pressure && <span className={styles.tileDetail}>Pressure {pressure}</span>}
      </div>

      {uv !== undefined && (
        <div className={styles.tile}>
          <span className={styles.tileLabel}>UV index</span>
          <span className={styles.tileValue}>
            {n0.format(Math.round(uv))}
            <span className={styles.tileWords}> {uvWords(uv)}</span>
          </span>
          <Meter kind="uv" level={Math.min(1, uv / 11)} />
          {current.uv === undefined ? (
            <span className={styles.tileDetail}>Today’s highest</span>
          ) : (
            today?.uvMax !== undefined && (
              <span className={styles.tileDetail}>
                Highest {n0.format(Math.round(today.uvMax))} today
              </span>
            )
          )}
        </div>
      )}

      {air && (
        <div className={styles.tile}>
          <span className={styles.tileLabel}>Air quality</span>
          <span className={styles.tileValue}>
            {n0.format(air.value)}
            <span className={styles.tileWords}> {air.words}</span>
          </span>
          <Meter kind="air" level={air.level} />
          <span className={styles.tileDetail}>{air.scale}</span>
        </div>
      )}

      {today?.sunrise && today.sunset && (
        <SunTile at={weather.at} today={today} tomorrow={tomorrow} locale={locale} />
      )}
    </div>
  );
}

function Meter({ kind, level }: { kind: 'uv' | 'air'; level: number }) {
  return (
    <span className={styles.meter} data-kind={kind} aria-hidden>
      <span className={styles.meterDot} style={{ '--at': level } as CSSProperties} />
    </span>
  );
}

/** Where the sun is on its arc today, and the next sunrise or sunset. */
function SunTile({
  at,
  today,
  tomorrow,
  locale,
}: {
  at: string;
  today: WeatherDay;
  tomorrow?: WeatherDay;
  locale?: string;
}) {
  const clock = { locale };
  const rise = minutesOf(today.sunrise ?? '');
  const set = minutesOf(today.sunset ?? '');
  const now = minutesOf(at);
  const up = now >= rise && now <= set;
  const f = set > rise ? Math.min(1, Math.max(0, (now - rise) / (set - rise))) : 0.5;
  const angle = Math.PI * (1 - f);
  const x = 50 + 40 * Math.cos(angle);
  const y = 38 - 30 * Math.sin(angle);
  const after = now > set;
  const next =
    !up && after
      ? { word: 'Sunrise', time: tomorrow?.sunrise }
      : !up
        ? { word: 'Sunrise', time: today.sunrise }
        : { word: 'Sunset', time: today.sunset };
  const other =
    next.word === 'Sunrise'
      ? { word: 'Sunset', time: today.sunset }
      : { word: 'Sunrise', time: today.sunrise };
  return (
    <div className={cx(styles.tile, styles.sunTile)} data-up={up || undefined}>
      <span className={styles.tileLabel}>{next.word}</span>
      <span className={styles.tileValue}>{next.time ? timeLabel(next.time, clock) : '—'}</span>
      <svg className={styles.arc} viewBox="0 0 100 44" aria-hidden focusable="false">
        <line className={styles.horizon} x1="4" y1="38" x2="96" y2="38" />
        <path className={styles.arcPath} d="M10,38 A40,30 0 0 1 90,38" pathLength={1} />
        {up && (
          <path
            className={styles.arcDone}
            d="M10,38 A40,30 0 0 1 90,38"
            pathLength={1}
            strokeDasharray={`${f} 1`}
          />
        )}
        <circle
          className={styles.arcSun}
          cx={up ? x : after ? 90 : 10}
          cy={up ? y : 38}
          r={up ? 4.2 : 3}
        />
      </svg>
      {other.time && (
        <span className={styles.tileDetail}>
          {other.word} {timeLabel(other.time, clock)}
        </span>
      )}
    </div>
  );
}

interface DaysProps {
  daily: WeatherDay[];
  now: number;
  imperial: boolean;
  unit: string;
  deg: (t: number) => string;
  limit: number;
  locale?: string;
}

/** The days ahead, each a range on one shared scale, cool to warm. */
function Days({ daily, now, imperial, unit, deg, limit, locale }: DaysProps) {
  const clock = { locale };
  const lo = Math.min(...daily.map((d) => d.min));
  const hi = Math.max(...daily.map((d) => d.max));
  const span = Math.max(1, hi - lo);
  const pos = (t: number) => (t - lo) / span;
  const { folded, folds, showAll } = useShowAll(daily.length, limit);
  const rows = folded ? daily.slice(0, limit) : daily;
  return (
    <div className={styles.daysWrap}>
      <ol className={styles.days} aria-label={`${daily.length}-day forecast`}>
        {rows.map((d, i) => {
          const name = i === 0 ? 'Today' : weekday(d.date, clock);
          const long = i === 0 ? 'Today' : weekday(d.date, clock, true);
          const wet = d.precipProb !== undefined && d.precipProb >= 20;
          return (
            <li key={d.date} className={styles.day} data-today={i === 0 || undefined}>
              <span className={styles.srOnly}>
                {`${long}: ${conditionWords(d.code).toLowerCase()}, ${deg(d.min)} to ${deg(d.max)}${unit}${
                  d.precipProb !== undefined
                    ? `, ${d.precipProb}% chance of ${wetWord(d.code)}`
                    : ''
                }.`}
              </span>
              <span className={styles.dayName} aria-hidden>
                {name}
              </span>
              <span className={styles.dayGlyph} aria-hidden>
                <ConditionGlyph condition={conditionOf(d.code)} />
              </span>
              <span className={styles.dayWet} aria-hidden>
                {wet ? `${d.precipProb}%` : ''}
              </span>
              <span className={styles.dayMin} aria-hidden>
                {deg(d.min)}
              </span>
              <span
                className={styles.range}
                aria-hidden
                style={
                  {
                    '--l': pos(d.min),
                    '--r': pos(d.max),
                    '--h1': tempHue(toCelsius(d.min, imperial)),
                    '--h2': tempHue(toCelsius(d.max, imperial)),
                  } as CSSProperties
                }
              >
                <span className={styles.rangeFill} />
                {i === 0 && now >= d.min - 0.5 && now <= d.max + 0.5 && (
                  <span
                    className={styles.rangeNow}
                    style={{ '--at': pos(Math.min(d.max, Math.max(d.min, now))) } as CSSProperties}
                  />
                )}
              </span>
              <span className={styles.dayMax} aria-hidden>
                {deg(d.max)}
              </span>
            </li>
          );
        })}
      </ol>
      {folds && folded && <ShowAll onClick={showAll}>Show {daily.length} days</ShowAll>}
    </div>
  );
}
