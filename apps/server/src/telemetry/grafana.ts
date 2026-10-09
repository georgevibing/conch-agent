/**
 * A Grafana dashboard for Conch (ADR 0121), made from the metric catalog, so
 * every panel asks for a metric that exists and by the name Prometheus has
 * for it — scraped from `/metrics` or translated from OTLP by Grafana Cloud,
 * Mimir or Prometheus's own OTLP receiver (the names are the same both ways).
 *
 * Settings → Dashboards offers it to copy or download; the same JSON is kept
 * in the repository (`docs/dashboards/conch-grafana.json`), and a test fails
 * when the two differ, so the file can't go stale.
 */
import { METRIC, prometheusName } from './catalog';

const prom = (name: string): string => {
  const def = METRIC.get(name);
  if (!def) throw new Error(`No metric called ${name} in the catalog.`);
  return prometheusName(def);
};

const DS = { type: 'prometheus', uid: '${datasource}' };

/** Only this Conch's series, when there's more than one. */
const SEL = 'job=~"$job"';

interface Panel {
  type: string;
  title: string;
  description?: string;
  gridPos: { x: number; y: number; w: number; h: number };
  [key: string]: unknown;
}

let id = 0;

function target(expr: string, legend: string, refId = 'A') {
  return { datasource: DS, expr, legendFormat: legend, refId, range: true };
}

function timeseries(
  title: string,
  description: string,
  at: Panel['gridPos'],
  targets: ReturnType<typeof target>[],
  unit = 'short',
  stack = false,
): Panel {
  return {
    id: ++id,
    type: 'timeseries',
    title,
    description,
    datasource: DS,
    gridPos: at,
    targets,
    fieldConfig: {
      defaults: {
        unit,
        custom: {
          drawStyle: 'line',
          lineWidth: 2,
          fillOpacity: stack ? 30 : 10,
          gradientMode: 'opacity',
          showPoints: 'never',
          stacking: { mode: stack ? 'normal' : 'none', group: 'A' },
        },
      },
      overrides: [],
    },
    options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
  };
}

function stat(
  title: string,
  description: string,
  at: Panel['gridPos'],
  expr: string,
  unit = 'short',
  thresholds?: { color: string; value: number | null }[],
): Panel {
  return {
    id: ++id,
    type: 'stat',
    title,
    description,
    datasource: DS,
    gridPos: at,
    targets: [target(expr, title)],
    fieldConfig: {
      defaults: {
        unit,
        decimals: unit === 'currencyUSD' ? 2 : undefined,
        thresholds: {
          mode: 'absolute',
          steps: thresholds ?? [{ color: 'text', value: null }],
        },
      },
      overrides: [],
    },
    options: { colorMode: 'value', graphMode: 'area', reduceOptions: { calcs: ['lastNotNull'] } },
  };
}

function gauge(title: string, description: string, at: Panel['gridPos'], expr: string): Panel {
  return {
    id: ++id,
    type: 'gauge',
    title,
    description,
    datasource: DS,
    gridPos: at,
    targets: [target(expr, title)],
    fieldConfig: {
      defaults: {
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'green', value: null },
            { color: 'orange', value: 0.8 },
            { color: 'red', value: 0.95 },
          ],
        },
      },
      overrides: [],
    },
    options: { showThresholdMarkers: true, reduceOptions: { calcs: ['lastNotNull'] } },
  };
}

function row(title: string, y: number): Panel {
  return {
    id: ++id,
    type: 'row',
    title,
    collapsed: false,
    gridPos: { x: 0, y, w: 24, h: 1 },
    panels: [],
  };
}

const rate = (metric: string, by: string, extra = '') =>
  `sum by (${by}) (rate(${prom(metric)}{${SEL}${extra}}[$__rate_interval]))`;

const quantile = (q: number, metric: string, by = '') =>
  `histogram_quantile(${q}, sum by (le${by ? `, ${by}` : ''}) (rate(${prom(metric)}_bucket{${SEL}}[$__rate_interval])))`;

/** The dashboard, as Grafana imports it (Dashboards → New → Import). */
export function grafanaDashboard(): Record<string, unknown> {
  id = 0;
  const turns = prom('conch.turns');
  const panels: Panel[] = [
    row('Turns', 0),
    stat(
      'Turns today',
      'Replies finished in the time range.',
      { x: 0, y: 1, w: 4, h: 4 },
      `sum(increase(${turns}{${SEL}}[$__range]))`,
    ),
    stat(
      'Spent',
      'Pay-as-you-go spending in the time range (plans not included: nobody pays their list price).',
      { x: 4, y: 1, w: 4, h: 4 },
      `sum(increase(${prom('conch.cost.usd')}{${SEL}, conch_billing="metered"}[$__range]))`,
      'currencyUSD',
    ),
    stat(
      'Working now',
      'Turns running right now.',
      { x: 8, y: 1, w: 4, h: 4 },
      `sum(${prom('conch.turns.active')}{${SEL}, conch_state="running"})`,
    ),
    stat(
      'Waiting for you',
      'Turns waiting for someone to answer a question.',
      { x: 12, y: 1, w: 4, h: 4 },
      `sum(${prom('conch.turns.active')}{${SEL}, conch_state="waiting"})`,
      'short',
      [
        { color: 'text', value: null },
        { color: 'orange', value: 1 },
      ],
    ),
    stat(
      'Failed turns',
      'Turns that ended in an error in the time range.',
      { x: 16, y: 1, w: 4, h: 4 },
      `sum(increase(${prom('conch.errors')}{${SEL}}[$__range]))`,
      'short',
      [
        { color: 'green', value: null },
        { color: 'red', value: 1 },
      ],
    ),
    stat(
      'Time to first word (p50)',
      'Half of replies started sooner than this.',
      { x: 20, y: 1, w: 4, h: 4 },
      quantile(0.5, 'conch.turn.time_to_first_token'),
      's',
    ),
    timeseries(
      'Turns by provider',
      'Replies finished per minute, by provider.',
      { x: 0, y: 5, w: 12, h: 8 },
      [target(`60 * ${rate('conch.turns', 'conch_provider')}`, '{{conch_provider}}')],
      'short',
      true,
    ),
    timeseries(
      'How long turns take',
      'From the message to the end of the reply: the median and the slowest 5 %.',
      { x: 12, y: 5, w: 12, h: 8 },
      [
        target(quantile(0.5, 'gen_ai.client.operation.duration'), 'p50', 'A'),
        target(quantile(0.95, 'gen_ai.client.operation.duration'), 'p95', 'B'),
        target(quantile(0.5, 'conch.turn.time_to_first_token'), 'first word p50', 'C'),
      ],
      's',
    ),
    timeseries(
      'Tokens by model',
      'Tokens per minute, by model and kind (input, output, read from and written to the cache).',
      { x: 0, y: 13, w: 12, h: 8 },
      [
        target(
          `60 * ${rate('conch.tokens', 'gen_ai_request_model, conch_token_type')}`,
          '{{gen_ai_request_model}} {{conch_token_type}}',
        ),
      ],
      'short',
      true,
    ),
    timeseries(
      'Spending',
      'US dollars per hour, by model. On a plan it’s what the work would cost at list price.',
      { x: 12, y: 13, w: 12, h: 8 },
      [
        target(
          `3600 * ${rate('conch.cost.usd', 'gen_ai_request_model, conch_billing')}`,
          '{{gen_ai_request_model}} ({{conch_billing}})',
        ),
      ],
      'currencyUSD',
      true,
    ),
    timeseries(
      'Where turns come from',
      'Chats, routines, tasks, chat apps, other apps and other agents.',
      { x: 0, y: 21, w: 12, h: 7 },
      [target(`60 * ${rate('conch.turns', 'conch_origin')}`, '{{conch_origin}}')],
      'short',
      true,
    ),
    timeseries(
      'Errors by kind',
      'Failed turns per minute, by why: a limit, signed out, unavailable…',
      { x: 12, y: 21, w: 12, h: 7 },
      [target(`60 * ${rate('conch.errors', 'error_type')}`, '{{error_type}}')],
      'short',
      true,
    ),
    row('Tools and approvals', 28),
    timeseries(
      'Tool calls',
      'Calls per minute by tool, the ten busiest.',
      { x: 0, y: 29, w: 12, h: 8 },
      [
        target(
          `topk(10, 60 * ${rate('conch.tool.calls', 'gen_ai_tool_name')})`,
          '{{gen_ai_tool_name}}',
        ),
      ],
      'short',
      true,
    ),
    timeseries(
      'Tool calls that didn’t work',
      'Errors, declined, expired and refused, per minute.',
      { x: 12, y: 29, w: 12, h: 8 },
      [
        target(
          `60 * ${rate('conch.tool.calls', 'conch_outcome', ', conch_outcome!="success"')}`,
          '{{conch_outcome}}',
        ),
      ],
      'short',
      true,
    ),
    timeseries(
      'Questions and answers',
      'How often the assistant stopped to ask, and how it was answered.',
      { x: 0, y: 37, w: 12, h: 7 },
      [
        target(
          `60 * sum(rate(${prom('conch.approvals.asked')}{${SEL}}[$__rate_interval]))`,
          'asked',
          'A',
        ),
        target(
          `60 * ${rate('conch.approvals.answered', 'conch_decision')}`,
          '{{conch_decision}}',
          'B',
        ),
      ],
    ),
    timeseries(
      'Auto',
      'Steps Auto judged: went ahead, or asked (and the risk that made it ask).',
      { x: 12, y: 37, w: 12, h: 7 },
      [
        target(
          `60 * ${rate('conch.auto.judgements', 'conch_verdict, conch_risk')}`,
          '{{conch_verdict}} {{conch_risk}}',
        ),
      ],
      'short',
      true,
    ),
    row('Work Conch does by itself', 44),
    timeseries(
      'Routine runs',
      'Runs that ended, per hour, by how.',
      { x: 0, y: 45, w: 8, h: 7 },
      [target(`3600 * ${rate('conch.routine.runs', 'conch_outcome')}`, '{{conch_outcome}}')],
      'short',
      true,
    ),
    timeseries(
      'Chat apps',
      'Messages per minute from each chat app (in) and replies sent back (out).',
      { x: 8, y: 45, w: 8, h: 7 },
      [
        target(
          `60 * ${rate('conch.channel.messages', 'conch_channel, conch_direction')}`,
          '{{conch_channel}} {{conch_direction}}',
        ),
      ],
    ),
    timeseries(
      'Fixed on its own',
      'Things Conch repaired by itself, per hour, by part.',
      { x: 16, y: 45, w: 8, h: 7 },
      [target(`3600 * ${rate('conch.repairs', 'conch_area')}`, '{{conch_area}}')],
      'short',
      true,
    ),
    {
      id: ++id,
      type: 'table',
      title: 'Providers',
      description: '1 when a provider is ready to answer.',
      datasource: DS,
      gridPos: { x: 0, y: 52, w: 8, h: 7 },
      targets: [
        {
          ...target(
            `max by (conch_provider) (${prom('conch.providers.ready')}{${SEL}})`,
            '{{conch_provider}}',
          ),
          format: 'table',
          instant: true,
          range: false,
        },
      ],
      transformations: [
        {
          id: 'organize',
          options: {
            excludeByName: { Time: true },
            renameByName: { conch_provider: 'Provider', Value: 'Ready' },
          },
        },
      ],
      fieldConfig: {
        defaults: {
          mappings: [
            {
              type: 'value',
              options: {
                '0': { text: 'Not ready', color: 'red' },
                '1': { text: 'Ready', color: 'green' },
              },
            },
          ],
          custom: { cellOptions: { type: 'color-text' } },
        },
        overrides: [],
      },
    },
    stat(
      'Memories',
      'Memories Conch keeps.',
      { x: 8, y: 52, w: 4, h: 7 },
      `max(${prom('conch.memories')}{${SEL}})`,
    ),
    stat(
      'Skills',
      'Skills Conch has.',
      { x: 12, y: 52, w: 4, h: 7 },
      `max(${prom('conch.skills')}{${SEL}})`,
    ),
    timeseries(
      'Health',
      'What Repair everything found the last time it looked.',
      { x: 16, y: 52, w: 8, h: 7 },
      [target(`sum by (conch_state) (${prom('conch.health.items')}{${SEL}})`, '{{conch_state}}')],
      'short',
      true,
    ),
    row('This computer', 59),
    gauge(
      'Processor',
      'How busy the processor is.',
      { x: 0, y: 60, w: 6, h: 6 },
      `max(${prom('system.cpu.utilization')}{${SEL}})`,
    ),
    gauge(
      'Memory',
      'How much memory is in use.',
      { x: 6, y: 60, w: 6, h: 6 },
      `max(${prom('system.memory.utilization')}{${SEL}})`,
    ),
    gauge(
      'Disk',
      'How full the disk Conch keeps its files on is.',
      { x: 12, y: 60, w: 6, h: 6 },
      `max(${prom('system.filesystem.utilization')}{${SEL}})`,
    ),
    stat(
      'Conch’s own memory',
      'Memory Conch’s process uses.',
      { x: 18, y: 60, w: 6, h: 6 },
      `max(${prom('process.memory.usage')}{${SEL}})`,
      'bytes',
    ),
    timeseries(
      'Responsiveness',
      'How long Conch’s own work waited at worst (p99). Above a tenth of a second it feels slow.',
      { x: 0, y: 66, w: 12, h: 7 },
      [target(`max(${prom('nodejs.eventloop.delay.p99')}{${SEL}})`, 'p99')],
      's',
    ),
    timeseries(
      'Sending',
      'What reached this dashboard, and what never did.',
      { x: 12, y: 66, w: 12, h: 7 },
      [
        target(
          `60 * ${rate('conch.telemetry.exports', 'conch_signal, conch_outcome')}`,
          '{{conch_signal}} {{conch_outcome}}',
          'A',
        ),
        target(
          `60 * ${rate('conch.telemetry.dropped', 'conch_signal, conch_reason')}`,
          'dropped {{conch_signal}} {{conch_reason}}',
          'B',
        ),
      ],
    ),
  ];
  return {
    __inputs: [
      {
        name: 'DS_PROMETHEUS',
        label: 'Prometheus',
        type: 'datasource',
        pluginId: 'prometheus',
        pluginName: 'Prometheus',
      },
    ],
    title: 'Conch',
    uid: 'conch-overview',
    description: 'Turns, tokens, spending, tools and approvals, and the computer Conch runs on.',
    tags: ['conch', 'gen_ai'],
    editable: true,
    graphTooltip: 1,
    schemaVersion: 39,
    version: 1,
    refresh: '30s',
    time: { from: 'now-24h', to: 'now' },
    timezone: 'browser',
    templating: {
      list: [
        {
          name: 'datasource',
          label: 'Prometheus',
          type: 'datasource',
          query: 'prometheus',
          current: {},
          hide: 0,
        },
        {
          name: 'job',
          label: 'Conch',
          type: 'query',
          datasource: DS,
          query: { query: `label_values(${turns}, job)`, refId: 'job' },
          definition: `label_values(${turns}, job)`,
          includeAll: true,
          allValue: '.*',
          multi: false,
          current: { text: 'All', value: '$__all' },
          refresh: 2,
          hide: 0,
        },
      ],
    },
    annotations: { list: [] },
    panels,
  };
}

/** The dashboard as the file in the repository holds it. */
export const grafanaJson = (): string => `${JSON.stringify(grafanaDashboard(), null, 2)}\n`;
