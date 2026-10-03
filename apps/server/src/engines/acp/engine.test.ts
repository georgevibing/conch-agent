import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { LoginState } from '@conch/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { SettingsStore } from '../../settings/store';
import { collect } from '../api/fake';
import type { HostTool, TurnInput } from '../types';
import { ACP_AGENTS, type AcpAgent } from './agents';
import { AcpEngine, deviceSignIn, forDoor, offerOf, preamble } from './engine';
import { fakeSpawn, type AgentScript } from './fake';

async function settings() {
  return new SettingsStore(await mkdtemp(join(tmpdir(), 'conch-acp-')));
}

async function engineWith(script: AgentScript, agent: AcpAgent = ACP_AGENTS.copilot) {
  const fake = fakeSpawn(script);
  const engine = new AcpEngine(agent, await settings(), {
    spawn: fake.spawn,
    find: async () => 'C:/fake/agent.exe',
    version: async () => '1.0.91',
    signedInBefore: () => undefined,
  });
  return { engine, agents: fake.agents };
}

function rememberTool(saved: string[]): HostTool {
  const tool: HostTool<{ content: z.ZodString }> = {
    name: 'remember',
    description: 'Save one durable fact.',
    input: { content: z.string() },
    run: async ({ content }) => {
      saved.push(content);
      return 'Saved to memory.';
    },
  };
  return tool as HostTool;
}

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c_1',
    prompt: 'Remember I like tea',
    systemAppend: 'You are Pearl.',
    cwd: process.cwd(),
    tools: [],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  };
}

const configModels = {
  sessionId: 'sess_1',
  configOptions: [
    {
      id: 'model',
      category: 'model',
      type: 'select',
      currentValue: 'gpt-5.1',
      options: [
        { value: 'gpt-5.1', name: 'GPT-5.1' },
        {
          group: 'More',
          name: 'More',
          options: [{ value: 'claude-sonnet-5', name: 'Claude Sonnet 5' }],
        },
      ],
    },
    {
      id: 'reasoning_effort',
      category: 'thought_level',
      type: 'select',
      options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
    },
  ],
};

describe('an ACP agent’s state', () => {
  it('is ready when a session opens, and lists the models the session offered', async () => {
    const { engine } = await engineWith({ session: () => configModels });
    const status = await engine.detect();
    expect(status).toMatchObject({
      engine: 'copilot',
      state: 'ready',
      version: '9.9.9',
      auth: { method: 'subscription', description: 'Your GitHub Copilot plan' },
    });
    const caps = await engine.capabilities();
    expect(caps.models.map((m) => [m.id, m.label, m.efforts])).toEqual([
      ['gpt-5.1', 'GPT-5.1', ['low', 'medium', 'high']],
      ['claude-sonnet-5', 'Claude Sonnet 5', ['low', 'medium', 'high']],
    ]);
  });

  it('is signed out when the agent wants a sign-in', async () => {
    const { engine } = await engineWith({
      session: () => ({ error: { code: -32000, message: 'Authentication required' } }),
    });
    expect(await engine.detect()).toMatchObject({
      state: 'signed-out',
      message: 'Sign in with GitHub to use your Copilot plan. No key is needed.',
    });
  });

  it('offers to install the program when it isn’t here, and to update an old one', async () => {
    const missing = new AcpEngine(ACP_AGENTS.copilot, await settings(), {
      find: async () => undefined,
    });
    expect(await missing.detect()).toMatchObject({
      state: 'not-installed',
      fix: { need: 'copilot', kind: 'install' },
    });
    const old = new AcpEngine(ACP_AGENTS.copilot, await settings(), {
      find: async () => 'C:/fake/copilot.exe',
      version: async () => '1.0.20',
    });
    expect(await old.detect()).toMatchObject({
      state: 'error',
      fix: { need: 'copilot', kind: 'update' },
    });
  });

  it('doesn’t start a program that was never signed in', async () => {
    const fake = fakeSpawn({});
    const engine = new AcpEngine(ACP_AGENTS['gemini-cli'], await settings(), {
      spawn: fake.spawn,
      find: async () => 'C:/fake/gemini.cmd',
      version: async () => '0.62.0',
      signedInBefore: () => false,
    });
    expect(await engine.detect()).toMatchObject({ state: 'signed-out' });
    expect(fake.agents).toHaveLength(0);
  });

  it('reads the older model list Gemini still sends', () => {
    const offer = offerOf(
      {
        sessionId: 's',
        models: {
          currentModelId: 'auto',
          availableModels: [
            { modelId: 'auto', name: 'Auto' },
            { modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
          ],
        },
      },
      false,
    );
    expect(offer.how).toBe('legacy');
    expect(offer.models.map((m) => m.id)).toEqual(['auto', 'gemini-2.5-pro']);
    expect(offerOf({ sessionId: 's' }, true)).toMatchObject({
      how: 'start',
      models: [{ id: 'default', label: 'Default' }],
    });
  });
});

describe('a turn with an ACP agent', () => {
  it('streams the answer, and hands the conversation over with Conch’s instructions first', async () => {
    const { engine, agents } = await engineWith({
      prompt: async (t) => {
        t.update({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Thinking…' },
        });
        t.update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Noted: ' },
        });
        t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'tea.' } });
        return { stopReason: 'end_turn', usage: { inputTokens: 40, outputTokens: 5 } };
      },
    });
    const events = await collect(engine.runTurn(turn()));
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { delta: string }).delta)
        .join(''),
    ).toBe('Noted: tea.');
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'success',
      usage: { inputTokens: 40, outputTokens: 5 },
    });
    const prompt = agents[0]?.received.find((m) => m.method === 'session/prompt')?.params as {
      prompt: { text: string }[];
    };
    expect(prompt.prompt[0]?.text).toContain('You are Pearl.');
    expect(prompt.prompt.at(-1)?.text).toBe('Remember I like tea');
    // The session is closed after the turn when the agent can; the program stays warm for the next.
    expect(agents).toHaveLength(1);
  });

  it('hands Conch’s tools over through the door, and runs them under Conch’s rules', async () => {
    const saved: string[] = [];
    let door: { url: string; headers: { name: string; value: string }[] } | undefined;
    const { engine } = await engineWith({
      session: (params) => {
        const servers = params.mcpServers as {
          type: string;
          url: string;
          headers: { name: string; value: string }[];
        }[];
        door = servers[0];
        return { sessionId: 'sess_door' };
      },
      prompt: async () => {
        if (!door) throw new Error('No door');
        const client = new Client({ name: 'pretend-agent', version: '1' });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(door.url), {
            requestInit: {
              headers: Object.fromEntries(door.headers.map((h) => [h.name, h.value])),
            },
          }),
        );
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toContain('mcp__conch__remember');
        const result = await client.callTool({
          name: 'mcp__conch__remember',
          arguments: { content: 'likes tea' },
        });
        expect(result.content).toEqual([{ type: 'text', text: 'Saved to memory.' }]);
        await client.close();
        return { stopReason: 'end_turn' };
      },
    });
    const events = await collect(engine.runTurn(turn({ tools: [rememberTool(saved)] })));
    expect(saved).toEqual(['likes tea']);
    expect(events.find((e) => e.type === 'tool-start')).toMatchObject({
      name: 'mcp__conch__remember',
      input: { content: 'likes tea' },
    });
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({
      status: 'success',
      output: 'Saved to memory.',
    });
    expect(door?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('lets the agent through to Conch’s tools, and declines its own', async () => {
    const answers: unknown[] = [];
    const { engine } = await engineWith({
      prompt: async (t) => {
        const options = [
          { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'allow_always', kind: 'allow_always', name: 'Always allow' },
          { optionId: 'reject_once', kind: 'reject_once', name: 'Deny' },
        ];
        answers.push(
          await t.ask('session/request_permission', {
            sessionId: t.sessionId,
            toolCall: { toolCallId: 'a', title: 'conch/mcp__conch__remember', kind: 'other' },
            options,
          }),
        );
        answers.push(
          await t.ask('session/request_permission', {
            sessionId: t.sessionId,
            toolCall: {
              toolCallId: 'b',
              title: 'rm -rf build',
              kind: 'execute',
              rawInput: { command: 'rm -rf build' },
            },
            options,
          }),
        );
        return { stopReason: 'end_turn' };
      },
    });
    await collect(engine.runTurn(turn({ tools: [rememberTool([])] })));
    expect(answers).toEqual([
      { outcome: { outcome: 'selected', optionId: 'allow_always' } },
      { outcome: { outcome: 'selected', optionId: 'reject_once' } },
    ]);
  });

  it('chooses the model the way the agent takes it: a config option, the older call, or at start', async () => {
    const { engine, agents } = await engineWith(
      { session: () => configModels },
      { ...ACP_AGENTS.copilot, modelAtStart: false },
    );
    await collect(
      engine.runTurn(
        turn({
          options: {
            effort: 'high',
            fastMode: false,
            permissionMode: 'default',
            model: 'claude-sonnet-5',
          },
        }),
      ),
    );
    const sets = agents[0]?.received
      .filter((m) => m.method === 'session/set_config_option')
      .map((m) => m.params);
    expect(sets).toEqual([
      { sessionId: 'sess_1', configId: 'model', value: 'claude-sonnet-5' },
      { sessionId: 'sess_1', configId: 'reasoning_effort', value: 'high' },
    ]);

    const copilot = await engineWith({});
    await collect(
      copilot.engine.runTurn(
        turn({
          options: { effort: 'auto', fastMode: false, permissionMode: 'default', model: 'gpt-5.1' },
        }),
      ),
    );
    // Copilot takes its model when it starts: a program per model.
    expect(
      copilot.agents.at(-1)?.received.some((m) => m.method === 'session/set_config_option'),
    ).toBe(false);
  });

  it('stops when you stop it', async () => {
    const stop = new AbortController();
    const { engine, agents } = await engineWith({
      prompt: async (t) => {
        t.update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Working' },
        });
        stop.abort();
        await t.cancelled();
        return { stopReason: 'cancelled' };
      },
    });
    const events = await collect(engine.runTurn(turn({ signal: stop.signal })));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted' });
    expect(agents[0]?.received.some((m) => m.method === 'session/cancel')).toBe(true);
  });

  it('says a signed-out agent needs a sign-in, as a problem the chat can offer help for', async () => {
    let first = true;
    const { engine } = await engineWith({
      session: () => {
        if (first) {
          first = false;
          return { sessionId: 'ok' };
        }
        return { error: { code: -32000, message: 'Authentication required' } };
      },
    });
    await engine.detect();
    const events = await collect(engine.runTurn(turn()));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'error', problem: 'signed-out' });
  });

  it('says a rate limit is a limit, so the chat can hand the turn on', async () => {
    const { engine } = await engineWith({
      prompt: async () => {
        throw { code: 429, message: 'Rate limit exceeded. Try again later.' };
      },
    });
    const events = await collect(engine.runTurn(turn()));
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'error',
      error: 'Rate limit exceeded. Try again later.',
      problem: 'limit',
    });
  });
});

describe('words and checks', () => {
  it('puts Conch’s instructions first, and says where the tools are', () => {
    const text = preamble('You are Pearl.', true);
    expect(text).toContain('You are Pearl.');
    expect(text).toContain('"conch" server');
    expect(preamble('x', false)).toContain('no tools');
  });

  it('recognises a request for one of the door’s tools in every way agents name them', () => {
    const tools = new Set(['mcp__conch__remember', 'Read']);
    expect(forDoor({ title: 'conch/mcp__conch__remember' }, tools)).toBe(true);
    expect(forDoor({ title: 'mcp__conch__Read' }, tools)).toBe(true);
    expect(forDoor({ name: 'conch__Read' }, tools)).toBe(true);
    expect(forDoor({ title: 'Read (conch MCP Server)' }, tools)).toBe(true);
    expect(forDoor({ title: 'Read file notes.txt', kind: 'read' }, tools)).toBe(false);
    expect(forDoor({ title: 'conch/rm' }, tools)).toBe(false);
    expect(forDoor(undefined, tools)).toBe(false);
  });

  it('reads a device sign-in only from the provider’s own pages', () => {
    const hosts = ACP_AGENTS.copilot.login.kind === 'command' ? ACP_AGENTS.copilot.login.hosts : [];
    expect(
      deviceSignIn('Open https://github.com/login/device and enter ABCD-1234.', hosts),
    ).toEqual({
      url: 'https://github.com/login/device',
      code: 'ABCD-1234',
    });
    expect(
      deviceSignIn('Open https://github.com.evil.example/login and enter ABCD-1234', hosts),
    ).toBeUndefined();
    expect(
      deviceSignIn('Open http://github.com/login/device and enter ABCD-1234', hosts),
    ).toBeUndefined();
  });
});

describe('signing in', () => {
  it('runs the program’s own device sign-in, shows its code, and starts afresh after', async () => {
    const fake = fakeSpawn({ session: () => configModels });
    const engine = new AcpEngine(ACP_AGENTS.copilot, await settings(), {
      spawn: fake.spawn,
      find: async () => 'C:/fake/copilot.exe',
      version: async () => '1.0.91',
      spawnLogin: () =>
        spawn(process.execPath, [
          '-e',
          "console.log('To sign in, open https://github.com/login/device and enter WDJB-MJHT'); setTimeout(() => process.exit(0), 50);",
        ]),
    });
    const states: LoginState[] = [];
    await new Promise<void>((resolve) => {
      engine.login('subscription', (state) => {
        states.push(state);
        if (['done', 'failed'].includes(state.phase)) resolve();
      });
    });
    expect(states.find((s) => s.phase === 'waiting-for-browser')).toMatchObject({
      url: 'https://github.com/login/device',
      code: 'WDJB-MJHT',
    });
    expect(states.at(-1)).toMatchObject({ phase: 'done' });
  });

  it('fails in words when the sign-in is declined', async () => {
    const engine = new AcpEngine(ACP_AGENTS.copilot, await settings(), {
      spawn: fakeSpawn({}).spawn,
      find: async () => 'C:/fake/copilot.exe',
      spawnLogin: () =>
        spawn(process.execPath, [
          '-e',
          "console.log('open https://github.com/login/device code ZZZZ-YYYY'); process.exit(1)",
        ]),
    });
    const final = await new Promise<LoginState>((resolve) => {
      engine.login('subscription', (state) => {
        if (['done', 'failed'].includes(state.phase)) resolve(state);
      });
    });
    expect(final).toMatchObject({
      phase: 'failed',
      message: expect.stringContaining('declined or expired'),
    });
  });
});
