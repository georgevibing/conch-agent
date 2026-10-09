/**
 * OTLP, the OpenTelemetry protocol, as Conch sends it (ADR 0119): metrics,
 * traces and logs as `ExportMetricsServiceRequest`, `ExportTraceServiceRequest`
 * and `ExportLogsServiceRequest`, encoded as protobuf (what every service
 * takes, and the only thing Phoenix takes) or as JSON (for a collector that
 * asks for it).
 *
 * Both encodings come from one model, written from opentelemetry-proto
 * (`opentelemetry/proto/{common,resource,metrics,trace,logs}/v1/*.proto`) and
 * the OTLP specification's JSON mapping: trace and span ids as hex, enums as
 * numbers, 64-bit integers as decimal strings, lowerCamelCase keys.
 * `otlp.test.ts` decodes what this writes against those `.proto` files.
 */
import { ProtoWriter } from './proto';

export type AttrValue = string | number | boolean | readonly string[];
export type Attributes = Record<string, AttrValue>;

export interface Scope {
  name: string;
  version: string;
}

/** A point in a sum or a gauge. */
export interface NumberPoint {
  attributes: Attributes;
  startNs: bigint;
  timeNs: bigint;
  value: number;
}

export interface HistogramPoint {
  attributes: Attributes;
  startNs: bigint;
  timeNs: bigint;
  count: number;
  sum: number;
  min?: number;
  max?: number;
  bucketCounts: readonly number[];
  bounds: readonly number[];
}

export const DELTA = 1;
export const CUMULATIVE = 2;
export type Temporality = typeof DELTA | typeof CUMULATIVE;

export type MetricData =
  | {
      name: string;
      description: string;
      unit: string;
      kind: 'sum';
      monotonic: boolean;
      temporality: Temporality;
      points: NumberPoint[];
    }
  | { name: string; description: string; unit: string; kind: 'gauge'; points: NumberPoint[] }
  | {
      name: string;
      description: string;
      unit: string;
      kind: 'histogram';
      temporality: Temporality;
      points: HistogramPoint[];
    };

export const SPAN_KIND = { internal: 1, client: 3 } as const;
export const STATUS = { unset: 0, ok: 1, error: 2 } as const;

export interface SpanData {
  /** 32 hex digits. */
  traceId: string;
  /** 16 hex digits. */
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: (typeof SPAN_KIND)[keyof typeof SPAN_KIND];
  startNs: bigint;
  endNs: bigint;
  attributes: Attributes;
  events: { timeNs: bigint; name: string; attributes: Attributes }[];
  status: { code: (typeof STATUS)[keyof typeof STATUS]; message?: string };
}

/** OpenTelemetry's severity numbers: INFO 9, WARN 13, ERROR 17. */
export const SEVERITY = { info: 9, warn: 13, error: 17 } as const;

export interface LogData {
  timeNs: bigint;
  severity: (typeof SEVERITY)[keyof typeof SEVERITY];
  /** A few plain words: "Turn finished". Never what anyone wrote. */
  body: string;
  eventName: string;
  attributes: Attributes;
  traceId?: string;
  spanId?: string;
}

export interface Batch<T> {
  resource: Attributes;
  scope: Scope;
  items: readonly T[];
}

export const msToNs = (ms: number): bigint => BigInt(Math.round(ms * 1000)) * 1000n;

// ── JSON ─────────────────────────────────────────────────────────────────

function anyJson(value: AttrValue): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number')
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { arrayValue: { values: value.map((v) => ({ stringValue: v })) } };
}

const attrsJson = (attributes: Attributes) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: anyJson(value) }));

const resourceJson = (resource: Attributes) => ({ attributes: attrsJson(resource) });
const scopeJson = (scope: Scope) => ({ name: scope.name, version: scope.version });

function numberPointJson(p: NumberPoint) {
  return {
    attributes: attrsJson(p.attributes),
    startTimeUnixNano: String(p.startNs),
    timeUnixNano: String(p.timeNs),
    asDouble: p.value,
  };
}

function metricJson(m: MetricData) {
  const base = { name: m.name, description: m.description, unit: m.unit };
  if (m.kind === 'gauge') return { ...base, gauge: { dataPoints: m.points.map(numberPointJson) } };
  if (m.kind === 'sum')
    return {
      ...base,
      sum: {
        dataPoints: m.points.map(numberPointJson),
        aggregationTemporality: m.temporality,
        isMonotonic: m.monotonic,
      },
    };
  return {
    ...base,
    histogram: {
      aggregationTemporality: m.temporality,
      dataPoints: m.points.map((p) => ({
        attributes: attrsJson(p.attributes),
        startTimeUnixNano: String(p.startNs),
        timeUnixNano: String(p.timeNs),
        count: String(p.count),
        sum: p.sum,
        bucketCounts: p.bucketCounts.map(String),
        explicitBounds: [...p.bounds],
        ...(p.min !== undefined && { min: p.min }),
        ...(p.max !== undefined && { max: p.max }),
      })),
    },
  };
}

export function metricsJson(batch: Batch<MetricData>): string {
  return JSON.stringify({
    resourceMetrics: [
      {
        resource: resourceJson(batch.resource),
        scopeMetrics: [{ scope: scopeJson(batch.scope), metrics: batch.items.map(metricJson) }],
      },
    ],
  });
}

export function tracesJson(batch: Batch<SpanData>): string {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: resourceJson(batch.resource),
        scopeSpans: [
          {
            scope: scopeJson(batch.scope),
            spans: batch.items.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              ...(s.parentSpanId && { parentSpanId: s.parentSpanId }),
              name: s.name,
              kind: s.kind,
              startTimeUnixNano: String(s.startNs),
              endTimeUnixNano: String(s.endNs),
              attributes: attrsJson(s.attributes),
              events: s.events.map((e) => ({
                timeUnixNano: String(e.timeNs),
                name: e.name,
                attributes: attrsJson(e.attributes),
              })),
              status: {
                code: s.status.code,
                ...(s.status.message && { message: s.status.message }),
              },
            })),
          },
        ],
      },
    ],
  });
}

export function logsJson(batch: Batch<LogData>): string {
  return JSON.stringify({
    resourceLogs: [
      {
        resource: resourceJson(batch.resource),
        scopeLogs: [
          {
            scope: scopeJson(batch.scope),
            logRecords: batch.items.map((l) => ({
              timeUnixNano: String(l.timeNs),
              observedTimeUnixNano: String(l.timeNs),
              severityNumber: l.severity,
              severityText: l.severity >= 17 ? 'ERROR' : l.severity >= 13 ? 'WARN' : 'INFO',
              body: { stringValue: l.body },
              attributes: attrsJson(l.attributes),
              eventName: l.eventName,
              ...(l.traceId && { traceId: l.traceId }),
              ...(l.spanId && { spanId: l.spanId }),
            })),
          },
        ],
      },
    ],
  });
}

// ── Protobuf ─────────────────────────────────────────────────────────────
// Field numbers from opentelemetry-proto v1.x.

function anyProto(w: ProtoWriter, value: AttrValue): void {
  if (typeof value === 'string') w.string(1, value);
  else if (typeof value === 'boolean') w.bool(2, value);
  else if (typeof value === 'number') {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) w.int64(3, value);
    else w.double(4, value);
  } else
    w.message(5, (array) => {
      for (const item of value) array.message(1, (any) => any.string(1, item));
    });
}

function attrsProto(w: ProtoWriter, field: number, attributes: Attributes): void {
  for (const [key, value] of Object.entries(attributes))
    w.message(field, (kv) => {
      kv.string(1, key);
      kv.message(2, (any) => anyProto(any, value));
    });
}

function resourceProto(w: ProtoWriter, resource: Attributes) {
  w.message(1, (r) => attrsProto(r, 1, resource));
}

function scopeProto(w: ProtoWriter, scope: Scope) {
  w.message(1, (s) => {
    s.string(1, scope.name);
    s.string(2, scope.version);
  });
}

function numberPointProto(w: ProtoWriter, field: number, p: NumberPoint) {
  w.message(field, (d) => {
    d.fixed64(2, p.startNs);
    d.fixed64(3, p.timeNs);
    d.double(4, p.value);
    attrsProto(d, 7, p.attributes);
  });
}

function metricProto(w: ProtoWriter, m: MetricData) {
  w.message(2, (metric) => {
    metric.string(1, m.name);
    metric.string(2, m.description);
    metric.string(3, m.unit);
    if (m.kind === 'gauge')
      metric.message(5, (g) => m.points.forEach((p) => numberPointProto(g, 1, p)));
    else if (m.kind === 'sum')
      metric.message(7, (s) => {
        m.points.forEach((p) => numberPointProto(s, 1, p));
        s.enumValue(2, m.temporality);
        s.bool(3, m.monotonic);
      });
    else
      metric.message(9, (h) => {
        for (const p of m.points)
          h.message(1, (d) => {
            d.fixed64(2, p.startNs);
            d.fixed64(3, p.timeNs);
            d.fixed64(4, BigInt(p.count));
            d.double(5, p.sum);
            d.packedFixed64(
              6,
              p.bucketCounts.map((c) => BigInt(c)),
            );
            d.packedDouble(7, p.bounds);
            attrsProto(d, 9, p.attributes);
            if (p.min !== undefined) d.double(11, p.min);
            if (p.max !== undefined) d.double(12, p.max);
          });
        h.enumValue(2, m.temporality);
      });
  });
}

export function metricsProto(batch: Batch<MetricData>): Uint8Array {
  const w = new ProtoWriter();
  w.message(1, (rm) => {
    resourceProto(rm, batch.resource);
    rm.message(2, (sm) => {
      scopeProto(sm, batch.scope);
      for (const m of batch.items) metricProto(sm, m);
    });
  });
  return w.finish();
}

export function tracesProto(batch: Batch<SpanData>): Uint8Array {
  const w = new ProtoWriter();
  w.message(1, (rs) => {
    resourceProto(rs, batch.resource);
    rs.message(2, (ss) => {
      scopeProto(ss, batch.scope);
      for (const s of batch.items)
        ss.message(2, (span) => {
          span.bytes(1, Buffer.from(s.traceId, 'hex'));
          span.bytes(2, Buffer.from(s.spanId, 'hex'));
          if (s.parentSpanId) span.bytes(4, Buffer.from(s.parentSpanId, 'hex'));
          span.string(5, s.name);
          span.enumValue(6, s.kind);
          span.fixed64(7, s.startNs);
          span.fixed64(8, s.endNs);
          attrsProto(span, 9, s.attributes);
          for (const e of s.events)
            span.message(11, (ev) => {
              ev.fixed64(1, e.timeNs);
              ev.string(2, e.name);
              attrsProto(ev, 3, e.attributes);
            });
          span.message(15, (st) => {
            if (s.status.message) st.string(2, s.status.message);
            st.enumValue(3, s.status.code);
          });
        });
    });
  });
  return w.finish();
}

export function logsProto(batch: Batch<LogData>): Uint8Array {
  const w = new ProtoWriter();
  w.message(1, (rl) => {
    resourceProto(rl, batch.resource);
    rl.message(2, (sl) => {
      scopeProto(sl, batch.scope);
      for (const l of batch.items)
        sl.message(2, (rec) => {
          rec.fixed64(1, l.timeNs);
          rec.enumValue(2, l.severity);
          rec.string(3, l.severity >= 17 ? 'ERROR' : l.severity >= 13 ? 'WARN' : 'INFO');
          rec.message(5, (body) => body.string(1, l.body));
          attrsProto(rec, 6, l.attributes);
          if (l.traceId) rec.bytes(9, Buffer.from(l.traceId, 'hex'));
          if (l.spanId) rec.bytes(10, Buffer.from(l.spanId, 'hex'));
          rec.fixed64(11, l.timeNs);
          rec.string(12, l.eventName);
        });
    });
  });
  return w.finish();
}

/**
 * How many items the service turned away, from its answer (`partialSuccess`):
 * `rejectedDataPoints`, `rejectedSpans` or `rejectedLogRecords`, in JSON or in
 * protobuf (field 1, a message whose field 1 is the count and 2 the reason).
 */
export function rejectedOf(
  body: Uint8Array,
  contentType: string | null,
): { rejected: number; message?: string } {
  if (!body.length) return { rejected: 0 };
  if (/json/i.test(contentType ?? '')) {
    try {
      const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as {
        partialSuccess?: Record<string, unknown>;
      };
      const ps = parsed.partialSuccess ?? {};
      const count = Number(ps.rejectedDataPoints ?? ps.rejectedSpans ?? ps.rejectedLogRecords ?? 0);
      const message = typeof ps.errorMessage === 'string' ? ps.errorMessage : undefined;
      return { rejected: Number.isFinite(count) ? count : 0, ...(message && { message }) };
    } catch {
      return { rejected: 0 };
    }
  }
  try {
    const outer = readFields(body).get(1);
    if (!(outer instanceof Uint8Array)) return { rejected: 0 };
    const inner = readFields(outer);
    const count = inner.get(1);
    const message = inner.get(2);
    return {
      rejected: typeof count === 'bigint' ? Number(count) : 0,
      ...(message instanceof Uint8Array &&
        message.length && { message: Buffer.from(message).toString('utf8') }),
    };
  } catch {
    return { rejected: 0 };
  }
}

/** Top-level fields of a protobuf message: varints as bigint, length-delimited as bytes. */
function readFields(buf: Uint8Array): Map<number, bigint | Uint8Array> {
  const out = new Map<number, bigint | Uint8Array>();
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error('truncated');
      const byte = buf[i++] ?? 0;
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
      if (shift > 63n) throw new Error('too long');
    }
  };
  while (i < buf.length) {
    const tag = Number(varint());
    const field = tag >> 3;
    const type = tag & 7;
    if (type === 0) out.set(field, varint());
    else if (type === 2) {
      const len = Number(varint());
      out.set(field, buf.subarray(i, i + len));
      i += len;
    } else if (type === 1) i += 8;
    else if (type === 5) i += 4;
    else throw new Error('unknown wire type');
  }
  return out;
}
