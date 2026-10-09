import protobuf from 'protobufjs';
import { describe, expect, it } from 'vitest';

import {
  CUMULATIVE,
  logsJson,
  logsProto,
  metricsJson,
  metricsProto,
  rejectedOf,
  SPAN_KIND,
  STATUS,
  tracesJson,
  tracesProto,
  type Batch,
  type LogData,
  type MetricData,
  type SpanData,
} from './otlp';
import { ProtoWriter } from './proto';

/**
 * The messages Conch sends, as opentelemetry-proto v1 defines them
 * (common, resource, metrics, trace, logs and their collector services):
 * field numbers and types copied from the `.proto` files, so a decoder
 * built from them reads what a collector reads.
 */
const OTLP_PROTO = `
syntax = "proto3";
package opentelemetry.proto;

message AnyValue {
  oneof value {
    string string_value = 1;
    bool bool_value = 2;
    int64 int_value = 3;
    double double_value = 4;
    ArrayValue array_value = 5;
    KeyValueList kvlist_value = 6;
    bytes bytes_value = 7;
  }
}
message ArrayValue { repeated AnyValue values = 1; }
message KeyValueList { repeated KeyValue values = 1; }
message KeyValue { string key = 1; AnyValue value = 2; }
message InstrumentationScope {
  string name = 1; string version = 2; repeated KeyValue attributes = 3; uint32 dropped_attributes_count = 4;
}
message Resource { repeated KeyValue attributes = 1; uint32 dropped_attributes_count = 2; }

message ExportMetricsServiceRequest { repeated ResourceMetrics resource_metrics = 1; }
message ResourceMetrics { Resource resource = 1; repeated ScopeMetrics scope_metrics = 2; string schema_url = 3; }
message ScopeMetrics { InstrumentationScope scope = 1; repeated Metric metrics = 2; string schema_url = 3; }
message Metric {
  string name = 1; string description = 2; string unit = 3;
  oneof data { Gauge gauge = 5; Sum sum = 7; Histogram histogram = 9; }
}
enum AggregationTemporality { AGGREGATION_TEMPORALITY_UNSPECIFIED = 0; AGGREGATION_TEMPORALITY_DELTA = 1; AGGREGATION_TEMPORALITY_CUMULATIVE = 2; }
message Gauge { repeated NumberDataPoint data_points = 1; }
message Sum { repeated NumberDataPoint data_points = 1; AggregationTemporality aggregation_temporality = 2; bool is_monotonic = 3; }
message Histogram { repeated HistogramDataPoint data_points = 1; AggregationTemporality aggregation_temporality = 2; }
message NumberDataPoint {
  repeated KeyValue attributes = 7; fixed64 start_time_unix_nano = 2; fixed64 time_unix_nano = 3;
  oneof value { double as_double = 4; sfixed64 as_int = 6; }
  uint32 flags = 8;
}
message HistogramDataPoint {
  repeated KeyValue attributes = 9; fixed64 start_time_unix_nano = 2; fixed64 time_unix_nano = 3;
  fixed64 count = 4; optional double sum = 5; repeated fixed64 bucket_counts = 6; repeated double explicit_bounds = 7;
  uint32 flags = 10; optional double min = 11; optional double max = 12;
}

message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
message ResourceSpans { Resource resource = 1; repeated ScopeSpans scope_spans = 2; string schema_url = 3; }
message ScopeSpans { InstrumentationScope scope = 1; repeated Span spans = 2; string schema_url = 3; }
message Span {
  bytes trace_id = 1; bytes span_id = 2; string trace_state = 3; bytes parent_span_id = 4; fixed32 flags = 16;
  string name = 5;
  enum SpanKind { SPAN_KIND_UNSPECIFIED = 0; SPAN_KIND_INTERNAL = 1; SPAN_KIND_SERVER = 2; SPAN_KIND_CLIENT = 3; SPAN_KIND_PRODUCER = 4; SPAN_KIND_CONSUMER = 5; }
  SpanKind kind = 6;
  fixed64 start_time_unix_nano = 7; fixed64 end_time_unix_nano = 8;
  repeated KeyValue attributes = 9; uint32 dropped_attributes_count = 10;
  message Event { fixed64 time_unix_nano = 1; string name = 2; repeated KeyValue attributes = 3; uint32 dropped_attributes_count = 4; }
  repeated Event events = 11; uint32 dropped_events_count = 12;
  Status status = 15;
}
message Status {
  string message = 2;
  enum StatusCode { STATUS_CODE_UNSET = 0; STATUS_CODE_OK = 1; STATUS_CODE_ERROR = 2; }
  StatusCode code = 3;
}

message ExportLogsServiceRequest { repeated ResourceLogs resource_logs = 1; }
message ResourceLogs { Resource resource = 1; repeated ScopeLogs scope_logs = 2; string schema_url = 3; }
message ScopeLogs { InstrumentationScope scope = 1; repeated LogRecord log_records = 2; string schema_url = 3; }
message LogRecord {
  fixed64 time_unix_nano = 1; fixed64 observed_time_unix_nano = 11; int32 severity_number = 2; string severity_text = 3;
  AnyValue body = 5; repeated KeyValue attributes = 6; uint32 dropped_attributes_count = 7; fixed32 flags = 8;
  bytes trace_id = 9; bytes span_id = 10; string event_name = 12;
}

message ExportPartialSuccess { int64 rejected_spans = 1; string error_message = 2; }
message ExportTraceServiceResponse { ExportPartialSuccess partial_success = 1; }
`;

const root = protobuf.parse(OTLP_PROTO, { keepCase: false }).root;
const type = (name: string) => root.lookupType(`opentelemetry.proto.${name}`);
const decode = (name: string, bytes: Uint8Array) =>
  type(name).toObject(type(name).decode(bytes), {
    longs: String,
    enums: Number,
    bytes: String,
    defaults: false,
    oneofs: false,
  }) as Record<string, unknown>;

const resource = { 'service.name': 'conch', 'service.version': '1.2.3', 'conch.port': 4317 };
const scope = { name: 'conch', version: '1' };

const metrics: Batch<MetricData> = {
  resource,
  scope,
  items: [
    {
      name: 'conch.turns',
      description: 'Replies',
      unit: '{turn}',
      kind: 'sum',
      monotonic: true,
      temporality: CUMULATIVE,
      points: [
        {
          attributes: { 'conch.provider': 'mock', 'conch.origin': 'chat' },
          startNs: 1_700_000_000_000_000_000n,
          timeNs: 1_700_000_060_000_000_000n,
          value: 3,
        },
      ],
    },
    {
      name: 'system.cpu.utilization',
      description: 'CPU',
      unit: '1',
      kind: 'gauge',
      points: [{ attributes: {}, startNs: 1n, timeNs: 2n, value: 0.25 }],
    },
    {
      name: 'gen_ai.client.operation.duration',
      description: 'Turns',
      unit: 's',
      kind: 'histogram',
      temporality: CUMULATIVE,
      points: [
        {
          attributes: { 'gen_ai.operation.name': 'invoke_agent' },
          startNs: 1n,
          timeNs: 2n,
          count: 4,
          sum: 7.5,
          min: 0.5,
          max: 4,
          bucketCounts: [1, 2, 1],
          bounds: [1, 2],
        },
      ],
    },
  ],
};

const span: SpanData = {
  traceId: '0af7651916cd43dd8448eb211c80319c',
  spanId: 'b7ad6b7169203331',
  parentSpanId: '00f067aa0ba902b7',
  name: 'execute_tool Bash',
  kind: SPAN_KIND.internal,
  startNs: 1_700_000_000_123_000_000n,
  endNs: 1_700_000_000_456_000_000n,
  attributes: {
    'gen_ai.tool.name': 'Bash',
    'gen_ai.usage.input_tokens': 120,
    'conch.cost.usd': 0.25,
    ok: true,
  },
  events: [{ timeNs: 1_700_000_000_200_000_000n, name: 'conch.approval.asked', attributes: {} }],
  status: { code: STATUS.error, message: 'tool_error' },
};

const log: LogData = {
  timeNs: 1_700_000_000_000_000_000n,
  severity: 9,
  body: 'A turn finished',
  eventName: 'conch.turn',
  attributes: { 'conch.outcome': 'success' },
  traceId: span.traceId,
  spanId: span.spanId,
};

describe('OTLP protobuf, read back with opentelemetry-proto', () => {
  it('writes metrics a collector decodes: sums, gauges, histograms, temporality', () => {
    const got = decode('ExportMetricsServiceRequest', metricsProto(metrics));
    const rm = (got.resourceMetrics as Record<string, unknown>[])[0] as Record<string, unknown>;
    const attrs = (rm.resource as { attributes: { key: string; value: Record<string, unknown> }[] })
      .attributes;
    expect(attrs).toContainEqual({ key: 'service.name', value: { stringValue: 'conch' } });
    expect(attrs).toContainEqual({ key: 'conch.port', value: { intValue: '4317' } });
    const sm = (rm.scopeMetrics as Record<string, unknown>[])[0] as {
      scope: unknown;
      metrics: Record<string, Record<string, unknown>>[];
    };
    expect(sm.scope).toEqual({ name: 'conch', version: '1' });
    const [turns, cpu, duration] = sm.metrics;
    expect(turns?.name).toBe('conch.turns');
    expect(turns?.sum).toMatchObject({ aggregationTemporality: 2, isMonotonic: true });
    expect((turns?.sum?.dataPoints as Record<string, unknown>[])[0]).toMatchObject({
      asDouble: 3,
      startTimeUnixNano: '1700000000000000000',
      timeUnixNano: '1700000060000000000',
    });
    expect(cpu?.gauge).toMatchObject({ dataPoints: [{ asDouble: 0.25 }] });
    expect(duration?.histogram).toMatchObject({
      aggregationTemporality: 2,
      dataPoints: [
        {
          count: '4',
          sum: 7.5,
          min: 0.5,
          max: 4,
          bucketCounts: ['1', '2', '1'],
          explicitBounds: [1, 2],
        },
      ],
    });
  });

  it('writes spans with ids as bytes, kinds, events and status', () => {
    const got = decode(
      'ExportTraceServiceRequest',
      tracesProto({ resource, scope, items: [span] }),
    );
    const s = (
      (
        (got.resourceSpans as Record<string, unknown>[])[0]?.scopeSpans as Record<string, unknown>[]
      )[0]?.spans as Record<string, unknown>[]
    )[0] as Record<string, unknown>;
    expect(Buffer.from(String(s.traceId), 'base64').toString('hex')).toBe(span.traceId);
    expect(Buffer.from(String(s.spanId), 'base64').toString('hex')).toBe(span.spanId);
    expect(Buffer.from(String(s.parentSpanId), 'base64').toString('hex')).toBe(span.parentSpanId);
    expect(s).toMatchObject({
      name: 'execute_tool Bash',
      kind: 1,
      startTimeUnixNano: '1700000000123000000',
      endTimeUnixNano: '1700000000456000000',
      status: { code: 2, message: 'tool_error' },
      events: [{ name: 'conch.approval.asked', timeUnixNano: '1700000000200000000' }],
    });
    expect(s.attributes).toEqual([
      { key: 'gen_ai.tool.name', value: { stringValue: 'Bash' } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: '120' } },
      { key: 'conch.cost.usd', value: { doubleValue: 0.25 } },
      { key: 'ok', value: { boolValue: true } },
    ]);
  });

  it('writes logs as events linked to their span', () => {
    const got = decode('ExportLogsServiceRequest', logsProto({ resource, scope, items: [log] }));
    const rec = (
      (
        (got.resourceLogs as Record<string, unknown>[])[0]?.scopeLogs as Record<string, unknown>[]
      )[0]?.logRecords as Record<string, unknown>[]
    )[0] as Record<string, unknown>;
    expect(rec).toMatchObject({
      severityNumber: 9,
      severityText: 'INFO',
      body: { stringValue: 'A turn finished' },
      eventName: 'conch.turn',
      timeUnixNano: '1700000000000000000',
    });
    expect(Buffer.from(String(rec.traceId), 'base64').toString('hex')).toBe(span.traceId);
  });
});

describe('OTLP JSON, as the specification maps it', () => {
  it('uses hex ids, numbers for enums and strings for 64-bit integers', () => {
    const json = JSON.parse(tracesJson({ resource, scope, items: [span] }));
    const s = json.resourceSpans[0].scopeSpans[0].spans[0];
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(s.kind).toBe(1);
    expect(s.status.code).toBe(2);
    expect(s.startTimeUnixNano).toBe('1700000000123000000');
    expect(s.attributes[1]).toEqual({
      key: 'gen_ai.usage.input_tokens',
      value: { intValue: '120' },
    });
  });

  it('decodes into the same messages the protobuf does', () => {
    const fromJson = type('ExportMetricsServiceRequest').fromObject(
      JSON.parse(metricsJson(metrics)),
    );
    const fromProto = type('ExportMetricsServiceRequest').decode(metricsProto(metrics));
    expect(type('ExportMetricsServiceRequest').toObject(fromJson, { longs: String })).toEqual(
      type('ExportMetricsServiceRequest').toObject(fromProto, { longs: String }),
    );
    const logs = JSON.parse(logsJson({ resource, scope, items: [log] }));
    expect(logs.resourceLogs[0].scopeLogs[0].logRecords[0]).toMatchObject({
      severityNumber: 9,
      eventName: 'conch.turn',
      timeUnixNano: '1700000000000000000',
    });
  });
});

describe('what a service turned away', () => {
  it('reads partialSuccess from a protobuf answer and a JSON one', () => {
    const answer = type('ExportTraceServiceResponse').encode({
      partialSuccess: { rejectedSpans: 3, errorMessage: 'too old' },
    });
    expect(rejectedOf(answer.finish(), 'application/x-protobuf')).toEqual({
      rejected: 3,
      message: 'too old',
    });
    expect(
      rejectedOf(
        Buffer.from('{"partialSuccess":{"rejectedDataPoints":"2","errorMessage":"no"}}'),
        'application/json',
      ),
    ).toEqual({ rejected: 2, message: 'no' });
    expect(rejectedOf(new Uint8Array(), 'application/x-protobuf')).toEqual({ rejected: 0 });
  });
});

describe('the protobuf writer', () => {
  it('writes varints, negative int64s and long messages the reference decoder reads', () => {
    const w = new ProtoWriter();
    w.message(1, (kv) => {
      kv.string(1, 'n');
      kv.message(2, (any) => any.int64(3, -5));
    });
    expect(
      type('KeyValueList').toObject(type('KeyValueList').decode(w.finish()), { longs: String }),
    ).toEqual({
      values: [{ key: 'n', value: { intValue: '-5' } }],
    });
    const big = new ProtoWriter();
    const text = 'x'.repeat(100_000);
    big.message(1, (kv) => kv.string(1, text));
    const read = type('KeyValueList').decode(big.finish()) as unknown as {
      values: { key: string }[];
    };
    expect(read.values[0]?.key).toHaveLength(100_000);
  });
});
