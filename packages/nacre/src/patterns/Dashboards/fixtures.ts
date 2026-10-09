import type { DashboardTile, MetricRow, SpanRow } from './Dashboards';

/** The destinations, as Settings → Dashboards shows them. */
export const tiles: DashboardTile[] = [
  {
    id: 'grafana-cloud',
    name: 'Grafana Cloud',
    tagline: 'Dashboards, alerts and traces',
    brand: 'grafana',
    color: '#F46800',
  },
  { id: 'honeycomb', name: 'Honeycomb', tagline: 'Traces you can ask anything', color: '#E79A12' },
  {
    id: 'datadog',
    name: 'Datadog',
    tagline: 'Metrics, traces and logs, agentless',
    brand: 'datadog',
    color: '#632CA6',
  },
  {
    id: 'new-relic',
    name: 'New Relic',
    tagline: 'Everything in one place',
    brand: 'newrelic',
    color: '#00AC69',
  },
  {
    id: 'langfuse',
    name: 'Langfuse',
    tagline: 'Every turn as a trace, for people who tune prompts',
    color: '#0A60D0',
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    tagline: 'Arize Phoenix: traces of every turn',
    color: '#7E3AF2',
  },
  {
    id: 'this-computer',
    name: 'On this computer',
    tagline: 'Grafana, a collector or Jaeger here',
    brand: 'opentelemetry',
    color: '#425CC7',
  },
  {
    id: 'custom',
    name: 'Another place',
    tagline: 'Any OpenTelemetry endpoint',
    brand: 'opentelemetry',
    color: '#4F5B66',
  },
];

export const metrics: MetricRow[] = [
  {
    name: 'conch.turns',
    prometheus: 'conch_turns_total',
    kind: 'counter',
    unit: '{turn}',
    description:
      'Replies the assistant finished, by provider, model, agent, where the turn came from and how it ended.',
    series: 4,
    samples: [
      {
        labels: {
          'conch.provider': 'claude-code',
          'gen_ai.request.model': 'claude-sonnet-4-5',
          'conch.origin': 'chat',
          'conch.agent': 'Juniper',
          'conch.outcome': 'success',
        },
        value: 42,
      },
      {
        labels: {
          'conch.provider': 'openai',
          'gen_ai.request.model': 'gpt-5',
          'conch.origin': 'routine',
          'conch.outcome': 'success',
        },
        value: 7,
      },
    ],
  },
  {
    name: 'gen_ai.client.operation.duration',
    prometheus: 'gen_ai_client_operation_duration_seconds',
    kind: 'histogram',
    unit: 's',
    description:
      'How long each turn took, from the message to the end of the reply (GenAI conventions, operation invoke_agent).',
    series: 2,
    samples: [
      {
        labels: {
          'gen_ai.operation.name': 'invoke_agent',
          'gen_ai.provider.name': 'anthropic',
          'conch.origin': 'chat',
        },
        value: 42,
      },
    ],
  },
  {
    name: 'conch.cost.usd',
    prometheus: 'conch_cost_usd_total',
    kind: 'counter',
    unit: '{USD}',
    description: 'What turns cost in US dollars.',
    series: 1,
    samples: [
      { labels: { 'gen_ai.request.model': 'gpt-5', 'conch.billing': 'metered' }, value: 0.4821 },
    ],
  },
  {
    name: 'conch.tool.calls',
    prometheus: 'conch_tool_calls_total',
    kind: 'counter',
    unit: '{call}',
    description:
      'Tool calls by tool and how they went: success, error, declined, expired or refused.',
    series: 12,
    samples: [
      { labels: { 'gen_ai.tool.name': 'Bash', 'conch.outcome': 'success' }, value: 118 },
      { labels: { 'gen_ai.tool.name': 'browser_click', 'conch.outcome': 'success' }, value: 34 },
      { labels: { 'gen_ai.tool.name': 'Bash', 'conch.outcome': 'declined' }, value: 2 },
    ],
  },
  {
    name: 'system.cpu.utilization',
    prometheus: 'system_cpu_utilization_ratio',
    kind: 'gauge',
    unit: '1',
    description: 'How busy the processor is, 0 to 1.',
    series: 1,
    samples: [{ labels: {}, value: 0.23 }],
  },
  {
    name: 'conch.routine.runs',
    prometheus: 'conch_routine_runs_total',
    kind: 'counter',
    unit: '{run}',
    description: 'Routine runs that ended, by how and what started them.',
    series: 0,
    samples: [],
  },
];

/** One turn: the agent, the model at work twice, a tool that asked first. */
export const spans: SpanRow[] = [
  {
    name: 'invoke_agent Juniper',
    kind: 'internal',
    depth: 0,
    startMs: 0,
    ms: 8420,
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.agent.name': 'Juniper',
      'gen_ai.request.model': 'claude-sonnet-4-5',
      'gen_ai.usage.input_tokens': 12840,
      'gen_ai.usage.output_tokens': 612,
      'gen_ai.conversation.id': '6f0c1a9e4b2d47d8a1f3c5e7b9d2a4c6',
      'conch.origin': 'chat',
    },
  },
  {
    name: 'chat claude-sonnet-4-5',
    kind: 'client',
    depth: 1,
    startMs: 0,
    ms: 2310,
    attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'claude-sonnet-4-5' },
  },
  {
    name: 'execute_tool Bash',
    kind: 'internal',
    depth: 1,
    startMs: 2310,
    ms: 3950,
    attributes: {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'Bash',
      'gen_ai.tool.type': 'function',
      'conch.outcome': 'success',
    },
  },
  {
    name: 'chat claude-sonnet-4-5',
    kind: 'client',
    depth: 1,
    startMs: 6260,
    ms: 2160,
    attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'claude-sonnet-4-5' },
  },
];
