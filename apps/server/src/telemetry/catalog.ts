/**
 * Every number Conch sends to a dashboard (ADR 0119), in one table: what it's
 * called (OpenTelemetry's name, and Prometheus's, worked out the way
 * OpenTelemetry's compatibility spec says), what it counts, and the only
 * labels it may carry. The Prometheus page, the OTLP export, the preview on
 * Settings → Dashboards, the Grafana dashboard and the documentation's
 * metric reference all read this, so a metric exists once it has a row here.
 *
 * Names follow the OpenTelemetry GenAI conventions where they say something
 * (`gen_ai.client.token.usage`, `gen_ai.client.operation.duration`,
 * `gen_ai.execute_tool.duration`), the system and process conventions for
 * this computer, and `conch.*` for the rest.
 *
 * Labels are a closed list per metric, and each label is either one of a few
 * fixed words or a short name (a model, a tool, a provider) held to a bounded
 * number of values (`labels.ts`). Never a chat's id, never anyone's words.
 */

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export type MetricGroup =
  'Turns' | 'Tools and approvals' | 'Work Conch does by itself' | 'This computer' | 'Sending';

export interface MetricDef {
  /** OpenTelemetry's name. */
  name: string;
  kind: MetricKind;
  /**
   * UCUM, as OpenTelemetry writes it: `s`, `By`, `1`, `{token}`. Money is
   * `conch.cost.usd` in `{USD}`, so Prometheus names it the same whether it
   * scraped it or a collector translated it (`conch_cost_usd_total`).
   */
  unit: string;
  /** What it counts, for a person: the documentation and the preview read it. */
  description: string;
  /** The only labels it carries, by their OpenTelemetry names (`labels.ts` holds each one's rule). */
  labels: readonly string[];
  /** A histogram's bucket boundaries. */
  buckets?: readonly number[];
  group: MetricGroup;
}

/** GenAI conventions: `gen_ai.client.operation.duration`. */
export const DURATION_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92, 163.84,
  327.68,
] as const;

/** GenAI conventions: `gen_ai.client.token.usage`. */
export const TOKEN_BUCKETS = [
  1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864,
] as const;

/** Time to the first word: most land within seconds. */
const FIRST_TOKEN_BUCKETS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 20, 40] as const;

const TURN = ['conch.provider', 'gen_ai.request.model', 'conch.origin'] as const;

export const METRICS: readonly MetricDef[] = [
  // ── Turns ──────────────────────────────────────────────────────────────
  {
    name: 'conch.turns',
    kind: 'counter',
    unit: '{turn}',
    description:
      'Replies the assistant finished, by provider, model, agent, where the turn came from and how it ended.',
    labels: [...TURN, 'conch.agent', 'conch.outcome'],
    group: 'Turns',
  },
  {
    name: 'gen_ai.client.operation.duration',
    kind: 'histogram',
    unit: 's',
    description:
      'How long each turn took, from the message to the end of the reply (GenAI conventions, operation invoke_agent).',
    labels: ['gen_ai.operation.name', 'gen_ai.provider.name', 'error.type', ...TURN],
    buckets: DURATION_BUCKETS,
    group: 'Turns',
  },
  {
    name: 'gen_ai.client.token.usage',
    kind: 'histogram',
    unit: '{token}',
    description:
      'Tokens each turn read and wrote (GenAI conventions; gen_ai.token.type is input or output).',
    labels: ['gen_ai.operation.name', 'gen_ai.provider.name', 'gen_ai.token.type', ...TURN],
    buckets: TOKEN_BUCKETS,
    group: 'Turns',
  },
  {
    name: 'conch.tokens',
    kind: 'counter',
    unit: '{token}',
    description:
      'Tokens, added up: input, output, read from the provider’s cache and written to it.',
    labels: [...TURN, 'conch.token.type'],
    group: 'Turns',
  },
  {
    name: 'conch.cost.usd',
    kind: 'counter',
    unit: '{USD}',
    description:
      'What turns cost in US dollars. On a plan it’s what the work would cost at list price (billing="plan"), which nobody pays.',
    labels: [...TURN, 'conch.billing'],
    group: 'Turns',
  },
  {
    name: 'conch.turn.time_to_first_token',
    kind: 'histogram',
    unit: 's',
    description: 'How long until the first word of the reply arrived.',
    labels: TURN,
    buckets: FIRST_TOKEN_BUCKETS,
    group: 'Turns',
  },
  {
    name: 'conch.turns.active',
    kind: 'gauge',
    unit: '{turn}',
    description: 'Turns working right now, and those waiting for someone’s answer.',
    labels: ['conch.state'],
    group: 'Turns',
  },
  {
    name: 'conch.errors',
    kind: 'counter',
    unit: '{error}',
    description: 'Turns that failed, by why: a limit, signed out, unavailable, too long…',
    labels: ['conch.provider', 'error.type', 'conch.origin'],
    group: 'Turns',
  },

  // ── Tools and approvals ───────────────────────────────────────────────
  {
    name: 'conch.tool.calls',
    kind: 'counter',
    unit: '{call}',
    description:
      'Tool calls by tool and how they went: success, error, declined, expired or refused.',
    labels: ['gen_ai.tool.name', 'conch.outcome'],
    group: 'Tools and approvals',
  },
  {
    name: 'gen_ai.execute_tool.duration',
    kind: 'histogram',
    unit: 's',
    description: 'How long each tool call took (GenAI conventions).',
    labels: ['gen_ai.tool.name', 'gen_ai.tool.type', 'error.type'],
    buckets: DURATION_BUCKETS,
    group: 'Tools and approvals',
  },
  {
    name: 'conch.approvals.asked',
    kind: 'counter',
    unit: '{question}',
    description: 'Times the assistant stopped to ask before a step, by tool.',
    labels: ['gen_ai.tool.name'],
    group: 'Tools and approvals',
  },
  {
    name: 'conch.approvals.answered',
    kind: 'counter',
    unit: '{answer}',
    description:
      'How those questions were answered: allowed, always, denied, or nobody answered in time.',
    labels: ['gen_ai.tool.name', 'conch.decision'],
    group: 'Tools and approvals',
  },
  {
    name: 'conch.auto.judgements',
    kind: 'counter',
    unit: '{step}',
    description: 'Steps Auto judged: went ahead, or asked, and the kind of risk that made it ask.',
    labels: ['conch.verdict', 'conch.risk'],
    group: 'Tools and approvals',
  },

  // ── Work Conch does by itself ─────────────────────────────────────────
  {
    name: 'conch.routine.runs',
    kind: 'counter',
    unit: '{run}',
    description:
      'Routine runs that ended, by how (succeeded, nothing to do, failed, skipped, missed, stopped) and what started them.',
    labels: ['conch.outcome', 'conch.trigger'],
    group: 'Work Conch does by itself',
  },
  {
    name: 'conch.tasks',
    kind: 'counter',
    unit: '{task}',
    description: 'Background tasks and helpers that ended, by kind and how.',
    labels: ['conch.task.kind', 'conch.outcome'],
    group: 'Work Conch does by itself',
  },
  {
    name: 'conch.channel.messages',
    kind: 'counter',
    unit: '{message}',
    description: 'Messages from chat apps (in) and replies sent back (out), by app.',
    labels: ['conch.channel', 'conch.direction'],
    group: 'Work Conch does by itself',
  },
  {
    name: 'conch.repairs',
    kind: 'counter',
    unit: '{repair}',
    description: 'Things Conch fixed on its own, by the part of Conch.',
    labels: ['conch.area'],
    group: 'Work Conch does by itself',
  },
  {
    name: 'conch.health.items',
    kind: 'gauge',
    unit: '{item}',
    description: 'What Repair everything found the last time it looked, by state.',
    labels: ['conch.state'],
    group: 'Work Conch does by itself',
  },
  {
    name: 'conch.providers.ready',
    kind: 'gauge',
    unit: '{provider}',
    description: 'Each connected provider: 1 when it’s ready to answer, 0 when it isn’t.',
    labels: ['conch.provider'],
    group: 'Work Conch does by itself',
  },
  {
    name: 'conch.memories',
    kind: 'gauge',
    unit: '{memory}',
    description: 'Memories Conch keeps.',
    labels: [],
    group: 'Work Conch does by itself',
  },
  {
    name: 'conch.skills',
    kind: 'gauge',
    unit: '{skill}',
    description: 'Skills Conch has.',
    labels: [],
    group: 'Work Conch does by itself',
  },

  // ── This computer ─────────────────────────────────────────────────────
  {
    name: 'system.cpu.utilization',
    kind: 'gauge',
    unit: '1',
    description: 'How busy the processor is, 0 to 1.',
    labels: [],
    group: 'This computer',
  },
  {
    name: 'system.memory.utilization',
    kind: 'gauge',
    unit: '1',
    description: 'How much of the memory is in use, 0 to 1.',
    labels: [],
    group: 'This computer',
  },
  {
    name: 'system.filesystem.utilization',
    kind: 'gauge',
    unit: '1',
    description: 'How full the disk Conch keeps its files on is, 0 to 1.',
    labels: [],
    group: 'This computer',
  },
  {
    name: 'conch.computer.room',
    kind: 'gauge',
    unit: '{state}',
    description:
      'Whether the computer has room for more work, as Conch’s own admission sees it: 1 for the state it’s in.',
    labels: ['conch.state'],
    group: 'This computer',
  },
  {
    name: 'process.memory.usage',
    kind: 'gauge',
    unit: 'By',
    description: 'Memory Conch’s own process uses.',
    labels: [],
    group: 'This computer',
  },
  {
    name: 'nodejs.eventloop.delay.p99',
    kind: 'gauge',
    unit: 's',
    description:
      'How long Conch’s own work waited at worst (the 99th percentile): high means it feels slow.',
    labels: [],
    group: 'This computer',
  },
  {
    name: 'process.uptime',
    kind: 'gauge',
    unit: 's',
    description: 'How long Conch has been running.',
    labels: [],
    group: 'This computer',
  },

  // ── Sending ───────────────────────────────────────────────────────────
  {
    name: 'conch.telemetry.exports',
    kind: 'counter',
    unit: '{request}',
    description: 'Sends to your dashboard, by what was sent and whether it arrived.',
    labels: ['conch.signal', 'conch.outcome'],
    group: 'Sending',
  },
  {
    name: 'conch.telemetry.dropped',
    kind: 'counter',
    unit: '{item}',
    description:
      'Spans, events and numbers that never arrived, and why: the queue was full, the service refused them, or it stayed down.',
    labels: ['conch.signal', 'conch.reason'],
    group: 'Sending',
  },
];

export const METRIC = new Map(METRICS.map((m) => [m.name, m]));

/** UCUM units Prometheus spells out as a suffix (OpenTelemetry's compatibility spec). */
const UNIT_WORDS: Record<string, string> = {
  s: 'seconds',
  ms: 'milliseconds',
  By: 'bytes',
};

/** An OpenTelemetry name as Prometheus wants it: `[a-zA-Z_:][a-zA-Z0-9_:]*`. */
export function promSafe(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_:]/g, '_').replace(/_{2,}/g, '_');
  return /^[a-zA-Z_:]/.test(safe) ? safe : `_${safe}`;
}

/**
 * A metric's Prometheus family name: dots to underscores, the unit as a word
 * (annotations like `{token}` dropped, `1` as `ratio` for gauges), and
 * `_total` on counters — `gen_ai.client.operation.duration` →
 * `gen_ai_client_operation_duration_seconds`.
 */
export function prometheusName(def: Pick<MetricDef, 'name' | 'unit' | 'kind'>): string {
  let name = promSafe(def.name);
  const word = UNIT_WORDS[def.unit] ?? (def.unit === '1' && def.kind === 'gauge' ? 'ratio' : '');
  if (word && !name.endsWith(`_${word}`)) name = `${name}_${word}`;
  if (def.kind === 'counter' && !name.endsWith('_total')) name = `${name}_total`;
  return name;
}

/** A label's Prometheus name: `gen_ai.request.model` → `gen_ai_request_model`. */
export const prometheusLabel = (key: string): string => {
  const safe = key.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_{2,}/g, '_');
  return /^[a-zA-Z_]/.test(safe) ? safe : `_${safe}`;
};
