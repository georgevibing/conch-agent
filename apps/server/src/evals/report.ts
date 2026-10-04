/**
 * The eval suite's results (ADR 0071): one JSON file per run, and a report
 * that puts the models side by side and against the run before, with what got
 * worse first. Written as Markdown (the CI summary, a PR comment) and as a
 * self-contained HTML page.
 */
import type { EvalTier } from './models';

export type Status = 'pass' | 'fail' | 'error' | 'skipped';

export interface ModelRow {
  id: string;
  label: string;
  engine: string;
  model?: string;
  tier: EvalTier;
  status: 'ran' | 'skipped' | 'error';
  reason?: string;
}

export interface TaskResult {
  model: string;
  task: string;
  status: Status;
  reason: string;
  steps: number;
  tools: Record<string, number>;
  tokens: { input: number; output: number; cached: number };
  costUsd?: number;
  latencyMs: number;
  turns: number;
  denials: string[];
  answeredWith?: string;
}

export interface RunResults {
  version: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  commit?: string;
  smoke: boolean;
  tasks: { id: string; title: string; about: string }[];
  models: ModelRow[];
  results: TaskResult[];
}

export interface Change {
  model: string;
  task: string;
  kind: 'regression' | 'fixed' | 'costlier' | 'slower' | 'cheaper' | 'faster';
  before: string;
  after: string;
}

const key = (r: Pick<TaskResult, 'model' | 'task'>) => `${r.model}\u0000${r.task}`;

/** Big enough to be worth saying: at least a quarter, and more than noise. */
const grew = (before: number, after: number, floor: number) =>
  after > before * 1.25 && after - before > floor;

/** What changed since the run before, worst first. Only cells both runs ran. */
export function compare(current: RunResults, previous: RunResults | undefined): Change[] {
  if (!previous) return [];
  const before = new Map(previous.results.map((r) => [key(r), r]));
  const changes: Change[] = [];
  for (const now of current.results) {
    const then = before.get(key(now));
    if (!then || then.status === 'skipped' || now.status === 'skipped') continue;
    const at = { model: now.model, task: now.task };
    if (then.status === 'pass' && now.status !== 'pass')
      changes.push({
        ...at,
        kind: 'regression',
        before: 'pass',
        after: `${now.status}: ${now.reason}`,
      });
    else if (then.status !== 'pass' && now.status === 'pass')
      changes.push({ ...at, kind: 'fixed', before: then.status, after: 'pass' });
    if (now.status !== 'pass' || then.status !== 'pass') continue;
    if (then.costUsd !== undefined && now.costUsd !== undefined) {
      if (grew(then.costUsd, now.costUsd, 0.005))
        changes.push({
          ...at,
          kind: 'costlier',
          before: usd(then.costUsd),
          after: usd(now.costUsd),
        });
      else if (grew(now.costUsd, then.costUsd, 0.005))
        changes.push({
          ...at,
          kind: 'cheaper',
          before: usd(then.costUsd),
          after: usd(now.costUsd),
        });
    }
    if (grew(then.latencyMs, now.latencyMs, 5_000))
      changes.push({
        ...at,
        kind: 'slower',
        before: secs(then.latencyMs),
        after: secs(now.latencyMs),
      });
    else if (grew(now.latencyMs, then.latencyMs, 5_000))
      changes.push({
        ...at,
        kind: 'faster',
        before: secs(then.latencyMs),
        after: secs(now.latencyMs),
      });
  }
  const order: Change['kind'][] = [
    'regression',
    'costlier',
    'slower',
    'fixed',
    'cheaper',
    'faster',
  ];
  return changes.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export interface ModelSummary {
  id: string;
  passed: number;
  ran: number;
  costUsd?: number;
  tokens: number;
  steps: number;
  latencyMs: number;
}

export function summarise(run: RunResults): ModelSummary[] {
  return run.models
    .filter((m) => m.status === 'ran')
    .map((m) => {
      const rows = run.results.filter((r) => r.model === m.id && r.status !== 'skipped');
      const costs = rows.map((r) => r.costUsd);
      return {
        id: m.id,
        passed: rows.filter((r) => r.status === 'pass').length,
        ran: rows.length,
        ...(costs.every((c) => c !== undefined) && {
          costUsd: costs.reduce<number>((a, c) => a + (c ?? 0), 0),
        }),
        tokens: rows.reduce((a, r) => a + r.tokens.input + r.tokens.output, 0),
        steps: rows.reduce((a, r) => a + r.steps, 0),
        latencyMs: rows.reduce((a, r) => a + r.latencyMs, 0),
      };
    });
}

export const usd = (n: number | undefined) =>
  n === undefined ? '—' : n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
export const secs = (ms: number) =>
  ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)}m`;
const tokens = (n: number) =>
  n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`;

const mark: Record<Status, string> = {
  pass: 'pass',
  fail: '**FAIL**',
  error: 'error',
  skipped: '—',
};
const md = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function markdown(run: RunResults, previous?: RunResults): string {
  const lines: string[] = [];
  const ran = run.models.filter((m) => m.status === 'ran');
  const cell = new Map(run.results.map((r) => [key(r), r]));
  lines.push(`# Conch evals — ${run.smoke ? 'smoke run' : 'full run'}`, '');
  lines.push(
    `Run \`${run.runId}\`${run.commit ? ` at \`${run.commit.slice(0, 9)}\`` : ''}, ${run.startedAt}.` +
      (previous ? ` Compared with \`${previous.runId}\`.` : ' No earlier run to compare with.'),
    '',
  );

  const changes = compare(run, previous);
  const bad = changes.filter((c) => ['regression', 'costlier', 'slower'].includes(c.kind));
  const good = changes.filter((c) => !bad.includes(c));
  if (previous) {
    lines.push('## Since the last run', '');
    if (!changes.length) lines.push('Nothing changed beyond noise.', '');
    for (const c of bad)
      lines.push(
        `- **${c.kind.toUpperCase()}** ${c.model} / ${c.task}: ${md(c.before)} → ${md(c.after)}`,
      );
    for (const c of good)
      lines.push(`- ${c.kind}: ${c.model} / ${c.task}: ${md(c.before)} → ${md(c.after)}`);
    if (changes.length) lines.push('');
  }

  lines.push('## Models side by side', '');
  lines.push(`| Task | ${ran.map((m) => m.id).join(' | ')} |`);
  lines.push(`| --- | ${ran.map(() => '---').join(' | ')} |`);
  for (const task of run.tasks) {
    const cells = ran.map((m) => {
      const r = cell.get(key({ model: m.id, task: task.id }));
      return r ? `${mark[r.status]}${r.status === 'skipped' ? '' : ` · ${r.steps} steps`}` : '—';
    });
    lines.push(`| ${task.title} | ${cells.join(' | ')} |`);
  }
  const sums = new Map(summarise(run).map((s) => [s.id, s]));
  const row = (label: string, value: (s: ModelSummary) => string) =>
    lines.push(
      `| ${label} | ${ran
        .map((m) => {
          const s = sums.get(m.id);
          return s ? value(s) : '—';
        })
        .join(' | ')} |`,
    );
  row('**Passed**', (s) => `**${s.passed}/${s.ran}**`);
  row('Cost', (s) => usd(s.costUsd));
  row('Tokens', (s) => tokens(s.tokens));
  row('Time', (s) => secs(s.latencyMs));
  lines.push('');

  lines.push('## Models', '');
  lines.push('| Id | Model | Provider | Status |', '| --- | --- | --- | --- |');
  for (const m of run.models)
    lines.push(
      `| ${m.id} | ${md(m.label)}${m.model ? ` (\`${m.model}\`)` : ''} | ${m.engine} | ${m.status}${m.reason ? `: ${md(m.reason)}` : ''} |`,
    );
  lines.push('');

  const misses = run.results.filter((r) => r.status === 'fail' || r.status === 'error');
  if (misses.length) {
    lines.push('## Why each miss missed', '');
    for (const r of misses) lines.push(`- ${r.model} / ${r.task} (${r.status}): ${md(r.reason)}`);
    lines.push('');
  }
  return lines.join('\n');
}

const h = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

export function html(run: RunResults, previous?: RunResults): string {
  const ran = run.models.filter((m) => m.status === 'ran');
  const cell = new Map(run.results.map((r) => [key(r), r]));
  const before = new Map((previous?.results ?? []).map((r) => [key(r), r]));
  const changes = compare(run, previous);
  const regressed = new Set(changes.filter((c) => c.kind === 'regression').map(key));
  const fixed = new Set(changes.filter((c) => c.kind === 'fixed').map(key));
  const sums = new Map(summarise(run).map((s) => [s.id, s]));

  const td = (r: TaskResult | undefined) => {
    if (!r || r.status === 'skipped') return '<td class="skip">—</td>';
    const k = key(r);
    const was = before.get(k);
    const cls = [r.status, regressed.has(k) && 'regressed', fixed.has(k) && 'fixed']
      .filter(Boolean)
      .join(' ');
    const title = `${r.reason} · ${r.steps} steps · ${tokens(r.tokens.input + r.tokens.output)} tokens · ${usd(r.costUsd)} · ${secs(r.latencyMs)}${was ? ` · before: ${was.status}` : ''}`;
    return `<td class="${cls}" title="${h(title)}"><b>${r.status}</b><small>${r.steps} steps · ${secs(r.latencyMs)}</small></td>`;
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conch evals</title><style>
:root{--bg:#fbfaf7;--fg:#1d2433;--muted:#667085;--line:#e4e2dc;--pass:#0f7b4a;--passbg:#e6f4ec;--fail:#b42318;--failbg:#fde8e6;--err:#8a6100;--errbg:#fdf3d7}
@media (prefers-color-scheme:dark){:root{--bg:#14161b;--fg:#e8e9ec;--muted:#9aa1ad;--line:#2b2f37;--pass:#5fd39a;--passbg:#12301f;--fail:#ff8a7a;--failbg:#3a1714;--err:#f2c45a;--errbg:#33280c}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:1200px;margin-inline:auto}
h1{font-size:22px}h2{font-size:17px;margin-top:28px}.muted{color:var(--muted)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
td small{display:block;color:var(--muted);font-size:12px}td.pass b{color:var(--pass)}td.pass{background:var(--passbg)}
td.fail{background:var(--failbg)}td.fail b{color:var(--fail)}td.error{background:var(--errbg)}td.error b{color:var(--err)}
td.regressed{outline:3px solid var(--fail);outline-offset:-3px}td.fixed{outline:3px solid var(--pass);outline-offset:-3px}
li.bad{color:var(--fail);font-weight:600}
</style></head><body>
<h1>Conch evals — ${run.smoke ? 'smoke run' : 'full run'}</h1>
<p class="muted">Run ${h(run.runId)}${run.commit ? ` at ${h(run.commit.slice(0, 9))}` : ''}, ${h(run.startedAt)}. ${previous ? `Compared with ${h(previous.runId)}; a red outline is a regression, a green one a fix.` : 'No earlier run to compare with.'}</p>
${
  previous
    ? `<h2>Since the last run</h2>${
        changes.length
          ? `<ul>${changes
              .map(
                (c) =>
                  `<li class="${['regression', 'costlier', 'slower'].includes(c.kind) ? 'bad' : ''}">${h(c.kind)}: ${h(c.model)} / ${h(c.task)}: ${h(c.before)} → ${h(c.after)}</li>`,
              )
              .join('')}</ul>`
          : '<p>Nothing changed beyond noise.</p>'
      }`
    : ''
}
<h2>Models side by side</h2><div class="scroll"><table><thead><tr><th>Task</th>${ran.map((m) => `<th>${h(m.label)}<small class="muted"> ${h(m.model ?? 'default')}</small></th>`).join('')}</tr></thead><tbody>
${run.tasks.map((t) => `<tr><th title="${h(t.about)}">${h(t.title)}</th>${ran.map((m) => td(cell.get(key({ model: m.id, task: t.id })))).join('')}</tr>`).join('\n')}
<tr><th>Passed</th>${ran
    .map((m) => {
      const s = sums.get(m.id);
      return `<td><b>${s ? `${s.passed}/${s.ran}` : '—'}</b></td>`;
    })
    .join('')}</tr>
<tr><th>Cost</th>${ran.map((m) => `<td>${usd(sums.get(m.id)?.costUsd)}</td>`).join('')}</tr>
<tr><th>Tokens</th>${ran.map((m) => `<td>${tokens(sums.get(m.id)?.tokens ?? 0)}</td>`).join('')}</tr>
<tr><th>Time</th>${ran.map((m) => `<td>${secs(sums.get(m.id)?.latencyMs ?? 0)}</td>`).join('')}</tr>
</tbody></table></div>
<h2>Not run</h2><ul>${
    run.models
      .filter((m) => m.status !== 'ran')
      .map((m) => `<li>${h(m.label)}: ${h(m.reason ?? m.status)}</li>`)
      .join('') || '<li>Every model ran.</li>'
  }</ul>
<h2>Why each miss missed</h2><ul>${
    run.results
      .filter((r) => r.status === 'fail' || r.status === 'error')
      .map((r) => `<li>${h(r.model)} / ${h(r.task)} (${r.status}): ${h(r.reason)}</li>`)
      .join('') || '<li>None.</li>'
  }</ul>
</body></html>`;
}
