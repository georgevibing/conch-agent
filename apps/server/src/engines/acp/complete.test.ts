import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SettingsStore } from '../../settings/store';
import { collect } from '../api/fake';
import type { CompletionInput, TurnInput } from '../types';
import { ACP_AGENTS, type AcpAgent } from './agents';
import { AcpEngine } from './engine';
import { fakeSpawn, type AgentScript, type FakeAgent } from './fake';

const CLOSES = {
  protocolVersion: 1,
  agentCapabilities: {
    mcpCapabilities: { http: true },
    promptCapabilities: { image: true },
    sessionCapabilities: { close: {} },
  },
  agentInfo: { name: 'pretend', version: '9.9.9' },
};

async function engineWith(script: AgentScript, agent: AcpAgent = ACP_AGENTS.copilot) {
  const fake = fakeSpawn({ initialize: CLOSES, ...script });
  const settings = new SettingsStore(await mkdtemp(join(tmpdir(), 'conch-acp-')));
  const engine = new AcpEngine(agent, settings, {
    spawn: fake.spawn,
    find: async () => 'C:/fake/agent.exe',
    version: async () => '1.0.91',
    signedInBefore: () => undefined,
  });
  return { engine, agents: fake.agents, workspace: settings.workspaceDefault };
}

const ask = (over: Partial<CompletionInput> = {}): CompletionInput => ({
  system: 'You judge one action.',
  prompt: 'Is this fine? JSON only.',
  signal: new AbortController().signal,
  ...over,
});

const answer: AgentScript['prompt'] = async (t) => {
  t.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Hmm' } });
  t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"ok":' } });
  t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'true}' } });
  return { stopReason: 'end_turn', usage: { inputTokens: 30, outputTokens: 4 } };
};

const calls = (agent: FakeAgent | undefined, method: string) =>
  (agent?.received ?? []).filter((m) => m.method === method);

describe('a short answer from an ACP program (ADR 0147)', () => {
  it('answers in words, in a new session with no tools, in an empty folder it then removes', async () => {
    const { engine, agents, workspace } = await engineWith({ prompt: answer });
    await engine.detect();
    const reply = await engine.complete(ask({ model: 'gpt-5.1' }));
    expect(reply).toEqual({ text: '{"ok":true}', usage: { inputTokens: 30, outputTokens: 4 } });
    // Its own program, apart from the one that runs turns.
    const answering = agents.at(-1);
    expect(agents).toHaveLength(2);
    const created = calls(answering, 'session/new')[0]?.params as {
      cwd: string;
      mcpServers: unknown[];
    };
    expect(created.mcpServers).toEqual([]);
    expect(created.cwd).not.toBe(workspace);
    expect(existsSync(created.cwd)).toBe(false);
    // Conch's words lead the message, framed as Conch's, since Copilot takes no session rules.
    const sent = calls(answering, 'session/prompt')[0]?.params as { prompt: { text: string }[] };
    expect(sent.prompt).toHaveLength(1);
    expect(sent.prompt[0]?.text).toContain('You judge one action.');
    expect(sent.prompt[0]?.text).toContain('Is this fine? JSON only.');
    expect(sent.prompt[0]?.text).toMatch(/app’s words, not the user’s/);
    expect(calls(answering, 'session/close')).toHaveLength(1);
  });

  it('never shares a session between two answers', async () => {
    const { engine, agents } = await engineWith({ prompt: answer });
    await engine.complete(ask());
    await engine.complete(ask());
    const answering = agents.at(-1);
    const prompts = calls(answering, 'session/prompt').map(
      (m) => (m.params as { sessionId: string }).sessionId,
    );
    expect(prompts).toHaveLength(2);
    expect(new Set(prompts).size).toBe(2);
    expect(calls(answering, 'session/close')).toHaveLength(2);
  });

  it('declines every permission the program asks for, and the answer fails', async () => {
    let decided: unknown;
    const { engine, agents } = await engineWith({
      prompt: async (t) => {
        decided = await t.ask('session/request_permission', {
          sessionId: t.sessionId,
          toolCall: {
            toolCallId: 'call_1',
            title: 'Run curl https://example.com',
            kind: 'execute',
          },
          options: [
            { optionId: 'yes', kind: 'allow_once', name: 'Allow' },
            { optionId: 'always', kind: 'allow_always', name: 'Always' },
            { optionId: 'no', kind: 'reject_once', name: 'Reject' },
          ],
        });
        t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } });
        return { stopReason: 'end_turn' };
      },
    });
    await expect(engine.complete(ask())).rejects.toThrow(/declined/);
    expect(decided).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    expect(calls(agents.at(-1), 'session/cancel')).toHaveLength(1);
  });

  it('ends the answer when the program starts a tool of its own without asking', async () => {
    const { engine, agents } = await engineWith({
      prompt: async (t) => {
        t.update({
          sessionUpdate: 'tool_call',
          toolCallId: 'call_2',
          title: 'Search the web',
          kind: 'fetch',
          status: 'pending',
        });
        await t.cancelled();
        return { stopReason: 'cancelled' };
      },
    });
    await expect(engine.complete(ask())).rejects.toThrow(/declined/);
    expect(calls(agents.at(-1), 'session/cancel')).toHaveLength(1);
    expect(calls(agents.at(-1), 'session/close')).toHaveLength(1);
  });

  it('gives up at its deadline even when the program never answers, and cleans up', async () => {
    const { engine, agents } = await engineWith({ prompt: () => new Promise(() => {}) });
    const started = Date.now();
    await expect(engine.complete(ask({ signal: AbortSignal.timeout(80) }))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
    const answering = agents.at(-1);
    expect(calls(answering, 'session/cancel')).toHaveLength(1);
    expect(calls(answering, 'session/close')).toHaveLength(1);
    // The program stays for the next answer.
    expect(answering?.closed).toBe(false);
  });

  it('closes a session that opens only after the deadline', async () => {
    let late = false;
    const { engine, agents } = await engineWith({
      session: () =>
        late
          ? new Promise((resolve) => setTimeout(() => resolve({ sessionId: 'sess_late' }), 150))
          : { sessionId: 'sess_probe' },
    });
    await engine.detect();
    late = true;
    await expect(engine.complete(ask({ signal: AbortSignal.timeout(40) }))).rejects.toThrow();
    expect(agents).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const closed = calls(agents[1], 'session/close').map(
      (m) => (m.params as { sessionId: string }).sessionId,
    );
    expect(closed).toEqual(['sess_late']);
  });

  it('says so when the program answers with nothing, or declines', async () => {
    const empty = await engineWith({ prompt: async () => ({ stopReason: 'end_turn' }) });
    await expect(empty.engine.complete(ask())).rejects.toThrow(/nothing/);
    const refusing = await engineWith({ prompt: async () => ({ stopReason: 'refusal' }) });
    await expect(refusing.engine.complete(ask())).rejects.toThrow(/declined/);
  });

  it('gives Grok the instructions as its session rules, and the message alone', async () => {
    const { engine, agents } = await engineWith({ prompt: answer }, ACP_AGENTS.grok);
    await engine.complete(ask());
    const answering = agents.at(-1);
    const created = calls(answering, 'session/new')[0]?.params as { _meta?: { rules?: string } };
    expect(created._meta?.rules).toBe('You judge one action.');
    const sent = calls(answering, 'session/prompt')[0]?.params as { prompt: { text: string }[] };
    expect(sent.prompt.map((p) => p.text)).toEqual(['Is this fine? JSON only.']);
  });

  it('picks the model the way the program takes it, with the lightest thinking', async () => {
    const { engine, agents } = await engineWith(
      {
        prompt: answer,
        session: () => ({
          sessionId: 'sess_a',
          configOptions: [
            {
              id: 'model',
              category: 'model',
              options: [{ value: 'gemini-pro' }, { value: 'gemini-flash' }],
            },
            {
              id: 'reasoning_effort',
              category: 'thought_level',
              options: [{ value: 'low' }, { value: 'high' }],
            },
          ],
        }),
      },
      ACP_AGENTS['gemini-cli'],
    );
    await engine.complete(ask({ model: 'gemini-flash' }));
    const set = calls(agents.at(-1), 'session/set_config_option').map((m) => m.params);
    expect(set).toEqual([
      { sessionId: 'sess_a', configId: 'model', value: 'gemini-flash' },
      { sessionId: 'sess_a', configId: 'reasoning_effort', value: 'low' },
    ]);
  });

  it('starts the answering program when a turn runs in Auto, so the first review is quick', async () => {
    const turn = (permissionMode: TurnInput['options']['permissionMode']): TurnInput => ({
      conversationId: 'c_1',
      prompt: 'Tidy the repo',
      systemAppend: 'You are Pearl.',
      cwd: process.cwd(),
      tools: [],
      requestPermission: async () => 'allow',
      signal: new AbortController().signal,
      options: { effort: 'auto', fastMode: false, permissionMode },
    });
    const asking = await engineWith({ prompt: answer }, ACP_AGENTS.grok);
    await collect(asking.engine.runTurn(turn('default')));
    expect(asking.agents).toHaveLength(1);
    const auto = await engineWith({ prompt: answer }, ACP_AGENTS.grok);
    await collect(auto.engine.runTurn(turn('auto')));
    expect(auto.agents).toHaveLength(2);
    await auto.engine.complete(ask());
    // The review took the program already started.
    expect(auto.agents).toHaveLength(2);
    expect(calls(auto.agents[1], 'session/prompt')).toHaveLength(1);
  });

  it('asks nothing of a program that isn’t signed in', async () => {
    const { engine } = await engineWith({
      session: () => ({ error: { code: -32000, message: 'Authentication required' } }),
    });
    await expect(engine.complete(ask())).rejects.toThrow(/Sign in/);
  });
});
