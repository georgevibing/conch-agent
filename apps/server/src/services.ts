import { join } from 'node:path';

import type { EngineId, LoginState, ServerEvent } from '@conch/protocol';

import type { Config } from './config';
import { CommandStore } from './commands/store';
import { ConversationManager } from './conversations/manager';
import { ConversationStore } from './conversations/store';
import { ClaudeCodeEngine } from './engines/claude-code/engine';
import { MockEngine } from './engines/mock/engine';
import type { Engine, LoginHandle } from './engines/types';
import { Emitter } from './lib/emitter';
import { MemoryStore } from './memory/store';
import { SettingsStore } from './settings/store';

export const SERVER_VERSION = '0.2.0';

/** Everything the HTTP layer needs, wired once. Tests build this with a temp home. */
export class Services {
  readonly broadcast = new Emitter<ServerEvent>();
  readonly settings: SettingsStore;
  readonly memory: MemoryStore;
  readonly commands: CommandStore;
  readonly conversations: ConversationManager;
  readonly engines: Map<EngineId, Engine>;
  #login?: { handle: LoginHandle; state: LoginState };

  constructor(readonly config: Config) {
    this.settings = new SettingsStore(config.CONCH_HOME);
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
        }),
      ],
    ]);
    this.conversations = new ConversationManager({
      store: new ConversationStore(join(config.CONCH_HOME, 'conversations')),
      settings: this.settings,
      memory: this.memory,
      engine: () => this.engine(),
    });
    this.conversations.events.on((event) => this.broadcast.emit(event));
    this.memory.changed.on(() => this.broadcast.emit({ type: 'memory.changed' }));
  }

  /** The active engine. Only Claude Code (and the mock) exist today; others fall back. */
  engine(): Engine {
    const id = this.config.CONCH_ENGINE ?? 'claude-code';
    return this.engines.get(id) ?? (this.engines.get('claude-code') as Engine);
  }

  async engineStatus(force = false) {
    const status = await this.engine().detect({ force });
    if (force) this.broadcast.emit({ type: 'engine.status', status });
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
