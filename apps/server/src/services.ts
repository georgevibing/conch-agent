import { join } from 'node:path';

import type { EngineId, LoginState, ServerEvent } from '@conch/protocol';

import { AccessStore } from './auth/store';
import { Gatekeeper } from './security';
import type { Config } from './config';
import { CommandStore } from './commands/store';
import { ConversationManager } from './conversations/manager';
import { ConversationStore } from './conversations/store';
import { ClaudeCodeEngine } from './engines/claude-code/engine';
import { MockEngine } from './engines/mock/engine';
import type { Engine, LoginHandle } from './engines/types';
import { Emitter } from './lib/emitter';
import { MemoryStore } from './memory/store';
import { RoutineService } from './routines/service';
import { SearchIndex } from './search/index';
import { SearchIndexer } from './search/indexer';
import { RoutineStore } from './routines/store';
import { SettingsStore } from './settings/store';
import { UsageService } from './usage/service';

export const SERVER_VERSION = '0.2.0';

/** Every past turn's cost, oldest conversations included. */
async function turnCosts(store: ConversationStore) {
  const turns: { at: number; costUsd: number }[] = [];
  for (const record of await store.list()) {
    for (const event of await store.events(record.id)) {
      if (event.type === 'turn.completed' && event.usage?.costUsd) {
        turns.push({ at: event.at, costUsd: event.usage.costUsd });
      }
    }
  }
  return turns;
}

/** Everything the HTTP layer needs, wired once. Tests build this with a temp home. */
export class Services {
  readonly broadcast = new Emitter<ServerEvent>();
  readonly settings: SettingsStore;
  /** Who may sign in (`~/.conch/access.json`). */
  readonly access: AccessStore;
  readonly gate: Gatekeeper;
  /** Files in CONCH_HOME whose permissions couldn't be tightened (see `secureHome`). */
  homeProblems: string[] = [];
  readonly memory: MemoryStore;
  readonly commands: CommandStore;
  readonly routines: RoutineService;
  readonly conversations: ConversationManager;
  readonly engines: Map<EngineId, Engine>;
  readonly usage: UsageService;
  /** Full-text search over every conversation; absent if the index can't be opened. */
  readonly search?: { index: SearchIndex; indexer: SearchIndexer };
  #login?: { handle: LoginHandle; state: LoginState };

  constructor(readonly config: Config) {
    this.settings = new SettingsStore(config.CONCH_HOME);
    this.access = new AccessStore(config.CONCH_HOME);
    this.gate = new Gatekeeper(config, this.access);
    this.memory = new MemoryStore(join(config.CONCH_HOME, 'memory'));
    this.commands = new CommandStore(join(config.CONCH_HOME, 'commands'));
    this.engines = new Map<EngineId, Engine>([
      ['claude-code', new ClaudeCodeEngine(this.settings, config.CONCH_CLAUDE_PATH)],
      [
        'mock',
        new MockEngine({
          state: process.env.CONCH_MOCK_STATE,
          speed: Number(process.env.CONCH_MOCK_SPEED ?? 1),
          installAfter: process.env.CONCH_MOCK_INSTALL_AFTER
            ? Number(process.env.CONCH_MOCK_INSTALL_AFTER)
            : undefined,
          usage: process.env.CONCH_MOCK_USAGE,
        }),
      ],
    ]);
    const conversationStore = new ConversationStore(join(config.CONCH_HOME, 'conversations'));
    this.conversations = new ConversationManager({
      store: conversationStore,
      settings: this.settings,
      memory: this.memory,
      engine: () => this.engine(),
      tools: (ctx) => this.routines.tools(ctx),
      context: () => this.routines.promptSection(),
      onSpend: (usage) => void this.usage.recordTurn(usage),
    });
    this.routines = new RoutineService({
      store: new RoutineStore(join(config.CONCH_HOME, 'routines')),
      conversations: this.conversations,
      engine: () => this.engine(),
      emit: (event) => this.broadcast.emit(event),
    });
    this.conversations.events.on((event) => this.broadcast.emit(event));
    this.memory.changed.on(() => this.broadcast.emit({ type: 'memory.changed' }));
    this.usage = new UsageService({
      home: config.CONCH_HOME,
      engine: () => this.engine(),
      history: () => turnCosts(conversationStore),
    });
    this.usage.changed.on((usage) => this.broadcast.emit({ type: 'usage.changed', usage }));
    this.conversations.events.on((event) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
        void this.usage.recordTurn(event.event.usage);
      }
    });
    this.usage.start();
    this.search = openSearch(config, conversationStore, this.conversations);
  }

  /** The active engine. Only Claude Code (and the mock) exist today; others fall back. */
  engine(): Engine {
    const id = this.config.CONCH_ENGINE ?? 'claude-code';
    return this.engines.get(id) ?? (this.engines.get('claude-code') as Engine);
  }

  async engineStatus(force = false) {
    const status = await this.engine().detect({ force });
    if (force) {
      this.broadcast.emit({ type: 'engine.status', status });
      // Signing in, out or switching accounts changes which limits apply.
      void this.usage.refresh({ force: true });
    }
    return status;
  }

  capabilities(force = false) {
    return this.engine().capabilities({ force });
  }

  get login() {
    return this.#login?.state;
  }

  startLogin(method: 'subscription' | 'console') {
    this.#login?.handle.cancel();
    const engine = this.engine();
    if (!engine.login) throw new Error(`${engine.label} doesn't support signing in from Conch.`);
    const handle = engine.login(method, (state) => {
      if (this.#login) this.#login.state = state;
      this.broadcast.emit({ type: 'engine.login', login: state });
      if (state.phase === 'done') void this.engineStatus(true);
    });
    this.#login = { handle, state: { loginId: 'pending', phase: 'starting' } };
  }

  submitLoginCode(code: string) {
    this.#login?.handle.submitCode(code);
  }

  cancelLogin() {
    this.#login?.handle.cancel();
    this.#login = undefined;
  }

  async setApiKey(apiKey: string | undefined) {
    const engine = this.engine();
    if (!engine.setApiKey) throw new Error(`${engine.label} doesn't accept API keys.`);
    await engine.setApiKey(apiKey);
    return this.engineStatus(true);
  }
}

/** The search index is derived data: if it can't be opened, Conch runs without search. */
function openSearch(
  config: Config,
  store: ConversationStore,
  conversations: ConversationManager,
): Services['search'] {
  try {
    const index = new SearchIndex(join(config.CONCH_HOME, 'search.db'));
    const indexer = new SearchIndexer(
      index,
      {
        list: () => store.list(),
        events: (id) => store.events(id),
        detail: (id) => conversations.detail(id),
      },
      (error) => console.error('[search]', error),
    );
    conversations.events.on((event) => indexer.onEvent(event));
    void indexer.start();
    return { index, indexer };
  } catch (error) {
    console.error('[search] index unavailable:', error);
    return undefined;
  }
}
