import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { ConversationEvent, ServerEvent } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Redaction } from '../trajectory/redact';
import { TelemetryService } from './service';

let home: string;
let bodies: { url: string; headers: Record<string, string>; text: string }[];
let answer: () => Promise<Response>;

const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  bodies.push({
    url: String(url),
    headers: init?.headers as Record<string, string>,
    // Protobuf keeps strings as UTF-8 bytes, so a search of the bytes finds any text in it.
    text: gunzipSync(Buffer.from(init?.body as Uint8Array)).toString('latin1'),
  });
  return answer();
}) as typeof globalThis.fetch;

function service(options: { redact?: (text: string) => string } = {}) {
  return new TelemetryService({
    home,
    version: '9.9.9',
    manual: true,
    send: { fetch, sleep: async () => undefined, random: () => 0.5, attempts: 2 },
    ...(options.redact && { redact: () => options.redact as (t: string) => string }),
    gauges: {
      resources: async () => ({ level: 'healthy', availableBytes: 6e9, totalBytes: 8e9 }),
      disk: async () => ({ usedBytes: 50, totalBytes: 100 }),
      memories: async () => 12,
      skills: async () => 3,
      providers: async () => [{ id: 'claude-code', ready: true }],
    },
  });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-telemetry-'));
  bodies = [];
  answer = async () => new Response(new Uint8Array(), { status: 200 });
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const CHAT = 'c_privacy_chat_0001';
/** Everything private a turn can carry: none of it may leave by default. */
const PRIVATE = [
  'Please email',
  'ada@example.com',
  'secret-plans',
  '/Users/ada',
  'TOP SECRET contents',
  // A fake key, written in two parts so no scanner takes it for a real one.
  'sk-' + 'ant-api03',
  'Sure, sending',
  'quarterly board memo',
  CHAT,
];
const KEY = `${'sk-' + 'ant'}-api03-${'A1b2C3d4E5'.repeat(4)}`;

/** One turn, the way the conversation log says it: a question, a step that asked, a reply. */
function turnEvents(): ServerEvent[] {
  let seq = 0;
  const at = 1_760_000_000_000;
  const e = (event: Record<string, unknown>, offset: number): ServerEvent => ({
    type: 'conversation.event',
    event: { conversationId: CHAT, seq: seq++, at: at + offset, ...event } as ConversationEvent,
  });
  return [
    {
      type: 'agents.changed',
      list: {
        agents: [{ id: 'ag_juniper', name: 'Juniper' }] as never,
        defaultId: 'ag_juniper',
      },
    },
    {
      type: 'conversation.updated',
      conversation: {
        id: CHAT,
        title: 'quarterly board memo',
        preview: 'Please email',
        createdAt: at,
        updatedAt: at,
        status: 'running',
        options: {},
        agentId: 'ag_juniper' as never,
      },
    },
    e(
      {
        type: 'user.message',
        messageId: 'm1',
        text: `Please email ada@example.com the quarterly board memo at /Users/ada/secret-plans.txt. My key is ${KEY}`,
      },
      0,
    ),
    e({ type: 'status', status: 'running' }, 5),
    e({ type: 'assistant.delta', messageId: 'a1', kind: 'thinking', delta: 'hmm' }, 300),
    e(
      {
        type: 'assistant.delta',
        messageId: 'a1',
        kind: 'text',
        delta: 'Sure, sending to ada@example.com',
      },
      900,
    ),
    e(
      {
        type: 'tool.started',
        toolUseId: 'tu_1',
        name: 'Bash',
        input: { command: 'cat /Users/ada/secret-plans.txt' },
      },
      1200,
    ),
    e(
      {
        type: 'permission.requested',
        permissionId: 'p1',
        toolUseId: 'tu_1',
        toolName: 'Bash',
        input: { command: 'cat /Users/ada/secret-plans.txt' },
        summary: 'Read /Users/ada/secret-plans.txt',
      },
      1250,
    ),
    e({ type: 'permission.resolved', permissionId: 'p1', decision: 'allow' }, 2000),
    e(
      {
        type: 'tool.finished',
        toolUseId: 'tu_1',
        status: 'success',
        output: 'TOP SECRET contents',
        durationMs: 700,
      },
      2700,
    ),
    e(
      { type: 'assistant.delta', messageId: 'a2', kind: 'text', delta: ' done, ada@example.com' },
      3000,
    ),
    e({ type: 'assistant.done', messageId: 'a2' }, 3100),
    e(
      {
        type: 'turn.completed',
        outcome: 'success',
        engine: 'claude-code',
        model: 'claude-sonnet-4-5',
        usage: {
          inputTokens: 1200,
          outputTokens: 300,
          cachedInputTokens: 800,
          cacheWriteTokens: 100,
        },
        cost: { billing: 'metered', usd: 0.0123 },
      },
      4000,
    ),
  ];
}

async function sendEverything(t: TelemetryService) {
  for (const event of turnEvents()) t.observe(event);
  t.auto('went_ahead');
  t.auto('asked', 'exfiltration');
  await t.tick();
  await t.sendMetrics();
}

describe('what leaves by default', () => {
  it('carries no words, no file names, no addresses, no keys and no chat ids, in any format', async () => {
    for (const encoding of ['json', 'protobuf'] as const) {
      bodies = [];
      const t = service();
      await t.update({
        otlp: {
          on: true,
          destination: 'custom',
          endpoint: 'https://collector.example',
          encoding,
          signals: { metrics: true, traces: true, logs: true },
        },
      });
      await sendEverything(t);
      const scrape = await t.update({ prometheus: { on: true } }).then(() => t.prometheus());
      const preview = JSON.stringify(await t.preview());
      const sent = bodies.map((b) => b.text).join('\n');
      expect(bodies.map((b) => b.url).sort()).toEqual([
        'https://collector.example/v1/logs',
        'https://collector.example/v1/metrics',
        'https://collector.example/v1/traces',
      ]);
      for (const text of [sent, scrape.body, preview])
        for (const secret of PRIVATE) expect(text, `${encoding}: ${secret}`).not.toContain(secret);
      // What does leave: the shape of the work.
      expect(sent).toContain('invoke_agent Juniper');
      expect(sent).toContain('execute_tool Bash');
      expect(scrape.body).toContain(
        'conch_turns_total{conch_provider="claude-code",gen_ai_request_model="claude-sonnet-4-5",conch_origin="chat",conch_agent="Juniper",conch_outcome="success"} 1',
      );
      await t.stop(10);
    }
  });

  it('with the words turned on, sends them only redacted, and only in traces', async () => {
    const t = service({ redact: (text) => new Redaction({ home: '/Users/ada' }).text(text) });
    await t.update({
      content: true,
      otlp: {
        on: true,
        destination: 'custom',
        endpoint: 'https://collector.example',
        encoding: 'json',
        signals: { metrics: true, traces: true, logs: true },
      },
    });
    await sendEverything(t);
    const traces = bodies.find((b) => b.url.endsWith('/v1/traces'))?.text ?? '';
    const others = bodies
      .filter((b) => !b.url.endsWith('/v1/traces'))
      .map((b) => b.text)
      .join('\n');
    expect(traces).toContain('Please email');
    expect(traces).toContain('gen_ai.input.messages');
    expect(traces).toContain('gen_ai.tool.call.result');
    expect(traces).not.toContain('ada@example.com');
    expect(traces).not.toContain(KEY);
    expect(traces).not.toContain('/Users/ada');
    for (const secret of PRIVATE) expect(others).not.toContain(secret);
    await t.stop(10);
  });
});

describe('a turn as a trace', () => {
  it('is invoke_agent over chat and execute_tool spans, in the GenAI conventions’ names', async () => {
    const t = service();
    await t.update({
      otlp: {
        on: true,
        destination: 'custom',
        endpoint: 'https://collector.example',
        encoding: 'json',
      },
    });
    await sendEverything(t);
    const body = JSON.parse(bodies.find((b) => b.url.endsWith('/v1/traces'))?.text ?? '{}');
    const spans = body.resourceSpans[0].scopeSpans[0].spans as {
      name: string;
      kind: number;
      spanId: string;
      parentSpanId?: string;
      traceId: string;
      attributes: { key: string; value: Record<string, unknown> }[];
      events: { name: string }[];
    }[];
    const attrs = (s: (typeof spans)[number]) =>
      Object.fromEntries(s.attributes.map((a) => [a.key, Object.values(a.value)[0]]));
    const [root, ...children] = spans;
    expect(root?.name).toBe('invoke_agent Juniper');
    expect(attrs(root ?? (undefined as never))).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.agent.name': 'Juniper',
      'gen_ai.request.model': 'claude-sonnet-4-5',
      'gen_ai.usage.input_tokens': '1200',
      'gen_ai.usage.output_tokens': '300',
      'gen_ai.usage.cache_read.input_tokens': '800',
      'gen_ai.usage.cache_write.input_tokens': '100',
      'conch.origin': 'chat',
    });
    expect(String(attrs(root ?? (undefined as never))['gen_ai.conversation.id'])).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(children.map((s) => s.name)).toEqual([
      'chat claude-sonnet-4-5',
      'chat claude-sonnet-4-5',
      'execute_tool Bash',
    ]);
    for (const child of children) {
      expect(child.parentSpanId).toBe(root?.spanId);
      expect(child.traceId).toBe(root?.traceId);
    }
    expect(children[0]?.kind).toBe(3);
    const tool = children[2];
    expect(attrs(tool ?? (undefined as never))).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'Bash',
      'gen_ai.tool.type': 'function',
      'gen_ai.tool.call.id': 'tu_1',
    });
    expect(tool?.events.map((e) => e.name)).toEqual([
      'conch.approval.asked',
      'conch.approval.answered',
    ]);
    await t.stop(10);
  });

  it('counts the turn: tokens, cost, time to the first word, tools, questions, Auto', async () => {
    const t = service();
    await sendEverything(t);
    const page = (await t.update({ prometheus: { on: true } }).then(() => t.prometheus())).body;
    expect(page).toMatch(/conch_tokens_total\{[^}]*conch_token_type="cache_read"\} 800/);
    expect(page).toMatch(/conch_cost_usd_total\{[^}]*conch_billing="metered"\} 0\.0123/);
    expect(page).toMatch(/conch_turn_time_to_first_token_seconds_bucket\{[^}]*le="1"\} 1/);
    expect(page).toMatch(/conch_turn_time_to_first_token_seconds_bucket\{[^}]*le="0\.75"\} 0/);
    expect(page).toMatch(/gen_ai_client_operation_duration_seconds_sum\{[^}]*\} 4/);
    expect(page).toMatch(
      /gen_ai_client_token_usage_sum\{[^}]*gen_ai_token_type="input"[^}]*\} 1200/,
    );
    expect(page).toContain(
      'conch_tool_calls_total{gen_ai_tool_name="Bash",conch_outcome="success"} 1',
    );
    expect(page).toMatch(
      /gen_ai_execute_tool_duration_seconds_sum\{gen_ai_tool_name="Bash",gen_ai_tool_type="function"\} 0\.7/,
    );
    expect(page).toContain('conch_approvals_asked_total{gen_ai_tool_name="Bash"} 1');
    expect(page).toContain(
      'conch_approvals_answered_total{gen_ai_tool_name="Bash",conch_decision="allowed"} 1',
    );
    expect(page).toContain(
      'conch_auto_judgements_total{conch_verdict="asked",conch_risk="exfiltration"} 1',
    );
    expect(page).toContain('conch_memories 12');
    expect(page).toContain('conch_providers_ready{conch_provider="claude-code"} 1');
    expect(page).toContain('system_filesystem_utilization_ratio 0.5');
    await t.stop(10);
  });
});

describe('a destination that fails', () => {
  it('never slows a turn: events go in at once while the endpoint hangs', async () => {
    let hung = 0;
    answer = () => {
      hung++;
      return new Promise<Response>(() => undefined);
    };
    const t = service();
    await t.update({
      otlp: {
        on: true,
        destination: 'custom',
        endpoint: 'https://collector.example',
        encoding: 'json',
        signals: { metrics: true, traces: true, logs: true },
      },
    });
    const metrics = t.sendMetrics();
    const events = turnEvents();
    const started = performance.now();
    for (let i = 0; i < 300; i++)
      for (const event of events)
        t.observe(
          event.type === 'conversation.event'
            ? { ...event, event: { ...event.event, conversationId: `${CHAT}${i}` } }
            : event,
        );
    const took = performance.now() - started;
    expect(took).toBeLessThan(1000);
    void t.tick();
    await vi.waitFor(() => expect(hung).toBeGreaterThanOrEqual(2));
    // It still answers about itself, and the queue never grows past its bound.
    const status = await t.status();
    expect(status.otlp.queued).toBeLessThanOrEqual(4096);
    void metrics;
    await t.stop(10);
  });

  it('counts what never arrived, says why in a sentence, and Repair says it too', async () => {
    answer = async () => new Response('nope', { status: 401 });
    const t = service();
    await t.update({
      otlp: {
        on: true,
        destination: 'honeycomb',
        signals: { metrics: true, traces: true, logs: false },
      },
      key: { key: 'hcaik_' + '0'.repeat(30) },
    });
    await sendEverything(t);
    const status = await t.status();
    expect(status.otlp.problem).toMatchObject({ yours: true, status: 401 });
    expect(status.otlp.problem?.message).toBe(
      'Honeycomb didn’t take the key. Paste it again, or make a new one.',
    );
    expect(status.otlp.dropped).toBeGreaterThan(0);
    const [item] = await t
      .doctorCheck()
      .run({ repair: false, signal: new AbortController().signal });
    expect(item).toMatchObject({
      state: 'needs-you',
      action: { kind: 'open', place: 'dashboards' },
    });
    const page = (await t.update({ prometheus: { on: true } }).then(() => t.prometheus())).body;
    expect(page).toMatch(
      /conch_telemetry_dropped_total\{conch_signal="traces",conch_reason="rejected"\} 4/,
    );
    await t.stop(10);
  });

  it('Repair tries again when it passes by itself, and says it’s fixed', async () => {
    let down = true;
    answer = async () => new Response('', { status: down ? 503 : 200 });
    const t = service();
    await t.update({
      otlp: { on: true, destination: 'custom', endpoint: 'https://collector.example' },
    });
    await t.sendMetrics();
    const look = await t.doctorCheck().run({ repair: false, signal: new AbortController().signal });
    expect(look[0]).toMatchObject({ state: 'warning', repairable: true });
    down = false;
    const fixed = await t.doctorCheck().run({ repair: true, signal: new AbortController().signal });
    expect(fixed[0]).toMatchObject({ state: 'fixed' });
    await t.stop(10);
  });

  it('sends Datadog differences, never totals twice', async () => {
    const t = service();
    await t.update({
      otlp: { on: true, destination: 'datadog', region: 'datadoghq.eu', encoding: 'json' },
      key: { key: 'a'.repeat(32) },
    });
    const turnsIn = (text: string) => {
      const body = JSON.parse(text) as {
        resourceMetrics: {
          scopeMetrics: {
            metrics: {
              name: string;
              sum?: { aggregationTemporality: number; dataPoints: { asDouble: number }[] };
            }[];
          }[];
        }[];
      };
      const m = body.resourceMetrics[0]?.scopeMetrics[0]?.metrics.find(
        (x) => x.name === 'conch.turns',
      );
      return {
        temporality: m?.sum?.aggregationTemporality,
        value: m?.sum?.dataPoints[0]?.asDouble,
      };
    };
    for (const event of turnEvents()) t.observe(event);
    await t.sendMetrics();
    for (const event of turnEvents()) t.observe(event);
    await t.sendMetrics();
    const sent = bodies.filter((b) => b.url === 'https://otlp.datadoghq.eu/v1/metrics');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.headers['dd-api-key']).toBe('a'.repeat(32));
    expect(turnsIn(sent[0]?.text ?? '')).toEqual({ temporality: 1, value: 1 });
    // The second carries only the second turn: one more, not two.
    expect(turnsIn(sent[1]?.text ?? '')).toEqual({ temporality: 1, value: 1 });
    await t.stop(10);
  });

  it('keeps differences that didn’t arrive for the next send', async () => {
    let down = true;
    answer = async () => new Response('', { status: down ? 503 : 200 });
    const t = service();
    await t.update({
      otlp: { on: true, destination: 'new-relic', encoding: 'json' },
      key: { key: `${'b'.repeat(36)}NRAL` },
    });
    for (const event of turnEvents()) t.observe(event);
    await t.sendMetrics();
    down = false;
    for (const event of turnEvents()) t.observe(event);
    bodies = [];
    await t.sendMetrics();
    const body = JSON.parse(bodies[0]?.text ?? '{}');
    const turns = body.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (m: { name: string }) => m.name === 'conch.turns',
    );
    expect(turns.sum.dataPoints[0].asDouble).toBe(2);
    await t.stop(10);
  });
});

describe('the test button', () => {
  it('sends a real span and the numbers, and says the destination received it', async () => {
    const t = service();
    await t.update({
      otlp: {
        on: true,
        destination: 'grafana-cloud',
        endpoint: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
      },
      key: { instance: '123456', token: 'glc_' + 'x'.repeat(40) },
    });
    bodies = [];
    const result = await t.test();
    expect(result).toMatchObject({ ok: true, message: 'Grafana Cloud received it.' });
    expect(bodies.map((b) => b.url).sort()).toEqual([
      'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp/v1/metrics',
      'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp/v1/traces',
    ]);
    expect(bodies[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from(`123456:glc_${'x'.repeat(40)}`).toString('base64')}`,
    );
    expect(bodies.find((b) => b.url.endsWith('/traces'))?.text).toContain('conch.dashboards.test');
    await t.stop(10);
  });

  it('says exactly what’s missing, or what the service said', async () => {
    const t = service();
    await t.update({
      otlp: { on: true, destination: 'langfuse' },
      key: { public: 'pk-lf-1234567890' },
    });
    expect(await t.test()).toMatchObject({
      ok: false,
      message: 'Paste your Langfuse secret key (sk-lf-…).',
    });
    await t.update({ key: { secret: 'sk-lf-1234567890' } });
    answer = async () => new Response('', { status: 404 });
    expect(await t.test()).toMatchObject({
      ok: false,
      message: 'Langfuse has nothing at that address. Check the endpoint.',
    });
    await t.stop(10);
  });
});
