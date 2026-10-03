import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineStatus, Integration } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { ConversationManager, notConnectedPrompt } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import { MockEngine } from '../engines/mock/engine';
import type {
  Engine,
  EngineEvent,
  EngineIntegrations,
  EngineMcpStatus,
  TurnInput,
} from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { type HostedApps, IntegrationService } from './service';
import type { StoredIntegration } from './store';

/** A provider that answers at once and remembers what it was told. */
class FakeEngine implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly turns: TurnInput[] = [];
  mcpStatus?: () => Promise<EngineMcpStatus[]>;

  constructor(
    readonly integrations: EngineIntegrations = { mode: 'bridge' },
    servers?: () => Promise<EngineMcpStatus[]>,
  ) {
    if (servers) this.mcpStatus = servers;
  }

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
    this.turns.push(input);
    yield { type: 'session', resumeId: 's1' };
    yield { type: 'text', messageId: `m${this.turns.length}`, delta: 'Here you go.' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function service(engine: Engine, extra: { hosted?: HostedApps } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-suggest-'));
  const integrations = new IntegrationService({
    ...extra,
    home,
    emit: () => {},
    engines: async () => [engine],
    cwd: async () => home,
    manualChecks: true,
    providerWaitMs: 200,
  });
  return { integrations, home };
}

/** Put an integration in the store the way connecting one would leave it. */
async function connected(
  integrations: IntegrationService,
  fields: Partial<StoredIntegration> & Pick<StoredIntegration, 'name'>,
) {
  const now = Date.now();
  await integrations.store.add(
    {
      id: `int_${fields.name.toLowerCase().replace(/\W/g, '')}`,
      server: fields.name.toLowerCase().replace(/\W/g, '-'),
      transport: { type: 'http', url: 'https://mcp.example.com/mcp' },
      auth: 'oauth',
      enabled: true,
      policy: 'ask-writes',
      health: { state: 'ok', checkedAt: now, okAt: now },
      tools: [],
      values: {},
      secrets: [],
      createdAt: now,
      updatedAt: now,
      ...fields,
    },
    { values: {} },
  );
}

const ids = (found: { offers: { catalogId: string }[] }) => found.offers.map((s) => s.catalogId);
const nothing = { offers: [], unseen: [] };

describe('what gets suggested', () => {
  it('offers an app the message is about, with what the card shows', async () => {
    const { integrations } = await service(new MockEngine());
    const found = await integrations.suggest(
      'what’s assigned to me in Linear this week?',
      new MockEngine(),
    );
    expect(found).toEqual({
      offers: [
        {
          catalogId: 'linear',
          name: 'Linear',
          description: 'Find, create and update issues and projects.',
          color: '#5E6AD2',
        },
      ],
      unseen: ['Linear'],
    });
  });

  it('never offers one that’s connected in Conch, in any state, or added by hand', async () => {
    const engine = new MockEngine();
    const { integrations } = await service(engine);
    await connected(integrations, { name: 'Linear', catalogId: 'linear' });
    await connected(integrations, {
      name: 'Notion',
      catalogId: 'notion',
      health: { state: 'needs-auth' },
    });
    // Added by address, before the catalog had it: still Sentry.
    await connected(integrations, {
      name: 'Sentry',
      transport: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
    });
    await connected(integrations, { name: 'Canva', catalogId: 'canva', enabled: false });
    expect(
      await integrations.suggest(
        'what’s in Linear, my Notion page, the errors in Sentry and my Canva designs?',
        engine,
      ),
    ).toEqual(nothing);
  });

  it('never offers what the provider’s own account already reaches', async () => {
    // The mock's account has Google Calendar connected, and Gmail signed out.
    const engine = new MockEngine();
    const { integrations } = await service(engine);
    expect(await integrations.suggest('what’s on my calendar tomorrow?', engine)).toEqual(nothing);
    expect(ids(await integrations.suggest('what did I miss in my inbox?', engine))).toEqual([
      'gmail',
    ]);
  });

  it('never offers what the provider set up by itself', async () => {
    const engine = new FakeEngine({ mode: 'native' }, async () => [
      { name: 'linear', status: 'connected', source: 'engine', toolCount: 20 },
      { name: 'notion', status: 'failed', source: 'engine', toolCount: 0 },
    ]);
    const { integrations } = await service(engine);
    expect(
      ids(await integrations.suggest('copy my Linear tickets to a Notion page', engine)),
    ).toEqual(['notion']);
  });

  it('says nothing when the provider can’t say what it has', async () => {
    const broken = new FakeEngine({ mode: 'native' }, () => Promise.reject(new Error('down')));
    const one = await service(broken);
    expect(await one.integrations.suggest('check my Linear inbox', broken)).toEqual(nothing);

    const slow = new FakeEngine({ mode: 'native' }, () => new Promise(() => {}));
    const two = await service(slow);
    expect(await two.integrations.suggest('check my Linear inbox', slow)).toEqual(nothing);
  });

  it('offers direct Google for every provider, independently of Zapier', async () => {
    const engine = new FakeEngine();
    const { integrations } = await service(engine);
    expect(ids(await integrations.suggest('check my Gmail inbox', engine))).toEqual(['gmail']);
    await connected(integrations, { name: 'Zapier', catalogId: 'zapier' });
    expect(ids(await integrations.suggest('check my Gmail inbox', engine))).toEqual(['gmail']);
  });

  it('offers Slack to every provider, and not once Slack is connected to Conch', async () => {
    const engine = new FakeEngine();
    const before = await service(engine);
    expect(ids(await before.integrations.suggest('catch me up on Slack', engine))).toEqual([
      'slack',
    ]);
    // Slack connected to Conch is one of its own apps, listed like any other (ADR 0052).
    const slack = { id: 'slack', catalogId: 'slack' } as Integration;
    const after = await service(engine, {
      hosted: {
        owns: (id: string) => id === 'slack',
        list: async () => [slack],
      } as unknown as HostedApps,
    });
    expect(await after.integrations.suggest('catch me up on Slack', engine)).toEqual(nothing);
  });

  it('leaves out what was offered already or muted, and never more than two', async () => {
    const engine = new FakeEngine();
    const { integrations } = await service(engine);
    const text = 'move the Jira tickets into Linear, then post a summary to Slack and Notion';
    expect(ids(await integrations.suggest(text, engine))).toEqual(['atlassian', 'linear']);
    const later = await integrations.suggest(text, engine, new Set(['atlassian', 'linear']));
    // Slack is Conch's own (ADR 0049): offered for every provider, never through Zapier.
    expect(ids(later)).toEqual(['slack', 'notion']);
    // What isn't offered again is still named as unseen: the assistant must not pretend.
    expect(later.unseen).toEqual(['Jira & Confluence', 'Linear', 'Slack', 'Notion']);
  });

  it('tells the assistant plainly, in a few lines, for every provider', () => {
    expect(notConnectedPrompt([])).toBe('');
    const offered = notConnectedPrompt(['Linear'], ['Linear']);
    expect(offered).toMatch(/Linear isn’t connected/);
    expect(offered).toMatch(/a button in the chat to connect Linear/);
    expect(offered).toMatch(/Don’t pretend to have Linear data/);
    expect(offered).not.toMatch(/Claude|Codex/);
    expect(offered.split('\n').length).toBeLessThanOrEqual(3);
    const quiet = notConnectedPrompt(['Linear', 'Notion']);
    expect(quiet).toMatch(/Linear and Notion aren’t connected/);
    expect(quiet).not.toMatch(/button/);
  });
});

describe('the conversation', () => {
  async function chat(options: { muted?: string[] } = {}) {
    const engine = new FakeEngine();
    const { integrations, home } = await service(engine);
    const settings = new SettingsStore(home);
    await settings.update({
      preferences: { autoTitle: false, mutedSuggestions: options.muted ?? [] },
    });
    const store = new ConversationStore(join(home, 'conversations'));
    const make = () =>
      new ConversationManager({
        store,
        settings,
        memory: new MemoryStore(join(home, 'memory')),
        engine: () => engine,
        integrations,
      });
    const manager = make();
    const idle = async (id: string) => {
      await vi.waitFor(async () => {
        const { conversation } = await manager.detail(id);
        expect(conversation.status).toBe('idle');
      });
    };
    let n = 0;
    const say = async (text: string, conversationId?: string) => {
      const summary = await manager.send({ conversationId, clientMessageId: `u${++n}`, text });
      await idle(summary.id);
      return summary.id;
    };
    const offers = async (id: string) =>
      (await manager.detail(id)).events.flatMap((e) => (e.type === 'offer' ? [e.offer] : []));
    return { manager, make, engine, integrations, say, offers };
  }

  it('offers an app once per conversation, right after the message, and tells the turn', async () => {
    const { manager, engine, say, offers } = await chat();
    const id = await say('what’s assigned to me in Linear this week?');
    const { events } = await manager.detail(id);
    // Straight after the message (and the turn starting), before any of the reply.
    const kinds = events.map((e) => e.type).filter((type) => type !== 'status');
    expect(kinds.slice(0, 3)).toEqual(['user.message', 'offer', 'assistant.delta']);
    // Noticed in the person's words, and it carries on with them, as typed.
    expect(await offers(id)).toMatchObject([
      {
        kind: 'app',
        target: 'linear',
        name: 'Linear',
        by: 'cue',
        resume: { request: 'what’s assigned to me in Linear this week?' },
      },
    ]);
    expect(engine.turns[0]?.systemAppend).toMatch(/Linear isn’t connected/);

    await say('and what about Linear next week?', id);
    expect(await offers(id)).toHaveLength(1);
    // Not offered again, but still told it can't see Linear.
    expect(engine.turns[1]?.systemAppend).toMatch(/Linear isn’t connected/);
    expect(engine.turns[1]?.systemAppend).not.toMatch(/button/);
  });

  it('says nothing about an app once it’s connected', async () => {
    const { integrations, engine, say, offers } = await chat();
    await connected(integrations, { name: 'Linear', catalogId: 'linear' });
    expect(await offers(await say('what’s assigned to me in Linear?'))).toEqual([]);
    expect(engine.turns[0]?.systemAppend).not.toMatch(/Not connected yet/);
  });

  it('never offers an app that was muted', async () => {
    const { engine, say, offers } = await chat({ muted: ['linear'] });
    expect(await offers(await say('what’s assigned to me in Linear?'))).toEqual([]);
    expect(engine.turns[0]?.systemAppend).toMatch(/Linear isn’t connected/);
    expect(engine.turns[0]?.systemAppend).not.toMatch(/button/);
  });

  it('keeps the offer, and “Not now”, through a reload', async () => {
    const { manager, make, say, offers } = await chat();
    const id = await say('find my notes in Notion');
    const [offer] = await offers(id);
    if (!offer) throw new Error('No offer.');
    await manager.dismissOffer(id, offer.offerId);
    await manager.dismissOffer(id, offer.offerId);
    await expect(manager.dismissOffer(id, 'of_nothing')).rejects.toThrow(/wasn’t offered/);

    const reloaded = make();
    const { events } = await reloaded.detail(id);
    expect(events.filter((e) => e.type === 'offer')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'offer.resolved')).toEqual([
      expect.objectContaining({ offerId: offer.offerId, outcome: 'dismissed' }),
    ]);
    // Still once, after the reload too.
    await reloaded.send({ conversationId: id, clientMessageId: 'again', text: 'Notion again?' });
    await vi.waitFor(async () =>
      expect((await reloaded.detail(id)).conversation.status).toBe('idle'),
    );
    expect(await offers(id)).toHaveLength(1);
  });

  it('never offers anything in an unattended run, but still says what it can’t see', async () => {
    const { manager, engine, offers } = await chat();
    const run = await manager.start({
      title: 'Morning check',
      text: 'what’s assigned to me in Linear today?',
      origin: { kind: 'routine', routineId: 'r1', runId: 'run1' },
      extras: {},
    });
    await run.result;
    expect(await offers(run.conversationId)).toEqual([]);
    expect(engine.turns[0]?.systemAppend).toMatch(/Linear isn’t connected/);
    expect(engine.turns[0]?.systemAppend).not.toMatch(/button/);
  });

  it('reads only what the person typed', async () => {
    const { say, offers } = await chat();
    expect(
      await offers(await say('```\nimport { LinearClient } from "@linear/sdk";\n```')),
    ).toEqual([]);
  });
});
