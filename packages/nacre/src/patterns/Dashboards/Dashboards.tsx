import { RadioGroup as RadioPrimitive } from 'radix-ui';
import {
  Check,
  ChevronRight,
  ClipboardPaste,
  Download,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { MessageMark } from '../AgentAvatar/AgentAvatar';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './Dashboards.module.css';

// ── Where the numbers go ─────────────────────────────────────────────────

export interface DashboardTile {
  id: string;
  name: string;
  tagline: string;
  brand?: string;
  color?: string;
}

export interface DashboardPickerProps extends Omit<
  ComponentProps<typeof RadioPrimitive.Root>,
  'onValueChange' | 'value' | 'children'
> {
  destinations: readonly DashboardTile[];
  value: string;
  onValueChange: (id: string) => void;
  /** The one sending right now: it wears a live dot. */
  live?: string;
}

/**
 * Settings → Dashboards: where Conch's numbers go, as tiles of the services
 * people know — their mark, their name and what they're for in a few words.
 * One is chosen; the one sending now breathes a small dot. Arrow keys move
 * between them, as any radio group.
 */
export function DashboardPicker({
  destinations,
  value,
  onValueChange,
  live,
  className,
  ...props
}: DashboardPickerProps) {
  return (
    <RadioPrimitive.Root
      aria-label="Where to send"
      value={value}
      onValueChange={onValueChange}
      orientation="horizontal"
      loop
      className={cx(styles.picker, className)}
      {...props}
    >
      {destinations.map((d) => (
        <RadioPrimitive.Item key={d.id} value={d.id} className={styles.tile} data-lustre="">
          <IntegrationLogo brand={d.brand} name={d.name} color={d.color} size="md" decorative />
          <span className={styles.tileWords}>
            <span className={styles.tileName}>{d.name}</span>
            <span className={styles.tileTagline}>{d.tagline}</span>
          </span>
          {live === d.id && <span className={styles.live} aria-label="Sending now" role="img" />}
          <RadioPrimitive.Indicator className={styles.tick} aria-hidden>
            <Check />
          </RadioPrimitive.Indicator>
        </RadioPrimitive.Item>
      ))}
    </RadioPrimitive.Root>
  );
}

// ── Pasting what the service shows ───────────────────────────────────────

export interface FoundPiece {
  label: string;
  /** Shown as it is, or masked when `secret`: the start and the last four. */
  value: string;
  secret?: boolean;
}

export interface PasteWellProps extends Omit<ComponentProps<'div'>, 'onPaste' | 'children'> {
  /** “Paste what Grafana Cloud shows you”. */
  label: string;
  /** Where the key is made, in a sentence; a link beside it when there's `href`. */
  hint?: ReactNode;
  /** Read a paste: the app knows what it means. */
  onPaste: (text: string) => void;
  /** What Conch read out of it. */
  found?: readonly FoundPiece[];
  /** Saved already: what's kept, never the values. */
  saved?: string;
  /** A sentence when the paste didn't read as anything. */
  problem?: string;
  /** Take a paste anywhere on the page, outside another field. On by default. */
  catchPaste?: boolean;
  /** The fields themselves, for typing instead. */
  children?: ReactNode;
}

const mask = (value: string) => {
  const head = /^[A-Za-z]+[-_]/.exec(value)?.[0] ?? '';
  return value.length <= 8 ? '••••' : `${head}••••${value.slice(-4)}`;
};

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * One place to put what a service's setup page shows: its key, both of
 * Langfuse's keys, or the `OTEL_EXPORTER_OTLP_…` lines Grafana Cloud gives.
 * **Paste** reads the clipboard in one press, and a paste anywhere on the
 * page lands here too. What Conch read out of it comes back as pieces, a
 * key only ever as its start and last four. Typing each field is folded
 * underneath, for the few who want it.
 */
export function PasteWell({
  label,
  hint,
  onPaste,
  found = [],
  saved,
  problem,
  catchPaste = true,
  children,
  className,
  ...props
}: PasteWellProps) {
  const labelId = useId();
  const [typing, setTyping] = useState(false);
  const latest = useRef(onPaste);
  useEffect(() => {
    latest.current = onPaste;
  });
  useEffect(() => {
    if (!catchPaste) return;
    const take = (event: ClipboardEvent) => {
      if (editable(event.target)) return;
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      latest.current(text);
    };
    document.addEventListener('paste', take);
    return () => document.removeEventListener('paste', take);
  }, [catchPaste]);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) latest.current(text);
    } catch {
      // The browser said no: typing is the way.
      setTyping(true);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cx(styles.well, className)}
      data-found={found.length ? '' : undefined}
      {...props}
    >
      <div className={styles.wellHead}>
        <span className={styles.wellIcon} aria-hidden>
          <ClipboardPaste />
        </span>
        <div className={styles.wellWords}>
          <p id={labelId} className={styles.wellLabel}>
            {label}
          </p>
          {hint && <p className={styles.wellHint}>{hint}</p>}
        </div>
        <Button size="sm" onClick={() => void paste()} leadingIcon={<ClipboardPaste />}>
          Paste
        </Button>
      </div>
      {found.length > 0 && (
        <ul className={styles.pieces} aria-label="What Conch read" aria-live="polite">
          {found.map((piece) => (
            <li key={piece.label} className={styles.piece} data-nc-fresh="">
              <Check aria-hidden />
              <span className={styles.pieceLabel}>{piece.label}</span>
              <span className={styles.pieceValue}>
                {piece.secret ? mask(piece.value) : piece.value}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!found.length && saved && (
        <p className={styles.saved}>
          <LockKeyhole aria-hidden />
          {saved}
        </p>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          <TriangleAlert aria-hidden />
          {problem}
        </p>
      )}
      {children && (
        <div className={styles.typing}>
          <button
            type="button"
            className={styles.typeToggle}
            aria-expanded={typing}
            onClick={() => setTyping((t) => !t)}
          >
            <ChevronRight aria-hidden />
            Type them instead
          </button>
          {typing && <div className={styles.fields}>{children}</div>}
        </div>
      )}
    </div>
  );
}

// ── The test ─────────────────────────────────────────────────────────────

export type SendTestState = 'idle' | 'sending' | 'received' | 'failed';

export interface SendTestProps extends Omit<ComponentProps<'div'>, 'children'> {
  destination: { name: string; brand?: string; color?: string };
  state: SendTestState;
  /** The sentence that came back: “Grafana Cloud received it.” or exactly what went wrong. */
  message?: string;
  /** How long the round trip took. */
  ms?: number;
  onTest?: () => void;
  disabled?: boolean;
}

/**
 * The proof that it works: Conch's mark, a thin line, and the destination's
 * mark. Press **Send a test** and a pearl of light leaves the shell and runs
 * the line while the spiral works; when the service answers, its tile takes
 * one ring of light and a tick, and the sentence says it received it and how
 * fast. When it didn't, the line stops short in amber and the sentence says
 * exactly why. With reduced motion the pearl simply waits at the end.
 */
export function SendTest({
  destination,
  state,
  message,
  ms,
  onTest,
  disabled,
  className,
  ...props
}: SendTestProps) {
  const words =
    state === 'idle'
      ? `Sends one span and Conch’s numbers to ${destination.name} now.`
      : state === 'sending'
        ? `Sending to ${destination.name}…`
        : (message ?? '');
  return (
    <div className={cx(styles.test, className)} data-state={state} {...props}>
      <div className={styles.flight} aria-hidden>
        <MessageMark active={state === 'sending'} className={styles.from} />
        <span className={styles.wire}>
          <span className={styles.pearl} />
        </span>
        <span className={styles.to}>
          <IntegrationLogo
            brand={destination.brand}
            name={destination.name}
            color={destination.color}
            size="md"
            decorative
          />
          <span className={styles.toMark}>
            {state === 'received' ? <Check /> : state === 'failed' ? <TriangleAlert /> : null}
          </span>
        </span>
      </div>
      <div className={styles.testFoot}>
        <p className={styles.testWords} role="status" aria-live="polite">
          {words}
          {state === 'received' && ms !== undefined && (
            <span className={styles.ms}> {formatMs(ms)}</span>
          )}
        </p>
        <Button
          size="sm"
          variant={state === 'failed' ? 'solid' : 'surface'}
          onClick={onTest}
          loading={state === 'sending'}
          disabled={disabled || !onTest}
        >
          {state === 'received' || state === 'failed' ? 'Send again' : 'Send a test'}
        </Button>
      </div>
    </div>
  );
}

const formatMs = (ms: number) =>
  ms < 1000 ? `· ${Math.round(ms)} ms` : `· ${(ms / 1000).toFixed(1)} s`;

// ── What leaves ──────────────────────────────────────────────────────────

export interface MetricRow {
  name: string;
  prometheus: string;
  kind: 'counter' | 'gauge' | 'histogram';
  unit: string;
  description: string;
  series: number;
  samples: readonly { labels: Readonly<Record<string, string>>; value: number }[];
  group?: string;
}

export interface MetricPreviewProps extends Omit<ComponentProps<'section'>, 'children'> {
  metrics: readonly MetricRow[];
  /** Names as OpenTelemetry writes them, or as Prometheus does. */
  naming?: 'otel' | 'prometheus';
  /** How many to show before **Show all**. */
  initial?: number;
}

const KIND: Record<MetricRow['kind'], string> = {
  counter: 'Counter',
  gauge: 'Gauge',
  histogram: 'Histogram',
};

const numberWords = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

/**
 * Exactly what would leave now, so anyone can see it's private: each metric
 * by its name, what it counts in a line, and a few of its series — the
 * labels and the value — as they'd arrive. It opens with what never leaves.
 * Metrics with nothing yet wait quietly at the end.
 */
export function MetricPreview({
  metrics,
  naming = 'otel',
  initial = 8,
  className,
  ...props
}: MetricPreviewProps) {
  const headingId = useId();
  const [all, setAll] = useState(false);
  const sorted = [...metrics].sort((a, b) => Number(b.series > 0) - Number(a.series > 0));
  const shown = all ? sorted : sorted.slice(0, initial);
  return (
    <section aria-labelledby={headingId} className={cx(styles.preview, className)} {...props}>
      <h4 id={headingId} className={styles.srOnly}>
        What Conch sends
      </h4>
      <p className={styles.promise}>
        <ShieldCheck aria-hidden />
        <span>
          <strong>Numbers, and the names of models and tools.</strong> Never what anyone wrote, a
          file’s name, an address or a key.
        </span>
      </p>
      <ul className={styles.metrics}>
        {shown.map((m) => (
          <li key={m.name} className={styles.metric} data-empty={m.series ? undefined : ''}>
            <div className={styles.metricHead}>
              <code className={styles.metricName}>
                {naming === 'prometheus' ? m.prometheus : m.name}
              </code>
              <Badge size="sm" variant="outline" tone="neutral">
                {KIND[m.kind]}
              </Badge>
            </div>
            <p className={styles.metricWords}>{m.description}</p>
            {m.samples.length > 0 ? (
              <ul className={styles.samples} aria-label={`Some of ${m.name}`}>
                {m.samples.map((sample, i) => (
                  <li key={i} className={styles.sample}>
                    {Object.entries(sample.labels).map(([k, v]) => (
                      <span key={k} className={styles.label}>
                        <span className={styles.labelKey}>{k}</span>
                        <span className={styles.labelValue}>{v}</span>
                      </span>
                    ))}
                    <span className={styles.value}>
                      {m.kind === 'histogram'
                        ? `${numberWords.format(sample.value)} seen`
                        : numberWords.format(sample.value)}
                    </span>
                  </li>
                ))}
                {m.series > m.samples.length && (
                  <li className={styles.more}>and {m.series - m.samples.length} more</li>
                )}
              </ul>
            ) : (
              <p className={styles.nothing}>Nothing yet</p>
            )}
          </li>
        ))}
      </ul>
      {sorted.length > initial && (
        <Button size="sm" variant="ghost" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${sorted.length}`}
        </Button>
      )}
    </section>
  );
}

// ── A turn, as a trace ───────────────────────────────────────────────────

export interface SpanRow {
  name: string;
  kind: 'internal' | 'client';
  depth: number;
  startMs: number;
  ms: number;
  attributes: Readonly<Record<string, string | number | boolean>>;
  error?: boolean;
}

export interface TurnWaterfallProps extends Omit<ComponentProps<'section'>, 'children'> {
  spans: readonly SpanRow[];
}

const msWords = (ms: number) =>
  ms < 1000
    ? `${Math.round(ms)} ms`
    : ms < 60_000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;

/**
 * The newest turn as a dashboard will draw it: the agent's span over the
 * model's turns at work and each tool call, each a bar on one time line, so
 * the shape of the work is there at a glance. A row opens to its attributes,
 * exactly as they leave.
 */
export function TurnWaterfall({ spans, className, ...props }: TurnWaterfallProps) {
  const headingId = useId();
  const [open, setOpen] = useState<number | undefined>();
  const total = Math.max(1, ...spans.map((s) => s.startMs + s.ms));
  if (!spans.length) return null;
  return (
    <section aria-labelledby={headingId} className={cx(styles.waterfall, className)} {...props}>
      <h4 id={headingId} className={styles.srOnly}>
        The last turn, as a trace
      </h4>
      <ol className={styles.spans}>
        {spans.map((span, i) => {
          const expanded = open === i;
          return (
            <li
              key={i}
              className={styles.span}
              data-kind={span.kind}
              data-error={span.error || undefined}
            >
              <button
                type="button"
                className={styles.spanRow}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? undefined : i)}
                style={{ '--depth': span.depth } as CSSProperties}
              >
                <span className={styles.spanName}>{span.name}</span>
                <span className={styles.track} aria-hidden>
                  <span
                    className={styles.bar}
                    style={
                      {
                        '--from': `${(span.startMs / total) * 100}%`,
                        '--width': `${Math.max(0.6, (span.ms / total) * 100)}%`,
                        '--delay': `${i * 40}ms`,
                      } as CSSProperties
                    }
                  />
                </span>
                <span className={styles.spanMs}>{msWords(span.ms)}</span>
              </button>
              {expanded && (
                <dl className={styles.attrs}>
                  {Object.entries(span.attributes).map(([k, v]) => (
                    <div key={k} className={styles.attr}>
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Prometheus reading it ────────────────────────────────────────────────

export interface ScrapeBeatProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** When Prometheus last read it, epoch ms. */
  lastAt?: number;
  /** Now, for tests and stories. */
  now?: number;
}

const agoWords = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/**
 * Whether Prometheus is really reading Conch: a small heart that beats once
 * each time it does, and when it last did. Before the first read it waits,
 * hollow, and says so.
 */
export function ScrapeBeat({ lastAt, now, className, ...props }: ScrapeBeatProps) {
  const [clock, setClock] = useState(() => now ?? Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [now]);
  const at = now ?? clock;
  return (
    <p className={cx(styles.beat, className)} data-read={lastAt ? '' : undefined} {...props}>
      <span key={lastAt ?? 0} className={styles.heart} aria-hidden />
      {lastAt ? `Prometheus read it ${agoWords(at - lastAt)}` : 'Waiting for Prometheus to read it'}
    </p>
  );
}

// ── The Grafana dashboard ────────────────────────────────────────────────

export interface GrafanaCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Copy the dashboard's JSON. */
  onCopy?: () => void;
  /** Where it downloads from. */
  href?: string;
  copied?: boolean;
}

/**
 * A ready-made Grafana dashboard: a small picture of it (turns, spending,
 * tools, the computer — drawn, inert), and the two ways to take it.
 */
export function GrafanaCard({ onCopy, href, copied, className, ...props }: GrafanaCardProps) {
  return (
    <div className={cx(styles.grafana, className)} {...props}>
      <div className={styles.mini} aria-hidden>
        <span className={styles.miniStat} data-tone="accent" />
        <span className={styles.miniStat} />
        <span className={styles.miniStat} data-tone="warn" />
        <span className={styles.miniStat} />
        <span className={styles.miniChart}>
          {[38, 52, 44, 70, 62, 84, 58, 76, 90, 66, 72, 95].map((h, i) => (
            <span key={i} style={{ '--h': `${h}%`, '--i': i } as CSSProperties} />
          ))}
        </span>
        <span className={styles.miniLine}>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none">
            <path d="M0 24 L12 20 L24 22 L36 14 L48 16 L60 9 L72 12 L84 6 L100 8" />
          </svg>
        </span>
      </div>
      <div className={styles.grafanaWords}>
        <p className={styles.grafanaTitle}>A dashboard for Grafana</p>
        <p className={styles.grafanaHint}>
          Turns, tokens, spending, tools, questions and this computer. In Grafana: Dashboards → New
          → Import.
        </p>
        <div className={styles.grafanaActions}>
          <Button size="sm" onClick={onCopy} leadingIcon={copied ? <Check /> : undefined}>
            {copied ? 'Copied' : 'Copy dashboard'}
          </Button>
          {href && (
            <Button size="sm" variant="surface" asChild leadingIcon={<Download />}>
              <a href={href} download="conch-grafana.json">
                Download
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
