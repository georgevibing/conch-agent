/**
 * A chart in the chat, for every model (ADR 0105): the model hands over the
 * numbers and says what kind of picture they are, and the card draws it live —
 * readable with a pointer or the arrow keys, with a table of the same numbers
 * under it and a share bar to take it away as an image.
 *
 * Nothing leaves this computer and nothing is fetched: the data is what the
 * model already had (from the chat, a file it read, a tool it called). It is
 * checked hard all the same — only finite numbers and plain words get through,
 * capped at eight series of four hundred points — and every string the card
 * keeps is drawn as text, never markup.
 */
import { CHART_POINTS_MAX, CHART_SCATTER_SERIES_MAX, CHART_SERIES_MAX } from '@conch/protocol';
import type { ChartKind, ChartView } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool, HostToolResult } from '../engines/types';
import { formatValue } from '../files/make/chartScale';

/** The forms Conch draws well. */
const KINDS = ['bar', 'column', 'line', 'area', 'pie', 'donut', 'scatter'] as const;

/**
 * Other names for a form we do draw. A stacked bar isn't a different chart,
 * it's a bar chart that stacks, so asking for one gets one.
 */
const SAME_THING: Record<string, { type: ChartKind; stacked?: boolean; horizontal?: boolean }> = {
  stackedbar: { type: 'column', stacked: true },
  stackedcolumn: { type: 'column', stacked: true },
  stackedarea: { type: 'area', stacked: true },
  groupedbar: { type: 'column' },
  groupedcolumn: { type: 'column' },
  clusteredbar: { type: 'column' },
  verticalbar: { type: 'column' },
  columnchart: { type: 'column' },
  col: { type: 'column' },
  horizontalbar: { type: 'bar' },
  barh: { type: 'bar' },
  hbar: { type: 'bar' },
  doughnut: { type: 'donut' },
  ring: { type: 'donut' },
  pies: { type: 'pie' },
  linechart: { type: 'line' },
  spline: { type: 'line' },
  curve: { type: 'line' },
  trend: { type: 'line' },
  areachart: { type: 'area' },
  points: { type: 'scatter' },
  dot: { type: 'scatter' },
  dotplot: { type: 'scatter' },
  xy: { type: 'scatter' },
  scatterplot: { type: 'scatter' },
  bubble: { type: 'scatter' },
};

/** The forms Conch doesn't draw, and the honest thing to do instead. */
const INSTEAD: Record<string, string> = {
  radar: 'a column chart with one column per measure',
  spider: 'a column chart with one column per measure',
  treemap: 'a bar chart, biggest first, or a pie if it is parts of one whole',
  sunburst: 'a donut of the top level, or a bar chart',
  funnel: 'a bar chart of each stage, biggest first',
  waterfall: 'a column chart of each step, with a total column',
  gauge: 'a column chart with a goal line, or just say the number',
  sankey: 'a bar chart of the biggest flows',
  heatmap: 'a table (file_make with sheets), or one line per row',
  candlestick: 'a line of closing prices',
  ohlc: 'a line of closing prices',
  boxplot: 'a bar chart of the medians, with the range in your reply',
  histogram: 'a column chart, with your buckets as the labels',
  violin: 'a column chart of the medians',
  polar: 'a column chart',
  gantt: 'a bar chart of how long each thing takes',
  map: 'a bar chart by place, or the places tool for a real map',
  choropleth: 'a bar chart by place',
  wordcloud: 'a bar chart of the commonest words',
  table: 'file_make with sheets, or just write the table in your reply',
};

const Label = z.string().max(80);

const SeriesInput = z
  .object({
    name: z.string().min(1).max(60),
    values: z.array(z.number().finite().nullable()).min(1).max(CHART_POINTS_MAX),
  })
  .strict();

const Input = {
  type: z.string().min(1).max(40),
  labels: z.array(Label).min(1).max(CHART_POINTS_MAX),
  series: z.array(SeriesInput).min(1).max(40),
  title: z.string().max(120).optional(),
  subtitle: z.string().max(200).optional(),
  unit: z.string().max(12).optional(),
  prefix: z.string().max(4).optional(),
  stacked: z.boolean().optional(),
  horizontal: z.boolean().optional(),
  goal: z.number().finite().optional(),
  goal_label: z.string().max(40).optional(),
  source: z.string().max(80).optional(),
  note: z.string().max(240).optional(),
};

const DESCRIPTION = [
  'Draw a chart in the chat, live: the person sees it as a card they can read with a pointer or the arrow keys, pick a bar or a slice out of, open as a table of numbers, and save or send as an image from the card’s own share bar.',
  'Use it whenever someone asks for a chart, graph, plot, breakdown, split, trend or comparison — “make me a pie chart of…”, “chart this”, “show me that as a graph” — and whenever numbers already in the conversation would read better as a picture than as a list.',
  'Choose the form by the question: parts of one whole → pie or donut; change over time → line, or area when the total is the point; categories compared → column, or bar when the names are long; two measures against each other → scatter (at most 3 series).',
  'Drawn: column (bars standing up, the usual kind), bar (bars lying down, for long names or many of them), line, area, pie, donut, scatter. "stackedBar"/"groupedBar" are a column chart with stacked true or false. Anything else (radar, treemap, funnel, gauge, waterfall, heatmap, candlestick, sankey) is refused with what to use instead — it is not quietly turned into something else.',
  'Give labels (the categories, or the x values — ISO dates like 2026-01 or 2026-01-31 are labelled as dates) and one entry per series, each with a name and one value per label. Use null for a gap, never 0. Keep it to 8 series or fewer — gather a long tail into one "Other" yourself; a pie does that for you and says so. Say the unit (unit: "%" or "kWh") or the money (prefix: "$"), and give a goal when there is one to read against.',
  'The card already shows the numbers, so don’t relist them in your reply: say what the picture says — which is biggest, what changed, what to do about it.',
  'file_make with a chart is for a chart someone wants as a **file** (a PNG or SVG for a deck or an email). chart_show is for one to look at in the chat. Don’t make a file just to send a chart: the chat card can be saved or sent as an image from its own share bar.',
].join(' ');

/** A value a model may have written another plain way. */
function mend(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  // "Pie" / "pie_chart" / "PieChart" all mean the same thing.
  if (typeof out.type === 'string') out.type = out.type.trim();
  if (Array.isArray(out.labels))
    out.labels = out.labels.map((l) =>
      typeof l === 'number' || typeof l === 'boolean' ? String(l) : l,
    );
  // One series written flat: `values` beside the labels.
  if (!out.series && Array.isArray(out.values))
    out.series = [
      { name: typeof out.title === 'string' ? out.title : 'Value', values: out.values },
    ];
  if (Array.isArray(out.series))
    out.series = out.series.map((s) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
      const row = { ...(s as Record<string, unknown>) };
      // `data` and `y` are what other chart libraries call the values.
      if (!row.values && Array.isArray(row.data)) row.values = row.data;
      if (!row.values && Array.isArray(row.y)) row.values = row.y;
      if (!row.name && typeof row.label === 'string') row.name = row.label;
      if (!row.name && typeof row.title === 'string') row.name = row.title;
      if (Array.isArray(row.values))
        row.values = row.values.map((v) =>
          v === undefined || v === ''
            ? null
            : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
              ? Number(v)
              : v,
        );
      delete row.data;
      delete row.y;
      delete row.label;
      if (row.name !== row.title) delete row.title;
      return row;
    });
  return out;
}

/** The form asked for, or a refusal that says what to use instead. */
export function chartKind(said: string): {
  type: ChartKind;
  stacked?: boolean;
  horizontal?: boolean;
} {
  const bare = said.toLowerCase().replace(/[^a-z]/g, '');
  // "Pie", "pie chart", "pie graph" and "piediagram" all mean the same.
  const stem = bare.replace(/(?:chart|graph|plot|diagram|viz)$/, '') || bare;
  for (const word of [bare, stem]) {
    const known = KINDS.find((k) => k === word);
    if (known) return { type: known };
    const same = SAME_THING[word];
    if (same) return same;
  }
  const instead = Object.entries(INSTEAD).find(([word]) => bare.includes(word));
  if (instead)
    throw new Error(
      `Conch doesn’t draw a ${instead[0]} chart. Use ${instead[1]} — or, if the picture really has to be that one, say so in words instead of drawing it wrong. The forms it draws: ${KINDS.join(', ')}.`,
    );
  throw new Error(
    `“${said.slice(0, 40)}” isn’t a chart Conch draws. Pick one of: ${KINDS.join(', ')}. Parts of a whole → pie or donut; over time → line or area; categories compared → column or bar; two measures → scatter.`,
  );
}

/** The view, or a refusal a model can act on. Never a half-drawn card. */
export function chartView(raw: unknown): { view: ChartView; warnings: string[] } {
  const args = z.object(Input).parse(raw);
  const { type, stacked: byKind, horizontal: sideways } = chartKind(args.type);
  const warnings: string[] = [];

  const points = args.labels.length;
  if (args.series.length > CHART_SERIES_MAX)
    throw new Error(
      `${args.series.length} series is too many to tell apart: keep it to ${CHART_SERIES_MAX}. Gather the smallest into one “Other”, or draw a chart per group.`,
    );
  if (type === 'scatter' && args.series.length > CHART_SCATTER_SERIES_MAX)
    throw new Error(
      `A scatter can only tell ${CHART_SCATTER_SERIES_MAX} series apart — any two dots can end up side by side. Use ${CHART_SCATTER_SERIES_MAX} or fewer, or draw a line chart.`,
    );
  if ((type === 'pie' || type === 'donut') && args.series.length > 1)
    throw new Error(
      `A ${type} shows one series as parts of one whole, and you gave ${args.series.length}. Send the one that matters, or use a column chart to compare them.`,
    );

  for (const series of args.series) {
    if (series.values.length !== points)
      throw new Error(
        `“${series.name}” has ${series.values.length} values but there are ${points} labels. Every series needs one value per label — use null where there's no reading.`,
      );
  }
  const anything = args.series.some((s) => s.values.some((v) => v !== null));
  if (!anything)
    throw new Error(
      'Every value is empty, so there’s nothing to draw. Send the numbers, or say in words that you don’t have them.',
    );

  if (type === 'pie' || type === 'donut') {
    const values = args.series[0]?.values ?? [];
    const negative = values.filter((v) => v !== null && v < 0).length;
    const usable = values.filter((v) => v !== null && v > 0).length;
    if (!usable)
      throw new Error(
        `A ${type} needs values above zero, and none of these are. Use a column chart, which can show negatives honestly.`,
      );
    if (negative)
      warnings.push(
        `${negative} ${negative === 1 ? 'value is' : 'values are'} below zero and a ${type} can’t show that: ${negative === 1 ? 'it' : 'they'} were left out.`,
      );
    if (usable > CHART_SERIES_MAX)
      warnings.push(
        `${usable - CHART_SERIES_MAX + 1} of the smallest parts are drawn together as “Others”; the card says so.`,
      );
  }

  const view: ChartView = {
    kind: 'chart',
    type,
    labels: args.labels,
    series: args.series,
    ...(args.title && { title: args.title }),
    ...(args.subtitle && { subtitle: args.subtitle }),
    ...(args.unit && { unit: args.unit }),
    ...(args.prefix && { prefix: args.prefix }),
    ...((args.stacked ?? byKind) !== undefined && { stacked: Boolean(args.stacked ?? byKind) }),
    ...((args.horizontal ?? sideways) !== undefined && {
      horizontal: Boolean(args.horizontal ?? sideways),
    }),
    ...(args.goal !== undefined && {
      goal: { value: args.goal, ...(args.goal_label && { label: args.goal_label }) },
    }),
    ...(args.source && { source: args.source }),
    ...(args.note && { note: args.note }),
  };
  return { view, warnings };
}

/** What the model reads back: that it was drawn, and what to do with the reply. */
export function chartText(view: ChartView, warnings: readonly string[]): string {
  const points = view.labels.length;
  const biggest = view.series
    .flatMap((s) => s.values.filter((v): v is number => v !== null))
    .reduce((most, v) => (Math.abs(v) > Math.abs(most) ? v : most), 0);
  const shape =
    view.type === 'pie' || view.type === 'donut'
      ? `${points} parts of one whole`
      : `${view.series.length} ${view.series.length === 1 ? 'series' : 'series'} over ${points} ${points === 1 ? 'point' : 'points'}`;
  return [
    `Drawn in the chat: a ${view.type} chart${view.title ? ` — “${view.title}”` : ''}, ${shape}${
      view.stacked ? ', stacked' : ''
    }. Largest value ${formatValue(biggest, view.unit ?? view.prefix)}.`,
    ...warnings,
    'The card shows the numbers, a table of them under “Show the numbers”, and a share bar to save or send it as an image — so the person can keep it without a file. Say what the picture says (which is biggest, what changed, what to do), and don’t list the numbers again.',
  ].join(' ');
}

/** `chart_show`: the model hands over the data, the chat draws it. */
export function chartTools(): HostTool[] {
  return [
    {
      name: 'chart_show',
      effect: 'read',
      row: true,
      searchHint:
        'chart graph plot pie bar column line area donut scatter visualise visualize draw data breakdown comparison trend',
      description: DESCRIPTION,
      aliases: {
        type: ['kind', 'chart_type', 'chartType'],
        labels: ['categories', 'x', 'x_labels', 'names'],
        series: ['data', 'datasets', 'values'],
        goal: ['target', 'goal_value'],
        goal_label: ['target_label'],
      },
      mend,
      input: Input,
      run: async (raw): Promise<HostToolResult> => {
        const { view, warnings } = chartView(raw);
        return { text: chartText(view, warnings), view };
      },
    },
  ];
}
