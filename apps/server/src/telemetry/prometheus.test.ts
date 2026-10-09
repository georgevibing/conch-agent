import { describe, expect, it } from 'vitest';

import { LABEL_RULES } from './labels';
import { METRICS, prometheusName } from './catalog';
import { MAX_SERIES, Meter } from './meter';
import { promNumber, writePrometheus } from './prometheus';

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * A reader for the text exposition format, written from the spec: every
 * line is a comment (`# HELP` / `# TYPE`, once per family, before its
 * samples) or a sample `name{label="value",…} number`. It fails on anything
 * else, and returns the families it read.
 */
function parseExposition(text: string, open = false) {
  expect(text.endsWith('\n')).toBe(true);
  const families = new Map<
    string,
    {
      type?: string;
      help?: string;
      unit?: string;
      samples: { name: string; labels: Record<string, string>; value: number }[];
    }
  >();
  const done = new Set<string>();
  let current: string | undefined;
  const lines = text.slice(0, -1).split('\n');
  if (open) expect(lines.at(-1)).toBe('# EOF');
  for (const line of open ? lines.slice(0, -1) : lines) {
    const meta = /^# (HELP|TYPE|UNIT) (\S+) ?(.*)$/.exec(line);
    if (meta) {
      const [, kind, name = '', rest = ''] = meta;
      expect(name).toMatch(METRIC_NAME);
      if (current !== name) {
        expect(done.has(name), `${name} appears in two groups`).toBe(false);
        if (current) done.add(current);
        current = name;
      }
      const family = families.get(name) ?? { samples: [] };
      const key = kind === 'HELP' ? 'help' : kind === 'TYPE' ? 'type' : 'unit';
      expect(family[key], `${kind} twice for ${name}`).toBeUndefined();
      expect(family.samples, `${kind} after samples for ${name}`).toHaveLength(0);
      family[key] = rest;
      families.set(name, family);
      if (kind === 'TYPE')
        expect(['counter', 'gauge', 'histogram', 'summary', 'untyped', 'info']).toContain(rest);
      if (kind === 'HELP') expect(rest).not.toMatch(/(^|[^\\])\\[^\\n]/);
      continue;
    }
    expect(line.startsWith('#'), `stray comment: ${line}`).toBe(false);
    const sample = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})? (\S+)$/.exec(line);
    expect(sample, `not a sample: ${line}`).not.toBeNull();
    const [, name = '', , body = '', value = ''] = sample ?? [];
    const labels: Record<string, string> = {};
    const pair = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"(,|$)/gy;
    let read = 0;
    for (let m = pair.exec(body); m; m = pair.exec(body)) {
      const [, k = '', v = ''] = m;
      expect(k).toMatch(LABEL_NAME);
      expect(k.startsWith('__')).toBe(false);
      expect(v).not.toMatch(/(^|[^\\])\\[^\\"n]/);
      labels[k] = v.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      read = pair.lastIndex;
    }
    expect(read, `labels don't read: ${body}`).toBe(body.length);
    const family = [...families.keys()].find(
      (f) =>
        name === f ||
        (name.startsWith(f) &&
          /^_(bucket|sum|count|total|info|created)$/.test(name.slice(f.length))),
    );
    expect(family, `${name} has no TYPE before it`).toBe(current);
    const n = value === '+Inf' ? Infinity : value === '-Inf' ? -Infinity : Number(value);
    expect(Number.isNaN(n) && value !== 'NaN').toBe(false);
    families.get(family ?? '')?.samples.push({ name, labels, value: n });
  }
  return families;
}

function busyMeter() {
  const meter = new Meter({ now: () => 1_000 });
  meter.add('conch.turns', 2, {
    'conch.provider': 'claude-code',
    'gen_ai.request.model': 'claude-sonnet-4-5',
    'conch.origin': 'chat',
    'conch.agent': 'Juniper "the bold"',
    'conch.outcome': 'success',
  });
  meter.add('conch.cost.usd', 0.125, { 'conch.provider': 'openai', 'conch.billing': 'metered' });
  for (const s of [0.005, 0.3, 2, 2, 400])
    meter.record('gen_ai.client.operation.duration', s, {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': 'anthropic',
    });
  meter.set('system.cpu.utilization', 0.42);
  meter.set('conch.providers.ready', 1, { 'conch.provider': 'mock' });
  return meter;
}

describe('the Prometheus page', () => {
  it('is valid text exposition 0.0.4, every family typed and helped once', () => {
    const text = writePrometheus(busyMeter().snapshot(), {
      service_name: 'conch',
      service_version: '1.0.0',
    });
    const families = parseExposition(text);
    expect(families.get('target_info')?.samples[0]).toEqual({
      name: 'target_info',
      labels: { service_name: 'conch', service_version: '1.0.0' },
      value: 1,
    });
    expect(families.get('conch_turns_total')).toMatchObject({ type: 'counter' });
    expect(families.get('conch_turns_total')?.samples[0]?.labels).toMatchObject({
      conch_provider: 'claude-code',
      gen_ai_request_model: 'claude-sonnet-4-5',
      conch_agent: 'Juniper_the_bold_',
    });
    expect(families.get('conch_cost_usd_total')?.samples[0]?.value).toBe(0.125);
    expect(families.get('system_cpu_utilization_ratio')).toMatchObject({ type: 'gauge' });
  });

  it('writes histograms as cumulative buckets that end at +Inf, with sum and count', () => {
    const families = parseExposition(writePrometheus(busyMeter().snapshot(), {}));
    const h = families.get('gen_ai_client_operation_duration_seconds');
    expect(h?.type).toBe('histogram');
    const buckets = h?.samples.filter((s) => s.name.endsWith('_bucket')) ?? [];
    const les = buckets.map((b) => Number(b.labels.le === '+Inf' ? Infinity : b.labels.le));
    expect(les).toEqual([...les].sort((a, b) => a - b));
    expect(buckets.at(-1)?.labels.le).toBe('+Inf');
    const counts = buckets.map((b) => b.value);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(buckets.at(-1)?.value).toBe(5);
    expect(h?.samples.find((s) => s.name.endsWith('_count'))?.value).toBe(5);
    expect(h?.samples.find((s) => s.name.endsWith('_sum'))?.value).toBeCloseTo(404.305);
    // 0.005 is under the first bound (0.01); 400 is over the last.
    expect(buckets[0]?.value).toBe(1);
    expect(buckets.at(-2)?.value).toBe(4);
  });

  it('is valid OpenMetrics when asked: # EOF, counters named without _total, units', () => {
    const text = writePrometheus(
      busyMeter().snapshot(),
      { service_name: 'conch' },
      { openMetrics: true },
    );
    const families = parseExposition(text, true);
    expect(families.get('target')).toMatchObject({ type: 'info' });
    expect(families.get('conch_turns')?.type).toBe('counter');
    expect(families.get('conch_turns')?.samples[0]?.name).toBe('conch_turns_total');
    expect(families.get('gen_ai_client_operation_duration_seconds')?.unit).toBe('seconds');
    expect(text).toMatch(/_bucket\{.*le="1\.28"\} /);
    expect(text).toMatch(/le="327\.68"/);
    expect(text).toMatch(
      /gen_ai_client_operation_duration_seconds_bucket\{gen_ai_operation_name="invoke_agent",gen_ai_provider_name="anthropic",le="0\.01"\}/,
    );
  });

  it('escapes what label values could carry', () => {
    const meter = new Meter();
    meter.add('conch.tool.calls', 1, {
      'gen_ai.tool.name': 'mcp__a__b',
      'conch.outcome': 'success',
    });
    const text = writePrometheus(meter.snapshot(), { service_name: 'con"ch\\\nx' });
    expect(text).toContain('target_info{service_name="con\\"ch\\\\\\nx"} 1');
    parseExposition(text);
  });

  it('writes numbers as both formats read them', () => {
    expect([promNumber(1), promNumber(0.1 + 0.2), promNumber(Infinity), promNumber(NaN)]).toEqual([
      '1',
      '0.3',
      '+Inf',
      'NaN',
    ]);
  });
});

describe('the catalog', () => {
  it('names every metric once, and every label it may carry has a rule', () => {
    const names = METRICS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    const proms = METRICS.map((m) => prometheusName(m));
    expect(new Set(proms).size).toBe(proms.length);
    for (const m of METRICS) {
      expect(m.description.length, m.name).toBeGreaterThan(10);
      for (const label of m.labels) expect(LABEL_RULES[label], `${m.name}: ${label}`).toBeDefined();
      if (m.kind === 'histogram') expect(m.buckets?.length, m.name).toBeGreaterThan(3);
    }
  });

  it('names them as OpenTelemetry’s Prometheus compatibility does', () => {
    const name = (n: string) =>
      prometheusName(METRICS.find((m) => m.name === n) ?? (undefined as never));
    expect(name('gen_ai.client.operation.duration')).toBe(
      'gen_ai_client_operation_duration_seconds',
    );
    expect(name('gen_ai.client.token.usage')).toBe('gen_ai_client_token_usage');
    expect(name('conch.turns')).toBe('conch_turns_total');
    expect(name('conch.cost.usd')).toBe('conch_cost_usd_total');
    expect(name('system.memory.utilization')).toBe('system_memory_utilization_ratio');
    expect(name('process.memory.usage')).toBe('process_memory_usage_bytes');
    expect(name('nodejs.eventloop.delay.p99')).toBe('nodejs_eventloop_delay_p99_seconds');
  });

  it('uses the GenAI conventions’ names where they say something', () => {
    const genai = METRICS.filter((m) => m.name.startsWith('gen_ai.'));
    expect(genai.map((m) => m.name).sort()).toEqual([
      'gen_ai.client.operation.duration',
      'gen_ai.client.token.usage',
      'gen_ai.execute_tool.duration',
    ]);
    const duration = METRICS.find((m) => m.name === 'gen_ai.client.operation.duration');
    expect(duration?.unit).toBe('s');
    expect(duration?.labels).toEqual(
      expect.arrayContaining(['gen_ai.operation.name', 'gen_ai.provider.name', 'error.type']),
    );
    expect(METRICS.find((m) => m.name === 'gen_ai.client.token.usage')?.labels).toContain(
      'gen_ai.token.type',
    );
  });
});

describe('cardinality', () => {
  it('folds a metric past its limit into one overflow series', () => {
    const meter = new Meter();
    const outcomes = ['success', 'error', 'declined', 'expired', 'refused'];
    for (let i = 0; i < 200; i++)
      for (const outcome of outcomes)
        meter.add('conch.tool.calls', 1, {
          'gen_ai.tool.name': `tool_${i}`,
          'conch.outcome': outcome,
        });
    const series = meter.snapshot().find((m) => m.def.name === 'conch.tool.calls')?.series ?? [];
    expect(series.length).toBeLessThanOrEqual(MAX_SERIES + 1);
    expect(series.some((s) => s.labels['otel.metric.overflow'] === 'true')).toBe(true);
  });

  it('holds a name label to its few values, and a word to its list', () => {
    const meter = new Meter();
    for (let i = 0; i < 200; i++)
      meter.add('conch.turns', 1, {
        'gen_ai.request.model': `model-${i}`,
        'conch.outcome': 'success',
      });
    meter.add('conch.turns', 1, { 'conch.outcome': 'Ada wrote this' });
    const models = new Set(
      meter
        .snapshot()
        .find((m) => m.def.name === 'conch.turns')
        ?.series.map((s) => s.labels['gen_ai.request.model']),
    );
    expect(models.size).toBeLessThanOrEqual(98);
    expect(models.has('_other')).toBe(true);
    const outcomes = meter
      .snapshot()
      .find((m) => m.def.name === 'conch.turns')
      ?.series.map((s) => s.labels['conch.outcome']);
    expect(outcomes).toContain('_OTHER');
    expect(outcomes).not.toContain('Ada wrote this');
  });

  it('drops labels a metric doesn’t declare, like a chat’s id', () => {
    const meter = new Meter();
    meter.add('conch.turns', 1, {
      'conch.outcome': 'success',
      'gen_ai.conversation.id': 'c_123',
      chat: 'c_123',
    });
    const labels = meter.snapshot()[0]?.series[0]?.labels;
    expect(labels).toEqual({ 'conch.outcome': 'success' });
  });
});
