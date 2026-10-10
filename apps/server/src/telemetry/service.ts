/**
 * Dashboards (ADR 0121): Conch's numbers and the shape of its work, for a
 * dashboard of the person's own. One service per gateway:
 *
 * - it listens to what the gateway already broadcasts (`observe`) and keeps
 *   the numbers in memory (`Meter`) and each turn as a trace (`TurnWatcher`);
 * - it serves them to Prometheus (`prometheus`), behind the scrape token;
 * - it sends them over OTLP to the destination chosen in Settings →
 *   Dashboards, from bounded queues with retries, never on a turn's path;
 * - it says how that's going (`status`), shows exactly what leaves
 *   (`preview`), proves the way works (`test`), and joins Repair everything.
 *
 * Off until a person turns something on. What leaves is never a chat's words
 * unless the person turned `content` on, and then only redacted.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { cpus } from 'node:os';

import {
  destinationOf,
  destinationSubject,
  TelemetrySettings,
  type DashboardDestinationId,
  type DoctorItem,
  type DoctorReport,
  type MetricPreview,
  type ScrapeTokenResult,
  type SpanPreview,
  type TelemetryPreview,
  type TelemetryProblem,
  type TelemetrySignal,
  type TelemetryStatus,
  type TelemetryTestResult,
  type TelemetryUpdate,
  type ServerEvent,
} from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { Heal } from '../lib/recover';
import { METRICS, prometheusLabel, prometheusName } from './catalog';
import { Meter, type MetricSnapshot } from './meter';
import {
  DELTA,
  logsJson,
  logsProto,
  metricsJson,
  metricsProto,
  msToNs,
  SPAN_KIND,
  STATUS,
  tracesJson,
  tracesProto,
  type Attributes,
  type Batch,
  type LogData,
  type MetricData,
  type Scope,
  type SpanData,
  type Temporality,
} from './otlp';
import { keyHint, targetOf, TargetProblem, type Target } from './presets';
import { writePrometheus, wantsOpenMetrics, OPENMETRICS_TYPE, TEXT_TYPE } from './prometheus';
import {
  BatchQueue,
  postOtlp,
  sendWithRetry,
  statusWords,
  type Outcome,
  type SendDeps,
} from './sender';
import { TelemetryStore } from './store';
import { TurnWatcher } from './turns';

/** What the numbers about this computer and Conch's parts are read from, each when asked. */
export interface GaugeSources {
  resources?: () => Promise<{
    level: 'healthy' | 'busy' | 'critical';
    availableBytes: number;
    totalBytes: number;
  }>;
  disk?: () => Promise<{ usedBytes: number; totalBytes: number } | undefined>;
  memories?: () => Promise<number>;
  skills?: () => Promise<number>;
  providers?: () => Promise<{ id: string; ready: boolean }[]>;
  agents?: () => Promise<{ agents: { id: string; name: string }[]; defaultId: string }>;
}

export interface TelemetryDeps {
  home: string;
  version: string;
  heal?: Heal;
  gauges?: GaugeSources;
  /** Conch's redaction (keys, passwords, emails, the home folder) for words that leave. */
  redact?: () => (text: string) => string;
  send?: SendDeps;
  now?: () => number;
  /** Timers off, for tests that drive `tick` themselves. */
  manual?: boolean;
}

const SCOPE: Scope = { name: 'conch', version: '1' };
const SPAN_QUEUE = 2048;
const LOG_QUEUE = 2048;
const BATCH = 256;
/** A gauge read this recently is read again only after this long. */
const GAUGE_FRESH_MS = 5_000;
const PROVIDERS_FRESH_MS = 60_000;

const empty = (): Record<TelemetrySignal, number> => ({ metrics: 0, traces: 0, logs: 0 });

export class TelemetryService {
  readonly store: TelemetryStore;
  readonly meter: Meter;
  readonly turns: TurnWatcher;
  #settings: TelemetrySettings = TelemetrySettings.parse({});
  #target?: Target;
  #targetProblem?: TargetProblem;
  #resource: Attributes = {};
  #spans: BatchQueue<SpanData>;
  #logs: BatchQueue<LogData>;
  #metricsSending?: Promise<void>;
  /** What the last metrics that arrived said, for services that want differences. */
  #lastSent = new Map<
    string,
    { value: number; count: number; sum: number; buckets: number[]; at: number }
  >();
  #timers: NodeJS.Timeout[] = [];
  #metricsTimer?: NodeJS.Timeout;
  #stop = new AbortController();
  #loop?: ReturnType<typeof monitorEventLoopDelay>;
  #cpu?: { busy: number; total: number };
  #gaugesAt = 0;
  #providersAt = 0;
  #health?: DoctorReport;
  #sent = empty();
  #dropped = 0;
  #problem?: TelemetryProblem;
  #lastSentAt?: number;
  #scrapes = 0;
  #lastScrapeAt?: number;
  #ready: Promise<void>;
  #redactor?: (text: string) => string;

  constructor(private readonly deps: TelemetryDeps) {
    const now = deps.now ?? Date.now;
    this.store = new TelemetryStore(deps.home, deps.heal);
    this.meter = new Meter({ now });
    this.turns = new TurnWatcher({
      meter: this.meter,
      now,
      sinks: {
        span: (span) => {
          if (this.#sending('traces')) this.#spans.push(span);
        },
        log: (log) => {
          if (this.#sending('logs')) this.#logs.push(log);
        },
      },
      content: () => (this.#settings.content ? this.#redact : false),
      flavour: () => this.#target?.flavour,
    });
    const full = (signal: TelemetrySignal) => (count: number) => {
      this.#dropped += count;
      this.meter.add('conch.telemetry.dropped', count, {
        'conch.signal': signal,
        'conch.reason': 'queue_full',
      });
    };
    this.#spans = new BatchQueue({
      max: SPAN_QUEUE,
      batch: BATCH,
      onFull: full('traces'),
      send: (items) => this.#sendBatch('traces', items),
    });
    this.#logs = new BatchQueue({
      max: LOG_QUEUE,
      batch: BATCH,
      onFull: full('logs'),
      send: (items) => this.#sendBatch('logs', items),
    });
    this.#ready = this.#reload().catch(() => undefined);
  }

  /** Conch's redaction, then a length limit. */
  #redact = (text: string): string => {
    this.#redactor ??= this.deps.redact?.() ?? ((t: string) => t);
    return this.#redactor(text);
  };

  #sending(signal: TelemetrySignal): boolean {
    return Boolean(this.#settings.otlp.on && this.#target?.urls[signal]);
  }

  /** Read the settings again, and where they send. */
  async #reload(): Promise<void> {
    this.#settings = await this.store.settings();
    this.#redactor = undefined;
    // Made only once something's on: a Conch that never sends writes nothing.
    const on = this.#settings.otlp.on || this.#settings.prometheus.on;
    const instance = on ? await this.store.instance() : 'unset';
    this.#resource = {
      'service.name': 'conch',
      'service.version': this.deps.version,
      'service.instance.id': instance,
      'telemetry.sdk.name': 'conch',
      'telemetry.sdk.language': 'nodejs',
      'telemetry.sdk.version': this.deps.version,
      'os.type': process.platform === 'win32' ? 'windows' : process.platform,
    };
    const otlp = this.#settings.otlp;
    this.#target = undefined;
    this.#targetProblem = undefined;
    if (otlp.on) {
      try {
        this.#target = targetOf(otlp, await this.store.fields(otlp.destination));
      } catch (error) {
        if (!(error instanceof TargetProblem)) throw error;
        this.#targetProblem = error;
      }
    }
    if (!this.#sending('traces')) this.#spans.clear();
    if (!this.#sending('logs')) this.#logs.clear();
    this.#schedule();
  }

  #schedule() {
    if (this.deps.manual) return;
    if (this.#metricsTimer) clearInterval(this.#metricsTimer);
    this.#metricsTimer = undefined;
    if (this.#sending('metrics')) {
      this.#metricsTimer = setInterval(
        () => void this.sendMetrics().catch(() => undefined),
        this.#settings.intervalSeconds * 1000,
      );
      this.#metricsTimer.unref();
    }
  }

  /** Start watching the settings file and flushing what waits. */
  start(): void {
    this.#loop = monitorEventLoopDelay({ resolution: 20 });
    this.#loop.enable();
    if (this.deps.manual) return;
    const tick = setInterval(() => void this.tick().catch(() => undefined), 5_000);
    tick.unref();
    this.#timers.push(tick);
    void this.#ready.then(async () => {
      const agents = await this.deps.gauges?.agents?.().catch(() => undefined);
      if (agents) this.turns.setAgents(agents);
    });
  }

  /** Every few seconds: the terminal may have changed the settings; spans and events go out. */
  async tick(): Promise<void> {
    await this.#ready;
    if (await this.store.changed()) await this.#reload();
    await Promise.all([this.#spans.flush(), this.#logs.flush()]);
  }

  /** Send what's waiting, within a deadline (Conch is stopping). */
  async stop(deadlineMs = 2_000): Promise<void> {
    for (const t of this.#timers) clearInterval(t);
    if (this.#metricsTimer) clearInterval(this.#metricsTimer);
    this.#loop?.disable();
    const flush = Promise.all([this.#spans.flush(), this.#logs.flush()]);
    await Promise.race([flush, new Promise((r) => setTimeout(r, deadlineMs).unref())]);
    this.#stop.abort();
  }

  /** Everything the gateway broadcasts comes through here. Never throws, never waits. */
  observe(event: ServerEvent): void {
    if (event.type === 'doctor.report') {
      this.#health = event.report;
      return;
    }
    this.turns.observe(event);
  }

  /**
   * A step Auto judged (ADR 0117/0118/0128): went ahead, asked, or lifted (the rules would
   * have asked after reading; a second look saw it serves the request), and the risk that made it.
   */
  auto(verdict: 'went_ahead' | 'asked' | 'lifted', risk?: string): void {
    this.meter.add('conch.auto.judgements', 1, {
      'conch.verdict': verdict,
      'conch.risk': risk ?? 'none',
    });
  }

  // ── Gauges ─────────────────────────────────────────────────────────────

  /** Read the gauges, if they're older than a few seconds. */
  async collect(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    if (now - this.#gaugesAt < GAUGE_FRESH_MS) return;
    this.#gaugesAt = now;
    const { meter } = this;
    const sources = this.deps.gauges ?? {};
    const active = this.turns.active();
    meter.set('conch.turns.active', active.running, { 'conch.state': 'running' });
    meter.set('conch.turns.active', active.waiting, { 'conch.state': 'waiting' });
    // The processor, between this reading and the last.
    const times = cpus().reduce(
      (sum, { times: t }) => {
        const total = t.user + t.nice + t.sys + t.idle + t.irq;
        return { busy: sum.busy + total - t.idle, total: sum.total + total };
      },
      { busy: 0, total: 0 },
    );
    if (this.#cpu && times.total > this.#cpu.total)
      meter.set(
        'system.cpu.utilization',
        Math.min(1, Math.max(0, (times.busy - this.#cpu.busy) / (times.total - this.#cpu.total))),
      );
    this.#cpu = times;
    meter.set('process.memory.usage', process.memoryUsage.rss());
    meter.set('process.uptime', Math.round(process.uptime()));
    if (this.#loop) {
      meter.set('nodejs.eventloop.delay.p99', this.#loop.percentile(99) / 1e9);
      this.#loop.reset();
    }
    if (this.#health) {
      meter.clear('conch.health.items');
      const counts = new Map<string, number>();
      for (const item of this.#health.items)
        counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
      for (const [state, n] of counts) meter.set('conch.health.items', n, { 'conch.state': state });
    }
    const quietly = async <T>(read: (() => Promise<T>) | undefined): Promise<T | undefined> =>
      read ? read().catch(() => undefined) : undefined;
    const [resources, disk, memories, skills] = await Promise.all([
      quietly(sources.resources),
      quietly(sources.disk),
      quietly(sources.memories),
      quietly(sources.skills),
    ]);
    if (resources) {
      if (resources.totalBytes > 0)
        meter.set(
          'system.memory.utilization',
          Math.min(1, Math.max(0, 1 - resources.availableBytes / resources.totalBytes)),
        );
      for (const state of ['healthy', 'busy', 'critical'] as const)
        meter.set('conch.computer.room', resources.level === state ? 1 : 0, {
          'conch.state': state,
        });
    }
    if (disk && disk.totalBytes > 0)
      meter.set('system.filesystem.utilization', disk.usedBytes / disk.totalBytes);
    if (memories !== undefined) meter.set('conch.memories', memories);
    if (skills !== undefined) meter.set('conch.skills', skills);
    if (now - this.#providersAt >= PROVIDERS_FRESH_MS) {
      this.#providersAt = now;
      const providers = await quietly(sources.providers);
      if (providers) {
        meter.clear('conch.providers.ready');
        for (const p of providers)
          meter.set('conch.providers.ready', p.ready ? 1 : 0, { 'conch.provider': p.id });
      }
    }
  }

  // ── Prometheus ─────────────────────────────────────────────────────────

  /** Whether `/metrics` answers at all, and who it lets in. */
  async scrapeAccess(): Promise<TelemetrySettings['prometheus'] | undefined> {
    await this.#ready;
    if (await this.store.changed()) await this.#reload();
    return this.#settings.prometheus.on ? this.#settings.prometheus : undefined;
  }

  /** The page Prometheus reads. */
  async prometheus(accept?: string): Promise<{ body: string; type: string }> {
    await this.collect();
    this.#scrapes++;
    this.#lastScrapeAt = (this.deps.now ?? Date.now)();
    const open = wantsOpenMetrics(accept);
    const resource = Object.fromEntries(
      Object.entries(this.#resource)
        .filter(([key]) => key.startsWith('service.'))
        .map(([key, value]) => [prometheusLabel(key), String(value)]),
    );
    return {
      body: writePrometheus(this.meter.snapshot(), resource, { openMetrics: open }),
      type: open ? OPENMETRICS_TYPE : TEXT_TYPE,
    };
  }

  // ── OTLP ───────────────────────────────────────────────────────────────

  #destinationName(): string {
    return destinationSubject(destinationOf(this.#settings.otlp.destination));
  }

  #encode(
    signal: TelemetrySignal,
    batch: Batch<MetricData> | Batch<SpanData> | Batch<LogData>,
    target: Target,
  ) {
    const json = target.encoding === 'json';
    const body =
      signal === 'metrics'
        ? json
          ? metricsJson(batch as Batch<MetricData>)
          : metricsProto(batch as Batch<MetricData>)
        : signal === 'traces'
          ? json
            ? tracesJson(batch as Batch<SpanData>)
            : tracesProto(batch as Batch<SpanData>)
          : json
            ? logsJson(batch as Batch<LogData>)
            : logsProto(batch as Batch<LogData>);
    return { body, type: json ? 'application/json' : 'application/x-protobuf' };
  }

  #outcome(outcome: Outcome) {
    const { signal } = outcome;
    this.meter.add('conch.telemetry.exports', 1, {
      'conch.signal': signal,
      'conch.outcome': outcome.ok ? 'ok' : 'failed',
    });
    if (outcome.dropped) {
      this.#dropped += outcome.dropped.count;
      this.meter.add('conch.telemetry.dropped', outcome.dropped.count, {
        'conch.signal': signal,
        'conch.reason': outcome.dropped.reason,
      });
    }
    if (outcome.ok) {
      this.#sent[signal] += outcome.items;
      this.#lastSentAt = (this.deps.now ?? Date.now)();
      if (this.#problem?.signal === signal) this.#problem = undefined;
    } else if (outcome.problem) this.#problem = outcome.problem;
  }

  async #sendBatch(signal: 'traces' | 'logs', items: SpanData[] | LogData[]): Promise<void> {
    const target = this.#target;
    const url = target?.urls[signal];
    if (!target || !url || !this.#settings.otlp.on) return;
    const { body, type } = this.#encode(
      signal,
      { resource: this.#resource, scope: SCOPE, items } as Batch<SpanData>,
      target,
    );
    const outcome = await sendWithRetry(
      () => postOtlp(url, target.headers[signal] ?? {}, body, type, this.deps.send),
      {
        signal,
        items: items.length,
        destination: this.#destinationName(),
        stop: this.#stop.signal,
        ...(this.deps.send && { deps: this.deps.send }),
      },
    );
    this.#outcome(outcome);
  }

  /** The numbers as OTLP wants them: cumulative, or the difference since the last that arrived. */
  #metricData(snapshot: readonly MetricSnapshot[], temporality: Temporality, nowMs: number) {
    const timeNs = msToNs(nowMs);
    const next = new Map(this.#lastSent);
    const data: MetricData[] = [];
    for (const { def, series } of snapshot) {
      const base = { name: def.name, description: def.description, unit: def.unit };
      if (def.kind === 'gauge') {
        data.push({
          ...base,
          kind: 'gauge',
          points: series.map((s) => ({
            attributes: s.labels,
            startNs: msToNs(s.start),
            timeNs,
            value: s.value,
          })),
        });
        continue;
      }
      const points = series.map((s) => {
        const key = `${def.name}\u0002${JSON.stringify(s.labels)}`;
        const before = temporality === DELTA ? this.#lastSent.get(key) : undefined;
        const h = s.histogram;
        next.set(key, {
          value: s.value,
          count: h?.count ?? 0,
          sum: h?.sum ?? 0,
          buckets: h?.buckets ?? [],
          at: nowMs,
        });
        return { s, before, startMs: before?.at ?? s.start };
      });
      if (def.kind === 'counter')
        data.push({
          ...base,
          kind: 'sum',
          monotonic: true,
          temporality,
          points: points.map(({ s, before, startMs }) => ({
            attributes: s.labels,
            startNs: msToNs(startMs),
            timeNs,
            value: Math.max(0, s.value - (before?.value ?? 0)),
          })),
        });
      else
        data.push({
          ...base,
          kind: 'histogram',
          temporality,
          points: points.map(({ s, before, startMs }) => {
            const h = s.histogram ?? { count: 0, sum: 0, min: 0, max: 0, buckets: [] };
            const delta = Boolean(before);
            return {
              attributes: s.labels,
              startNs: msToNs(startMs),
              timeNs,
              count: Math.max(0, h.count - (before?.count ?? 0)),
              sum: Math.max(0, h.sum - (before?.sum ?? 0)),
              // Min and max are over the whole series: only true for cumulative points.
              ...(!delta && h.count > 0 && { min: h.min, max: h.max }),
              bucketCounts: h.buckets.map((c, i) => Math.max(0, c - (before?.buckets[i] ?? 0))),
              bounds: def.buckets ?? [],
            };
          }),
        });
    }
    return { data, next };
  }

  /** Send the numbers now (every interval, and from Repair). One send at a time. */
  sendMetrics(): Promise<void> {
    this.#metricsSending ??= (async () => {
      try {
        await this.#ready;
        const target = this.#target;
        const url = target?.urls.metrics;
        if (!target || !url || !this.#settings.otlp.on) return;
        await this.collect();
        const now = (this.deps.now ?? Date.now)();
        const { data, next } = this.#metricData(this.meter.snapshot(), target.temporality, now);
        if (!data.length) return;
        const { body, type } = this.#encode(
          'metrics',
          { resource: this.#resource, scope: SCOPE, items: data },
          target,
        );
        const points = data.reduce((n, m) => n + m.points.length, 0);
        const outcome = await sendWithRetry(
          () => postOtlp(url, target.headers.metrics ?? {}, body, type, this.deps.send),
          {
            signal: 'metrics',
            items: points,
            destination: this.#destinationName(),
            stop: this.#stop.signal,
            ...(this.deps.send && { deps: this.deps.send }),
          },
        );
        // Differences count from what arrived: what didn't goes again next time, so
        // numbers that didn't arrive are late, never lost.
        if (outcome.ok) this.#lastSent = next;
        const { dropped, ...rest } = outcome;
        this.#outcome(outcome.ok && dropped ? { ...rest, dropped } : rest);
      } finally {
        this.#metricsSending = undefined;
      }
    })();
    return this.#metricsSending;
  }

  // ── What the page asks ────────────────────────────────────────────────

  async status(): Promise<TelemetryStatus> {
    await this.#ready;
    if (await this.store.changed()) await this.#reload();
    const settings = this.#settings;
    const destination = destinationOf(settings.otlp.destination);
    const fields = await this.store.fields(settings.otlp.destination);
    const saved = Object.keys(fields).filter((id) => fields[id]?.trim());
    const hint = keyHint(
      fields,
      destination.fields.filter((f) => f.secret).map((f) => f.id),
    );
    const problem =
      this.#targetProblem && settings.otlp.on
        ? {
            at: (this.deps.now ?? Date.now)(),
            signal: 'traces' as const,
            message: this.#targetProblem.message,
            yours: true,
          }
        : this.#problem;
    return {
      settings,
      key: {
        ...(saved.length && { destination: settings.otlp.destination }),
        fields: saved,
        ...(hint && { hint }),
      },
      prometheus: {
        path: '/metrics',
        tokenSaved: await this.store.hasScrapeToken(),
        ...(this.#lastScrapeAt !== undefined && { lastScrapeAt: this.#lastScrapeAt }),
        scrapes: this.#scrapes,
      },
      otlp: {
        targets: this.#target && settings.otlp.on ? { ...this.#target.urls } : {},
        ...(this.#lastSentAt !== undefined && { lastSentAt: this.#lastSentAt }),
        ...(problem && { problem }),
        sent: { ...this.#sent },
        queued: this.#spans.size + this.#logs.size,
        dropped: this.#dropped,
      },
    };
  }

  /** A change from the page or the terminal. Keys go to the sealed file, never anywhere else. */
  async update(body: TelemetryUpdate): Promise<TelemetryStatus> {
    await this.#ready;
    const current = await this.store.settings();
    const { key, ...patch } = body;
    const destination: DashboardDestinationId = patch.otlp?.destination ?? current.otlp.destination;
    const { endpoint, region, signals, ...rest } = patch.otlp ?? {};
    const otlp: TelemetrySettings['otlp'] = {
      ...current.otlp,
      ...rest,
      signals: { ...current.otlp.signals, ...signals },
      ...(endpoint && { endpoint }),
      ...(region && { region }),
    };
    if (endpoint === null) delete otlp.endpoint;
    if (region === null) delete otlp.region;
    // A new destination starts from its own address, never the last one's.
    if (patch.otlp?.destination && patch.otlp.destination !== current.otlp.destination) {
      if (endpoint === undefined) delete otlp.endpoint;
      if (region === undefined) delete otlp.region;
    }
    const next = TelemetrySettings.parse({
      ...current,
      ...(patch.prometheus && { prometheus: { ...current.prometheus, ...patch.prometheus } }),
      otlp,
      ...(patch.content !== undefined && { content: patch.content }),
      ...(patch.intervalSeconds !== undefined && { intervalSeconds: patch.intervalSeconds }),
    });
    await this.store.setSettings(next);
    if (key === null) await this.store.setFields(destination, null);
    else if (key) {
      const known = new Set(destinationOf(destination).fields.map((f) => f.id));
      const fields = new Map(Object.entries(await this.store.fields(destination)));
      for (const [id, value] of Object.entries(key))
        if (known.has(id)) {
          if (value.trim()) fields.set(id, value.trim());
          else fields.delete(id);
        }
      await this.store.setFields(destination, Object.fromEntries(fields));
    }
    await this.#reload();
    this.#problem = undefined;
    // On a first turn-on the numbers go at once, so the dashboard isn't empty for a minute.
    if (next.otlp.on && !current.otlp.on && !this.deps.manual)
      void this.sendMetrics().catch(() => undefined);
    return this.status();
  }

  /** A new scrape token, and the scrape config that uses it, for where this page is open. */
  async newScrapeToken(where: { host: string; https: boolean }): Promise<ScrapeTokenResult> {
    const token = await this.store.newScrapeToken();
    return { token, config: scrapeConfig(where, token) };
  }

  /** Exactly what would leave now. */
  async preview(): Promise<TelemetryPreview> {
    await this.collect();
    const snapshot = new Map(this.meter.snapshot().map((m) => [m.def.name, m]));
    const metrics: MetricPreview[] = METRICS.map((def) => {
      const series = snapshot.get(def.name)?.series ?? [];
      return {
        name: def.name,
        prometheus: prometheusName(def),
        kind: def.kind,
        unit: def.unit,
        description: def.description,
        series: series.length,
        samples: series.slice(0, 3).map((s) => ({
          labels: s.labels,
          value: s.histogram ? s.histogram.count : Number(s.value.toPrecision(6)),
        })),
      };
    });
    const last = this.turns.last;
    const root = last[0]?.spanId;
    const origin = last[0]?.startNs ?? 0n;
    const spans: SpanPreview[] = last.slice(0, 40).map((span) => ({
      name: span.name.slice(0, 200),
      kind: span.kind === SPAN_KIND.client ? 'client' : 'internal',
      depth: span.parentSpanId && span.parentSpanId === root ? 1 : 0,
      startMs: Math.max(0, Number((span.startNs - origin) / 1_000_000n)),
      ms: Number((span.endNs - span.startNs) / 1_000_000n),
      attributes: Object.fromEntries(
        Object.entries(span.attributes).map(([k, v]) => [
          k.slice(0, 80),
          typeof v === 'string'
            ? v.slice(0, 400)
            : Array.isArray(v)
              ? v.join(', ').slice(0, 400)
              : (v as number | boolean),
        ]),
      ),
      ...(span.status.code === STATUS.error && { error: true }),
    }));
    return { metrics, spans };
  }

  /**
   * A real span, the numbers as they are and an event, sent now to the saved
   * destination, once each, so the answer comes in seconds: "Grafana Cloud
   * received it", or exactly what went wrong.
   */
  async test(): Promise<TelemetryTestResult> {
    await this.#ready;
    if (await this.store.changed()) await this.#reload();
    const otlp = this.#settings.otlp;
    const name = destinationSubject(destinationOf(otlp.destination));
    let target: Target;
    try {
      target = targetOf(otlp, await this.store.fields(otlp.destination));
    } catch (error) {
      if (!(error instanceof TargetProblem)) throw error;
      return { ok: false, message: error.message, signals: [] };
    }
    await this.collect();
    const now = (this.deps.now ?? Date.now)();
    const traceId = randomHex(16);
    const span: SpanData = {
      traceId,
      spanId: randomHex(8),
      name: 'conch.dashboards.test',
      kind: SPAN_KIND.internal,
      startNs: msToNs(now - 1),
      endNs: msToNs(now),
      attributes: { 'conch.test': true },
      events: [],
      status: { code: STATUS.ok },
    };
    const results: TelemetryTestResult['signals'] = [];
    const started = now;
    const signals = (['metrics', 'traces', 'logs'] as const).filter((s) => target.urls[s]);
    {
      await Promise.all(
        signals.map(async (signal) => {
          const url = target.urls[signal] as string;
          const items =
            signal === 'metrics'
              ? this.#metricData(this.meter.snapshot(), target.temporality, now).data
              : signal === 'traces'
                ? [span]
                : [
                    {
                      timeNs: msToNs(now),
                      severity: 9,
                      body: 'Conch said hello',
                      eventName: 'conch.dashboards.test',
                      attributes: { 'conch.test': true },
                      traceId,
                      spanId: span.spanId,
                    } satisfies LogData,
                  ];
          const { body, type } = this.#encode(
            signal,
            { resource: this.#resource, scope: SCOPE, items } as Batch<SpanData>,
            target,
          );
          const r = await postOtlp(url, target.headers[signal] ?? {}, body, type, {
            ...this.deps.send,
            timeoutMs: 10_000,
          });
          results.push({
            signal,
            ok: r.ok,
            ...(r.status !== undefined && { status: r.status }),
            ...(!r.ok && {
              message:
                r.status !== undefined
                  ? statusWords(r.status, name, false)
                  : `${name} ${r.message ?? 'couldn’t be reached'} at ${new URL(url).host}. Check it’s running, then try again.`,
            }),
          });
        }),
      );
    }
    const order = { metrics: 0, traces: 1, logs: 2 };
    results.sort((a, b) => order[a.signal] - order[b.signal]);
    const ms = (this.deps.now ?? Date.now)() - started;
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) {
      this.#problem = undefined;
      this.#lastSentAt = (this.deps.now ?? Date.now)();
      return { ok: true, message: `${name} received it.`, ms, signals: results };
    }
    const first = failed[0]?.message ?? `${name} didn’t take it.`;
    return {
      ok: false,
      message:
        failed.length < results.length
          ? `${name} took ${results
              .filter((r) => r.ok)
              .map((r) => r.signal)
              .join(' and ')}, but not ${failed.map((r) => r.signal).join(' or ')}: ${first}`
          : first,
      ms,
      signals: results,
    };
  }

  /** For the security checkup: what leaves, and who may read it without a token. */
  async checkupCopy(): Promise<{ sendsTo?: string; content: boolean; scrapeHere: boolean }> {
    const settings = await this.store.settings();
    return {
      ...(settings.otlp.on && {
        sendsTo: destinationSubject(destinationOf(settings.otlp.destination), false),
      }),
      content: settings.content,
      scrapeHere: settings.prometheus.on && settings.prometheus.access === 'this-computer',
    };
  }

  // ── Repair everything ─────────────────────────────────────────────────

  doctorCheck(): DoctorCheck {
    const item = (
      state: DoctorItem['state'],
      message: string,
      more?: Pick<DoctorItem, 'action' | 'repairable'>,
    ): DoctorItem[] => [
      { id: 'dashboards', group: 'Conch', title: 'Dashboards', state, message, ...more },
    ];
    const open = { kind: 'open' as const, label: 'Open Dashboards', place: 'dashboards' as const };
    return {
      id: 'dashboards',
      group: 'Conch',
      title: 'Dashboards',
      run: async ({ repair }) => {
        await this.#ready;
        if (await this.store.changed()) await this.#reload();
        if (!this.#settings.otlp.on) return [];
        const name = this.#destinationName();
        if (this.#targetProblem)
          return item('needs-you', this.#targetProblem.message, { action: open });
        if (!this.#problem)
          return item('ok', this.#lastSentAt ? `Sending to ${name}.` : `Ready to send to ${name}.`);
        if (this.#problem.yours) return item('needs-you', this.#problem.message, { action: open });
        if (!repair)
          return item(
            'warning',
            `${name} hasn’t taken what Conch sent lately. Repair tries again now.`,
            {
              repairable: true,
            },
          );
        await Promise.all([this.#spans.flush(), this.#logs.flush(), this.sendMetrics()]);
        if (!this.#problem) return item('fixed', `${name} is taking what Conch sends again.`);
        return item('warning', this.#problem.message, { action: open });
      },
    };
  }
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/** Prometheus's own words for scraping this Conch with its token. */
export function scrapeConfig(where: { host: string; https: boolean }, token?: string): string {
  return [
    'scrape_configs:',
    '  - job_name: conch',
    '    scrape_interval: 30s',
    '    metrics_path: /metrics',
    `    scheme: ${where.https ? 'https' : 'http'}`,
    '    authorization:',
    '      type: Bearer',
    token
      ? `      credentials: ${token}`
      : '      credentials_file: /etc/prometheus/conch-token  # the scrape token, on one line',
    '    static_configs:',
    `      - targets: ['${where.host.replace(/'/g, '')}']`,
    '',
  ].join('\n');
}
