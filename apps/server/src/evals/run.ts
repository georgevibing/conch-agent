/**
 * `pnpm eval`: run the eval suite (ADR 0071) on every model that can run here,
 * and write the results and the report.
 *
 *   pnpm eval                         every task, every model with what it needs
 *   pnpm eval --smoke                 the cheap subset (smoke tasks on smoke models)
 *   pnpm eval --models claude-code,ollama-small --tasks form,memory
 *   pnpm eval --list                  what would run, and why the rest wouldn't
 *
 * Options: --out <dir> (default .evals at the repository's root), --previous
 * <file> (default: the last run in --out), --concurrency <n> models at once
 * (default 2), --max-usd <n> stop starting tasks past this spend (default 10),
 * --trace to keep every chat's events in <out>/traces.
 *
 * Keys come only from the environment. Runs live in throwaway folders; approvals
 * are answered by the scripted approver, and bypassing them takes
 * CONCH_EVAL_ALLOW_BYPASS=1. It costs money: it is never part of `pnpm check`.
 */
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { EngineId } from '@conch/protocol';

import { quietCryptoWarnings } from '../lib/quiet';
import { bootConch, connect, runTask, type Ready } from './harness';
import { EVAL_MODELS, keyFrom, pickModel, SWITCH_FROM, type EvalModel } from './models';
import { html, markdown, type ModelRow, type RunResults, type TaskResult } from './report';
import { TASKS, type EvalTask } from './tasks';

quietCryptoWarnings();
const ROOT = resolve(import.meta.dirname, '../../../..');

const { values: args } = parseArgs({
  options: {
    models: { type: 'string' },
    tasks: { type: 'string' },
    smoke: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    out: { type: 'string', default: join(ROOT, '.evals') },
    previous: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    'max-usd': { type: 'string', default: '10' },
    quiet: { type: 'boolean', default: false },
    trace: { type: 'boolean', default: false },
  },
});

const env = process.env;
const log = (line: string) => {
  if (!args.quiet)
    process.stdout.write(`${line}
`);
};
const pick = <T extends { id: string }>(
  all: readonly T[],
  wanted: string | undefined,
  label: string,
) => {
  if (!wanted) return [...all];
  const ids = wanted
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = ids.filter((id) => !all.some((a) => a.id === id));
  if (unknown.length) throw new Error(`Unknown ${label}: ${unknown.join(', ')}`);
  return all.filter((a) => ids.includes(a.id));
};

let models = pick(EVAL_MODELS, args.models, 'model');
let tasks: EvalTask[] = pick(TASKS, args.tasks, 'task');
if (args.smoke) {
  if (!args.models) models = models.filter((m) => m.smoke);
  if (!args.tasks) tasks = tasks.filter((t) => t.smoke);
}

/** Can this model run here? Its model id when it can; why not when it can't. */
async function probe(model: EvalModel): Promise<{ ready?: Ready; row: ModelRow }> {
  const row: ModelRow = {
    id: model.id,
    label: model.label,
    engine: model.engine,
    tier: model.tier,
    status: 'skipped',
  };
  const key = keyFrom(model, env);
  if (model.keys?.length && !key)
    return { row: { ...row, reason: `no ${model.keys.join(' or ')} in the environment` } };
  const conch = await bootConch({ env }).catch((e: Error) => e);
  if (conch instanceof Error) return { row: { ...row, status: 'error', reason: conch.message } };
  try {
    const engine = conch.services.engines.get(model.engine as EngineId);
    if (!engine) return { row: { ...row, reason: `this build has no ${model.engine} provider` } };
    const ready: Ready = {
      id: model.id,
      engine: model.engine,
      ...(key && { key }),
      ...(model.keyFor && { keyFor: model.keyFor }),
    };
    try {
      await connect(conch.services, ready);
    } catch (error) {
      return { row: { ...row, reason: String((error as Error).message ?? error).slice(0, 200) } };
    }
    const listed =
      (await engine.capabilities().catch(() => undefined))?.models.map((m) => m.id) ?? [];
    const chosen = pickModel(model.models, listed, model.tier === 'local');
    if (chosen.missing)
      return { row: { ...row, reason: `none of ${model.models.join(', ')} is installed` } };
    return {
      ready: { ...ready, ...(chosen.model && { model: chosen.model }) },
      row: { ...row, status: 'ran', ...(chosen.model && { model: chosen.model }) },
    };
  } catch (error) {
    return {
      row: {
        ...row,
        status: 'error',
        reason: String((error as Error).message ?? error).slice(0, 200),
      },
    };
  } finally {
    await conch.stop();
  }
}

const probed = new Map<string, Awaited<ReturnType<typeof probe>>>();
// The partners a switch may need are probed too, even when not under test.
const toProbe = [...new Set([...models, ...EVAL_MODELS.filter((m) => SWITCH_FROM.includes(m.id))])];
const needsPartner = tasks.some((t) => t.needs?.includes('partner'));
for (const model of toProbe) {
  if (!models.includes(model) && !needsPartner) continue;
  probed.set(model.id, await probe(model));
  const { row } = probed.get(model.id) ?? {};
  log(
    `${row?.status === 'ran' ? 'ready  ' : 'skipped'} ${model.id}${row?.model ? ` (${row.model})` : ''}${row?.reason ? ` — ${row.reason}` : ''}`,
  );
}
if (args.list) process.exit(0);

const partnerFor = (id: string): Ready | undefined =>
  SWITCH_FROM.filter((p) => p !== id)
    .map((p) => probed.get(p)?.ready)
    .find(Boolean);

const startedAt = new Date().toISOString();
const results: TaskResult[] = [];
const maxUsd = Number(args['max-usd']);
let spent = 0;

async function runModel(model: EvalModel) {
  const ready = probed.get(model.id)?.ready;
  if (!ready) return;
  for (const task of tasks) {
    const skip = (reason: string) =>
      results.push({
        model: model.id,
        task: task.id,
        status: 'skipped',
        reason,
        steps: 0,
        tools: {},
        tokens: { input: 0, output: 0, cached: 0 },
        latencyMs: 0,
        turns: 0,
        denials: [],
      });
    if (spent >= maxUsd) {
      skip(`over the run’s budget of $${maxUsd}`);
      continue;
    }
    log(`▶ ${model.id} · ${task.id}`);
    const partner = task.needs?.includes('partner') ? partnerFor(model.id) : undefined;
    const outcome = await runTask(task, {
      model: ready,
      ...(partner && { partner }),
      env,
      log,
      ...(args.trace && { traceTo: join(resolve(args.out), 'traces') }),
    });
    spent += outcome.costUsd ?? 0;
    results.push({ model: model.id, task: task.id, ...outcome });
    // A provider's default model, named once it has answered.
    const row = probed.get(model.id)?.row;
    if (row && !row.model && outcome.answeredWith) row.model = outcome.answeredWith;
    log(
      `  ${outcome.status.toUpperCase()} ${task.id}: ${outcome.reason} (${outcome.steps} steps, ${Math.round(outcome.latencyMs / 1000)}s)`,
    );
  }
}

const queue = [...models];
const width = Math.max(1, Number(args.concurrency) || 1);
await Promise.all(
  Array.from({ length: width }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await runModel(next);
  }),
);

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
})();
const run: RunResults = {
  version: 1,
  runId: startedAt.replace(/[:.]/g, '-'),
  startedAt,
  finishedAt: new Date().toISOString(),
  ...(commit && { commit }),
  smoke: args.smoke,
  tasks: tasks.map((t) => ({ id: t.id, title: t.title, about: t.about })),
  models: models.map(
    (m) =>
      probed.get(m.id)?.row ?? {
        id: m.id,
        label: m.label,
        engine: m.engine,
        tier: m.tier,
        status: 'skipped' as const,
      },
  ),
  results: results.sort(
    (a, b) =>
      a.model.localeCompare(b.model) ||
      tasks.findIndex((t) => t.id === a.task) - tasks.findIndex((t) => t.id === b.task),
  ),
};

const out = resolve(args.out);
await mkdir(join(out, 'runs'), { recursive: true });
const previousPath = args.previous ?? join(out, 'latest.json');
const previous = await readFile(previousPath, 'utf8')
  .then((text) => JSON.parse(text) as RunResults)
  .catch(() => undefined);
await writeFile(join(out, 'runs', `${run.runId}.json`), `${JSON.stringify(run, null, 2)}\n`);
await writeFile(join(out, 'latest.json'), `${JSON.stringify(run, null, 2)}\n`);
const report = markdown(run, previous);
await writeFile(join(out, 'report.md'), report);
await writeFile(join(out, 'report.html'), html(run, previous));
if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `${report}\n`);
log(`\n${report}\nWrote ${join(out, 'report.html')}`);
// Leave the browsers and app servers behind quickly.
process.exit(0);
