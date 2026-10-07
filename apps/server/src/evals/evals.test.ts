/**
 * The eval suite's own logic, checked without any model (ADR 0071): the
 * checkers, the matrix, the fixture site and the report. The suite itself
 * spends money and runs only through `pnpm eval`.
 */
import { describe, expect, it } from 'vitest';
import { convert } from 'html-to-text';

import { SITE, startSite } from './fixtures/site';
import { EVAL_MODELS, keyFrom, pickModel, SWITCH_FROM } from './models';
import { compare, html, markdown, type RunResults, type TaskResult } from './report';
import { QuestionDesk } from '../questions/desk';
import type { ToolContext } from '../conversations/manager';
import {
  checkList,
  checkSignup,
  firstOption,
  mentionsAmount,
  SHOPPING,
  TASKS,
  unanswered,
} from './tasks';

describe('the checkers', () => {
  it('reads an amount however it is written', () => {
    for (const text of ['1,234.50', '€1234.50', 'EUR 1234.5', '1.234,50 €', 'a total of 1234.50.'])
      expect(mentionsAmount(text, 1234.5), text).toBe(true);
    for (const text of ['1,234.55', '11234.50', '234.50', '1234.501'])
      expect(mentionsAmount(text, 1234.5), text).toBe(false);
    expect(mentionsAmount('684 euros left', 684)).toBe(true);
    expect(mentionsAmount('€684.00', 684)).toBe(true);
    expect(mentionsAmount('6840', 684)).toBe(false);
  });

  it('checks every field of the form', () => {
    const good = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      plan: 'Pro',
      terms: 'yes',
      message: 'Found you through the eval',
    };
    expect(checkSignup([good]).status).toBe('pass');
    expect(checkSignup([]).reason).toMatch(/never submitted/);
    expect(checkSignup([{ ...good, plan: 'Basic' }]).reason).toMatch(/plan/);
    expect(checkSignup([{ ...good, terms: '' }]).reason).toMatch(/terms/);
  });

  it('checks the whole list, quantities included', () => {
    expect(checkList([SHOPPING.map((s) => ({ ...s, item: s.item.toLowerCase() }))]).status).toBe(
      'pass',
    );
    expect(checkList([SHOPPING.slice(1)]).reason).toMatch(/missing Apples/);
    expect(checkList([SHOPPING.map((s) => ({ ...s, quantity: 1 }))]).reason).toMatch(
      /wrong quantity/,
    );
    expect(checkList([]).reason).toMatch(/never saved/);
  });

  it('says why a turn gave no answer', () => {
    expect(unanswered({ chat: 'c', text: '', outcome: 'success' })).toBeUndefined();
    expect(unanswered({ chat: 'c', text: '', outcome: 'needs-apps' })?.reason).toMatch(/apps/);
    expect(unanswered({ chat: 'c', text: '', outcome: 'error', error: 'boom' })?.reason).toMatch(
      /boom/,
    );
  });

  it('answers every kind of question a card can hold, so a reply never waits', async () => {
    const desk = new QuestionDesk();
    const asked: unknown[] = [];
    const ctx = {
      conversationId: 'c1',
      signal: new AbortController().signal,
      append: (event: unknown) => asked.push(event),
    } as unknown as ToolContext;
    const waiting = desk.ask(ctx, {
      fields: [
        { id: 'ledger', label: 'Which ledger?', kind: 'text', optional: false, multiline: false },
        {
          id: 'invoice',
          label: 'Link to an invoice?',
          kind: 'choice',
          optional: false,
          multiple: false,
          other: true,
          options: [
            { id: 'inv-101', label: 'INV-101' },
            { id: 'none', label: 'No' },
          ],
        },
        { id: 'count', label: 'How many?', kind: 'number', optional: false },
      ],
    });
    const question = desk.waiting('c1');
    if (!question) throw new Error('no question');
    desk.answer('c1', question.questionId, firstOption(question));
    expect(await waiting).toMatch(/They answered/);
  });

  it('has the tasks the suite promises, each with a unique id', () => {
    const ids = TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'form',
      'deep-find',
      'app-tool',
      'memory',
      'ask',
      'canvas',
      'long',
      'malformed-mcp',
      'switch',
    ])
      expect(ids).toContain(id);
    expect(TASKS.some((t) => t.smoke)).toBe(true);
  });
});

describe('the matrix', () => {
  it('covers every kind of provider, with one smoke model', () => {
    const tiers = new Set(EVAL_MODELS.map((m) => m.tier));
    expect([...tiers].sort()).toEqual(['agent', 'frontier', 'local', 'mid', 'weak']);
    expect(EVAL_MODELS.length).toBeGreaterThanOrEqual(9);
    expect(EVAL_MODELS.some((m) => m.smoke)).toBe(true);
    expect(new Set(EVAL_MODELS.map((m) => m.id)).size).toBe(EVAL_MODELS.length);
    for (const id of SWITCH_FROM) expect(EVAL_MODELS.some((m) => m.id === id)).toBe(true);
  });

  it('takes a key only from the variables a model names', () => {
    expect(keyFrom({ keys: ['A', 'B'] }, { B: ' k ' })).toBe('k');
    expect(keyFrom({ keys: ['A'] }, { A: '' })).toBeUndefined();
    expect(keyFrom({}, { A: 'x' })).toBeUndefined();
  });

  it('picks the first listed model, and tries one anyway when the list is partial', () => {
    expect(pickModel(['a', 'b'], ['b', 'c'])).toEqual({ model: 'b' });
    expect(pickModel(['a'], ['c'])).toEqual({ model: 'a' });
    expect(pickModel(['a'], ['c'], true)).toEqual({ missing: true });
    expect(pickModel([], ['c', 'd'])).toEqual({ model: 'c' });
    expect(pickModel([], [])).toEqual({});
  });
});

describe('the fixture site', () => {
  it('records what is submitted, and keeps the account behind a sign-in', async () => {
    const site = await startSite();
    try {
      const post = (path: string, body: string, headers: Record<string, string> = {}) =>
        fetch(`${site.url}${path}`, { method: 'POST', body, headers, redirect: 'manual' });
      await post('/signup', 'name=Ada&plan=Pro', {
        'content-type': 'application/x-www-form-urlencoded',
      });
      expect(site.submissions.signup).toEqual([{ name: 'Ada', plan: 'Pro' }]);
      expect((await fetch(`${site.url}/account`, { redirect: 'manual' })).status).toBe(303);
      const bad = await post('/login', 'username=ada.eval&password=nope');
      expect(bad.status).toBe(401);
      const good = await post(
        '/login',
        new URLSearchParams({ ...SITE.login, next: '/account' }).toString(),
      );
      const cookie = good.headers.get('set-cookie')?.split(';')[0] ?? '';
      const account = await fetch(`${site.url}/account`, { headers: { cookie } });
      expect(await account.text()).toContain(SITE.membership);
      const meter = await (await fetch(`${site.url}/meter`)).text();
      expect(convert(meter)).not.toContain(SITE.meter);
      const product = await (await fetch(`${site.url}/shop/garden/blue-watering-can`)).text();
      expect(product).toContain(SITE.orderCode);
      // The export is always down; the page has the same prices (ADR 0102).
      expect((await fetch(`${site.url}/prices.csv`)).status).toBe(503);
      expect(await (await fetch(`${site.url}/prices`)).text()).toContain(
        SITE.kettle.price.toFixed(2),
      );
    } finally {
      await site.close();
    }
  });
});

const result = (over: Partial<TaskResult>): TaskResult => ({
  model: 'm',
  task: 't',
  status: 'pass',
  reason: 'ok',
  steps: 3,
  tools: {},
  tokens: { input: 100, output: 10, cached: 0 },
  costUsd: 0.01,
  latencyMs: 10_000,
  turns: 1,
  denials: [],
  ...over,
});

const runOf = (results: TaskResult[], runId = 'now'): RunResults => ({
  version: 1,
  runId,
  startedAt: '2026-10-04T00:00:00Z',
  finishedAt: '2026-10-04T00:10:00Z',
  smoke: false,
  tasks: [
    { id: 't', title: 'Task T', about: '' },
    { id: 'u', title: 'Task U', about: '' },
  ],
  models: [{ id: 'm', label: 'Model M', engine: 'openrouter', tier: 'mid', status: 'ran' }],
  results,
});

describe('the report', () => {
  it('keeps backslashes and pipes inside Markdown table cells', () => {
    const run = runOf([result({})]);
    const model = run.models[0];
    if (!model) throw new Error('Missing model fixture');
    model.label = 'Provider\\|extra\r\nrow';
    expect(markdown(run)).toContain('Provider\\\\\\|extra  row');
  });

  it('puts regressions first, then fixes, and ignores noise', () => {
    const before = runOf([result({}), result({ task: 'u', status: 'fail', reason: 'no' })], 'then');
    const now = runOf([result({ status: 'fail', reason: 'lost the form' }), result({ task: 'u' })]);
    const changes = compare(now, before);
    expect(changes.map((c) => c.kind)).toEqual(['regression', 'fixed']);
    expect(
      compare(runOf([result({ latencyMs: 11_000, costUsd: 0.011 })]), runOf([result({})])),
    ).toEqual([]);
    expect(compare(runOf([result({ latencyMs: 40_000 })]), runOf([result({})]))[0]?.kind).toBe(
      'slower',
    );
    expect(compare(now, undefined)).toEqual([]);
  });

  it('writes Markdown and HTML that say what got worse', () => {
    const before = runOf([result({})], 'then');
    const now = runOf([result({ status: 'fail', reason: 'lost the <form>' })]);
    const text = markdown(now, before);
    expect(text).toContain('**REGRESSION** m / t');
    expect(text).toContain('| Task T | **FAIL** · 3 steps |');
    const page = html(now, before);
    expect(page).toContain('regressed');
    expect(page).toContain('lost the &lt;form&gt;');
    expect(page).not.toContain('<form>');
  });
});
