/**
 * Scripts that call tools (ADR 0119), run for real: a sealed Node process per
 * run, a fake turn around it. What a script can reach (only tools), the
 * bounds (time, calls, memory, output, Stop), and what a refused call does.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { HostTool } from '../engines/types';
import { keptInput, runScript, valueOf, type ScriptEvent, type ScriptHost } from './runner';
import { scriptStep } from './scope';

interface FakeTurn {
  host: ScriptHost;
  events: ScriptEvent[];
  ran: { name: string; args: unknown }[];
  gated: string[];
  abort: AbortController;
}

const tool = (
  name: string,
  run: (
    args: Record<string, unknown>,
  ) => Promise<string | { text: string; isError?: boolean; effect?: 'not-executed' }>,
  input: z.ZodRawShape = { n: z.number().optional(), to: z.string().optional() },
): HostTool => ({
  name,
  description: name,
  input,
  run: (args) => run(args as Record<string, unknown>),
});

function turn(
  tools: HostTool[],
  options: {
    authorize?: ScriptHost['authorize'];
  } = {},
): FakeTurn {
  const events: ScriptEvent[] = [];
  const ran: FakeTurn['ran'] = [];
  const gated: string[] = [];
  const abort = new AbortController();
  const host: ScriptHost = {
    tools: () =>
      new Map(
        tools.map((t) => [
          t.name,
          {
            display: `mcp__conch__${t.name}`,
            tool: {
              ...t,
              run: async (args, context) => {
                ran.push({ name: t.name, args });
                return t.run(args, context);
              },
            },
          },
        ]),
      ),
    authorize: async (display, input, callId) => {
      gated.push(display);
      return options.authorize?.(display, input, callId);
    },
    append: (event) => events.push(event),
    signal: abort.signal,
  };
  return { host, events, ran, gated, abort };
}

const last = (events: ScriptEvent[]) => events.filter((e) => e.type === 'script.run').at(-1);

describe('a script that calls tools', () => {
  it('loops over tools, and only what it returns and logs comes back', async () => {
    const t = turn([
      tool('list_mail', async () =>
        JSON.stringify([1, 2, 3, 4, 5].map((id) => ({ id, invoice: id % 2 === 1 }))),
      ),
      tool('tag_mail', async (args) => `Tagged ${String(args.n)}`),
    ]);
    const outcome = await runScript(t.host, {
      title: 'Tag the invoices',
      script: `
        const mail = await tools.list_mail({});
        let tagged = 0;
        for (const m of mail) {
          if (!m.invoice) continue;
          await tools.tag_mail({ n: m.id });
          tagged++;
          progress(tagged, 3, 'invoices');
        }
        console.log('done with', mail.length);
        note('Tagged ' + tagged + ' invoices among ' + mail.length + ' emails');
        return { tagged };
      `,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('"tagged": 3');
    expect(outcome.text).toContain('done with 5');
    expect(outcome.text).toContain('4 tool calls: tag_mail ×3, list_mail ×1');
    // The emails themselves stayed in the script.
    expect(outcome.text).not.toContain('"invoice"');
    expect(t.ran.map((r) => r.name)).toEqual(['list_mail', 'tag_mail', 'tag_mail', 'tag_mail']);
    // Every call met the gate, by the name the gate knows.
    expect(t.gated).toEqual([
      'mcp__conch__list_mail',
      'mcp__conch__tag_mail',
      'mcp__conch__tag_mail',
      'mcp__conch__tag_mail',
    ]);
    const end = last(t.events);
    expect(end).toMatchObject({
      state: 'done',
      calls: 4,
      note: 'Tagged 3 invoices among 5 emails',
      tally: [
        { tool: 'tag_mail', calls: 3 },
        { tool: 'list_mail', calls: 1 },
      ],
    });
    expect(end?.script).toContain('tools.list_mail');
    const calls = t.events.filter((e) => e.type === 'script.call');
    expect(calls.filter((c) => c.status === 'running')).toHaveLength(4);
    expect(calls.filter((c) => c.status === 'success').map((c) => c.step)).toEqual([1, 2, 3, 4]);
  });

  it('runs each call inside its step, so a question it asks can say which', async () => {
    let seen: unknown;
    const t = turn([
      tool('send', async () => {
        seen = scriptStep.getStore();
        return 'sent';
      }),
    ]);
    await runScript(t.host, {
      title: 'Send it',
      script: 'await tools.send({}); await tools.send({});',
    });
    expect(seen).toMatchObject({ step: 2, title: 'Send it' });
  });

  it('gates one call at a time, even when the script calls many at once', async () => {
    let inGate = 0;
    let most = 0;
    const t = turn([tool('look', async () => 'ok')], {
      authorize: async () => {
        inGate++;
        most = Math.max(most, inGate);
        await new Promise((r) => setTimeout(r, 5));
        inGate--;
        return undefined;
      },
    });
    const outcome = await runScript(t.host, {
      title: 'Look at many',
      script:
        'await Promise.all(Array.from({ length: 12 }, (_, i) => tools.look({ n: i }))); return "ok";',
    });
    expect(outcome.ok).toBe(true);
    expect(t.gated).toHaveLength(12);
    expect(most).toBe(1);
  });

  it('throws a declined call in the script, never skipping it quietly', async () => {
    const t = turn([tool('send', async () => 'sent'), tool('look', async () => 'ok')], {
      authorize: async (display) =>
        display.endsWith('send')
          ? { message: 'The user declined this action.', declined: true }
          : undefined,
    });
    const caught = await runScript(t.host, {
      title: 'Send, or not',
      script: `
        try { await tools.send({ to: 'anna@example.com' }); return 'sent anyway'; }
        catch (e) { return e.name + ': ' + e.declined + ': ' + e.tool; }
      `,
    });
    expect(caught.text).toContain('Declined: true: send');
    expect(t.ran.map((r) => r.name)).toEqual([]);

    const uncaught = await runScript(t.host, {
      title: 'Send, then look',
      script:
        "await tools.send({ to: 'anna@example.com' }); await tools.look({}); return 'all done';",
    });
    expect(uncaught.ok).toBe(false);
    expect(uncaught.text).toMatch(/stopped at line 1: the person said no to a send call/);
    expect(uncaught.text).not.toContain('all done');
    // What came after the no never ran.
    expect(t.ran).toEqual([]);
    expect(last(t.events)).toMatchObject({
      state: 'failed',
      tally: [{ tool: 'send', declined: 1 }],
    });
  });

  it('throws what a rule said, and a tool’s own failure, in the script', async () => {
    const t = turn(
      [
        tool('off', async () => 'never'),
        tool('broken', async () => ({ text: 'The disk is full.', isError: true })),
      ],
      {
        authorize: async (display) =>
          display.endsWith('off')
            ? { message: 'The user turned this tool off in Apps.', declined: false }
            : undefined,
      },
    );
    const outcome = await runScript(t.host, {
      title: 'Try both',
      script: `
        const said = [];
        for (const name of ['off', 'broken']) {
          try { await tools[name]({}); } catch (e) { said.push(e.name + ': ' + e.message); }
        }
        return said;
      `,
    });
    expect(outcome.text).toContain('ToolError: The user turned this tool off in Apps.');
    expect(outcome.text).toContain('ToolError: The disk is full.');
  });

  it('says what a tool it doesn’t have is, and what is close', async () => {
    const t = turn([tool('google_mail_search', async () => '[]')]);
    const outcome = await runScript(t.host, {
      title: 'Search',
      script: 'try { await tools.mail_search({}); } catch (e) { return e.message; }',
    });
    expect(outcome.text).toContain(
      'There’s no tool called mail_search here. Did you mean google_mail_search?',
    );
    const nested = await runScript(t.host, {
      title: 'Nest',
      script: 'try { await tools.run_script({}); } catch (e) { return e.message; }',
    });
    expect(nested.text).toContain('scripts don’t start scripts');
  });

  it('checks a call’s input the way a call from the model is checked', async () => {
    const t = turn([tool('count', async (args) => `n=${String(args.n)}`, { n: z.number() })]);
    const outcome = await runScript(t.host, {
      title: 'Count',
      script: "try { await tools.count({ n: 'three' }); } catch (e) { return e.message; }",
    });
    expect(outcome.text).toMatch(/count/);
    expect(t.ran).toEqual([]);
    expect(t.gated).toEqual([]);
  });

  it('stops at its cap on tool calls', async () => {
    const t = turn([tool('look', async () => 'ok')]);
    const outcome = await runScript(t.host, {
      title: 'Look forever',
      calls: 5,
      script:
        'for (let i = 0; i < 100; i++) { try { await tools.look({ n: i }); } catch {} } return "never";',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('reached its limit of 5 tool calls');
    expect(t.ran).toHaveLength(5);
    expect(last(t.events)).toMatchObject({ state: 'failed', stop: 'calls', calls: 5 });
  });

  it('stops a script that runs past its time, and kills it', async () => {
    const t = turn([]);
    const started = Date.now();
    const outcome = await runScript(t.host, {
      title: 'Spin',
      seconds: 1,
      tickMs: 50,
      script: 'while (true) {}',
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('ran out of time after 1 seconds');
    expect(last(t.events)).toMatchObject({ state: 'failed', stop: 'time' });
  });

  it('doesn’t count the time a question waits for the person', async () => {
    const t = turn([tool('send', async () => 'sent')], {
      authorize: async () => {
        await new Promise((r) => setTimeout(r, 1_500));
        return undefined;
      },
    });
    const outcome = await runScript(t.host, {
      title: 'Wait for a yes',
      seconds: 1,
      tickMs: 50,
      script: 'await tools.send({}); return "sent";',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('sent');
  });

  it('stops when the turn stops, killing the process', async () => {
    const t = turn([tool('slow', () => new Promise((r) => setTimeout(() => r('late'), 30_000)))]);
    setTimeout(() => t.abort.abort(), 300);
    const started = Date.now();
    const outcome = await runScript(t.host, {
      title: 'Slow',
      script: 'await tools.slow({}); return "finished";',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('stopped before it finished');
    expect(last(t.events)).toMatchObject({ state: 'stopped', stop: 'you' });
  });

  it('stops a script that runs out of memory', async () => {
    const t = turn([]);
    const outcome = await runScript(t.host, {
      title: 'Hoard',
      script: 'const all = []; while (true) all.push(new Array(1e6).fill(Math.random()));',
    });
    expect(outcome.ok).toBe(false);
    expect(last(t.events)).toMatchObject({ state: 'failed', stop: 'memory' });
    expect(outcome.text).toContain('ran out of memory');
  }, 60_000);

  it('cuts what comes back, and says how much more there was', async () => {
    const t = turn([]);
    const outcome = await runScript(t.host, {
      title: 'Say a lot',
      script: 'for (let i = 0; i < 1000; i++) console.log("line " + i); return "x".repeat(50000);',
    });
    expect(outcome.text).toMatch(/… [\d,]+ more lines not shown\./);
    expect(outcome.text).toMatch(/more characters/);
    expect(outcome.text.length).toBeLessThan(25_000);
  });

  it('has no network, files, programs or environment of its own', async () => {
    const t = turn([]);
    const outcome = await runScript(t.host, {
      title: 'Try to get out',
      script: `
        const tries = {};
        const attempt = async (name, fn) => {
          try { tries[name] = 'reached: ' + String(await fn()).slice(0, 40); }
          catch (e) { tries[name] = 'refused'; }
        };
        await attempt('fetch', () => fetch('https://example.com'));
        await attempt('fs', () => import('node:fs'));
        await attempt('child', () => import('node:child_process'));
        await attempt('net', () => import('node:net'));
        await attempt('eval', () => eval('1 + 1'));
        await attempt('Function', () => new Function('return 1')());
        await attempt('require', () => require('fs'));
        await attempt('env', () => { if (Object.keys(process.env).length) return 'env'; throw new Error('empty'); });
        await attempt('builtin', () => process.getBuiltinModule('fs'));
        await attempt('elsewhere', async () => {
          const r = await app.fetch('https://example.com');
          return r.status;
        });
        return tries;
      `,
    });
    const tries = JSON.parse(
      /It returned:\n([\s\S]*?)\n\n/.exec(outcome.text)?.[1] ?? '{}',
    ) as Record<string, string>;
    expect(Object.keys(tries)).toHaveLength(10);
    for (const [name, said] of Object.entries(tries))
      expect([name, said]).toEqual([name, 'refused']);
  });

  it('says where a script doesn’t parse, and takes TypeScript', async () => {
    const t = turn([tool('look', async () => '{"n": 2}')]);
    const broken = await runScript(t.host, {
      title: 'Broken',
      script: 'const a = 1;\nconst b = ;\nreturn a;',
    });
    expect(broken.ok).toBe(false);
    expect(broken.text).toMatch(/doesn’t parse \(line 2\)/);
    const typed = await runScript(t.host, {
      title: 'Typed',
      script:
        'interface Found { n: number }\nconst found: Found = await tools.look({});\nreturn found.n * 2;',
    });
    expect(typed.ok).toBe(true);
    expect(typed.text).toContain('It returned:\n4');
  });

  it('says the line a script failed on', async () => {
    const t = turn([]);
    const outcome = await runScript(t.host, {
      title: 'Fail',
      script: 'const a = {};\n\nreturn a.b.c;',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toMatch(/stopped at line 3 with TypeError/);
  });
});

describe('what a call gives back, and what the chat keeps of it', () => {
  it('is the tool’s JSON when it is JSON, else its words', () => {
    expect(valueOf('{"a":1}')).toEqual({ a: 1 });
    expect(valueOf('[1,2]')).toEqual([1, 2]);
    expect(valueOf('Sent to Anna.')).toBe('Sent to Anna.');
    expect(valueOf('{not json')).toBe('{not json');
  });

  it('keeps an input as JSON, long words shortened, so who it went to can still be read', () => {
    const to = Array.from({ length: 40 }, (_, i) => `person${i}@example.com`);
    const kept = keptInput({ to, body: 'x'.repeat(10_000) });
    expect(kept.length).toBeLessThan(2_100);
    expect((JSON.parse(kept) as { to: string[] }).to).toHaveLength(40);
  });
});
