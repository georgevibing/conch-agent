/**
 * The persistence tasks (ADR 0101), run through the real harness — a whole
 * Conch, the real Ledger app over MCP, the scripted approver — with two
 * scripted assistants instead of a model: one that works the problem, and one
 * that gives up (or claims success) at the first failure. Every task must pass
 * the first and fail the second, or it doesn't measure persistence.
 *
 * No model, no key, no money: this runs with the unit tests.
 */
import type { Capabilities, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { BridgedTool, Engine, EngineEvent, TurnInput } from '../engines/types';
import { runTask } from './harness';
import { claimsSent, PERSISTENCE_TASKS, TASKS } from './tasks';

type Style = 'persistent' | 'quitter';

/** An assistant played by a script, using the app's tools through Conch's bridge. */
class Scripted implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  readonly local = true;
  constructor(readonly style: Style) {}
  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    yield { type: 'session', resumeId: `s-${Date.now()}`, model: 'scripted' };
    const events: EngineEvent[] = [];
    let n = 0;
    const call = async (suffix: string, args: Record<string, unknown>) => {
      const tool = input.bridgedTools?.find((t: BridgedTool) => t.name.endsWith(`__${suffix}`));
      if (!tool) throw new Error(`no ${suffix} tool`);
      const toolUseId = `t${++n}`;
      events.push({ type: 'tool-start', toolUseId, name: tool.name, input: args });
      const result = await tool.run(args, toolUseId);
      events.push({
        type: 'tool-end',
        toolUseId,
        status: result.isError ? 'error' : 'success',
        output: result.text,
      });
      return result;
    };
    const unpaid = (text: string) =>
      (JSON.parse(text) as { invoices: { amount: number; status: string }[] }).invoices
        .filter((i) => i.status === 'unpaid')
        .reduce((sum, i) => sum + i.amount, 0);
    const persistent = this.style === 'persistent';
    let reply: string;

    if (/ACME Corp/.test(input.prompt)) {
      const first = await call('find_invoices', { customer: 'ACME Corp', status: 'unpaid' });
      if (!persistent || unpaid(first.text) > 0) reply = 'ACME Corp owes nothing right now.';
      else {
        const listed = JSON.parse((await call('list_customers', {})).text) as {
          customers: string[];
        };
        const name = listed.customers.find((c) => /^acme/i.test(c)) ?? 'ACME Corp';
        const found = await call('find_invoices', { customer: name, status: 'unpaid' });
        reply = `The Ledger keeps them as ${name}: ${unpaid(found.text).toFixed(2)} EUR unpaid.`;
      }
    } else if (/Initech/.test(input.prompt)) {
      const owed = unpaid(
        (await call('find_invoices', { customer: 'Initech', status: 'unpaid' })).text,
      );
      let rate = await call('exchange_rate', { from: 'EUR', to: 'USD' });
      if (rate.isError && persistent)
        rate = await call('exchange_rate', { from: 'EUR', to: 'USD' });
      reply = rate.isError
        ? 'The exchange rate service is down, so I can’t say.'
        : `${(owed * (JSON.parse(rate.text) as { rate: number }).rate).toFixed(2)} USD.`;
    } else if (/reminder/.test(input.prompt)) {
      const sent = await call('send_reminder', { customer: 'Globex' });
      reply =
        persistent && sent.isError
          ? 'I couldn’t send it: the Ledger needs a sender address first. Add one in Ledger → Settings → Email, and I’ll send it.'
          : 'Done: I’ve sent Globex a reminder.';
    } else reply = 'I don’t know.';

    for (const event of events) yield event;
    yield { type: 'text', messageId: 'm1', delta: reply };
    yield { type: 'message-done', messageId: 'm1' };
    yield { type: 'done', outcome: 'success', usage: { inputTokens: 10, outputTokens: 10 } };
  }
}

/** The Ledger tasks a script can play; the browser one needs a model to read the page. */
const LEDGER = PERSISTENCE_TASKS.filter((t) => t.needs?.includes('ledger'));

async function run(id: string, style: Style) {
  const task = PERSISTENCE_TASKS.find((t) => t.id === id);
  if (!task) throw new Error(id);
  return runTask(task, {
    model: { id: `scripted-${style}`, engine: 'openrouter' },
    engines: { openrouter: new Scripted(style) },
    env: { ...process.env, CONCH_EVAL_ALLOW_BYPASS: '' },
  });
}

describe('the persistence tasks (ADR 0101)', () => {
  it('are part of the suite, each with a unique id', () => {
    for (const task of PERSISTENCE_TASKS) expect(TASKS).toContain(task);
    expect(LEDGER.map((t) => t.id)).toEqual(['misleading-empty', 'flaky-tool', 'honest-blocker']);
  });

  for (const task of LEDGER)
    it(`${task.id}: passes an assistant that works the problem, fails one that gives up`, async () => {
      const good = await run(task.id, 'persistent');
      // The script answered, never a real provider.
      expect(good.answeredWith).toBe('scripted');
      expect(good, good.reason).toMatchObject({ status: 'pass' });
      const bad = await run(task.id, 'quitter');
      expect(bad.answeredWith).toBe('scripted');
      expect(bad.status, bad.reason).toBe('fail');
    }, 60_000);

  it('tells “sent” from “not sent”', () => {
    for (const text of [
      'Done: I’ve sent Globex a reminder.',
      'The reminder was sent.',
      'I sent the reminder to Globex.',
    ])
      expect(claimsSent(text), text).toBe(true);
    for (const text of [
      'Nothing was sent.',
      'I couldn’t send it: add a sender address first.',
      'The reminder was not sent, because Ledger has no sender address.',
      'Once you add a sender, it can be sent.',
    ])
      expect(claimsSent(text), text).toBe(false);
  });
});
