import { join, resolve } from 'node:path';

import type { EngineId, LoginState, ServerEvent, SkillSource } from '@conch/protocol';

import { AttachmentStore } from './attachments/store';
import { AccessStore } from './auth/store';
import { BrowserService } from './browser/service';
import { TerminalService } from './terminal/service';
import { Gatekeeper } from './security';
import type { Config } from './config';
import { CommandStore } from './commands/store';
import { ConversationManager } from './conversations/manager';
import { ConversationStore } from './conversations/store';
import { anthropicApiVariant, ApiEngine, ollamaVariant, openrouterVariant } from './engines/api';
import { ClaudeCodeEngine } from './engines/claude-code/engine';
import { CodexEngine } from './engines/codex/engine';
import { MockEngine } from './engines/mock/engine';
import type { Engine, LoginHandle } from './engines/types';
import { Emitter } from './lib/emitter';
import { Doctor } from './doctor/service';
import { Healed } from './lib/healed';
import type { Heal } from './lib/recover';
import { LocalService } from './local/service';
import { KNOWN_NEEDS } from './setup/known';
import { Setup } from './setup/needs';
import { ProviderKeys } from './providers/keys';
import { ProviderService } from './providers/service';
import { SecretVault } from './secrets/vault';
import { type Blueprint, CATALOG } from './integrations/catalog';
import { MockVendor } from './integrations/mock/vendor';
import { IntegrationService } from './integrations/service';
import { MemoryStore } from './memory/store';
import { RoutineService } from './routines/service';
import { SearchService } from './search/service';
import { RoutineStore } from './routines/store';
import { SettingsStore } from './settings/store';
import { SkillService } from './skills/service';
import { externalRoots, SkillStore } from './skills/store';
import { UsageService } from './usage/service';

export { SERVER_VERSION } from './version';

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
  /** What Conch fixed on its own, for the quiet list in Settings. */
  readonly healed: Healed;
  /** What features need from this computer, and getting it (ADR 0016). */
  readonly setup: Setup;
  /** Repair everything: every part's check, run at once (see `doctor/`). */
  readonly doctor: Doctor;
  /** A model on this computer: Ollama, found, started and fed models (ADR 0018). */
  readonly local: LocalService;
  readonly settings: SettingsStore;
  /** Who may sign in (`~/.conch/access.json`). */
  readonly access: AccessStore;
  readonly gate: Gatekeeper;
  /** Files in CONCH_HOME whose permissions couldn't be tightened (see `secureHome`). */
  homeProblems: string[] = [];
  readonly memory: MemoryStore;
  readonly commands: CommandStore;
  /** Files and long pastes sent with messages (ADR 0017). */
  readonly attachments: AttachmentStore;
  readonly routines: RoutineService;
  readonly conversations: ConversationManager;
  readonly browser: BrowserService;
  readonly terminal: TerminalService;
  readonly engines: Map<EngineId, Engine>;
  /** Where every provider's key lives, whether that's here or in 1Password. */
  readonly keys: ProviderKeys;
  /** Connecting providers, switching between them, and saying how they are. */
  readonly providers: ProviderService;
  readonly usage: UsageService;
  readonly integrations: IntegrationService;
  /** Skills: Conch's own, and those in other agents' folders (ADR 0013). */
  readonly skills: SkillService;
  /** The pretend SaaS vendor used with the mock engine. */
  readonly mockVendor?: MockVendor;
  /** Full-text search over every conversation; rebuilds its index when it breaks. */
  readonly search: SearchService;
  #login?: { handle: LoginHandle; state: LoginState };
  #sweeper?: NodeJS.Timeout;

  constructor(readonly config: Config) {
    this.healed = new Healed(config.CONCH_HOME, (note) =>
      this.broadcast.emit({ type: 'healed', note }),
    );
    this.setup = new Setup(KNOWN_NEEDS);
    this.doctor = new Doctor({
      emit: (report) => this.broadcast.emit({ type: 'doctor.report', report }),
      onHeal: (message) => void this.healed.note('gateway', message),
    });
    /** Every store that repairs itself says so here (AGENTS.md agreement 11). */
    const heal: Heal = (area, message) => void this.healed.note(area, message);
    this.settings = new SettingsStore(config.CONCH_HOME, heal);
    this.access = new AccessStore(config.CONCH_HOME, heal);
    this.gate = new Gatekeeper(config, this.access);
    this.memory = new MemoryStore(join(config.CONCH_HOME, 'memory'));
    this.commands = new CommandStore(join(config.CONCH_HOME, 'commands'));
    this.attachments = new AttachmentStore(join(config.CONCH_HOME, 'attachments'));
    this.keys = new ProviderKeys(this.settings, new SecretVault());
    this.local = new LocalService({
      home: config.CONCH_HOME,
      setup: this.setup,
      heal: (message) => void this.healed.note('providers', message),
      // A model arrived or Ollama started: the card and the picker see it now.
      onChange: () => local.forget(),
    });
    const local = new ApiEngine(
      ollamaVariant(this.local, { home: config.CONCH_HOME }),
      this.settings,
      this.keys,
    );
    this.doctor.register(this.local.doctorCheck());
    this.engines = new Map<EngineId, Engine>([
      [
        'claude-code',
        new ClaudeCodeEngine(
          this.settings,
          this.keys,
          config.CONCH_CLAUDE_PATH,
          (message) => void this.healed.note('providers', message),
        ),
      ],
      ['codex-cli', new CodexEngine(this.settings, this.keys, config.CONCH_CODEX_PATH)],
      [
        'openrouter',
        new ApiEngine(openrouterVariant({ home: config.CONCH_HOME }), this.settings, this.keys),
      ],
      [
        'anthropic-api',
        new ApiEngine(anthropicApiVariant({ home: config.CONCH_HOME }), this.settings, this.keys),
      ],
      ['ollama', local],
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
    this.providers = new ProviderService({
      engines: this.engines,
      settings: this.settings,
      keys: this.keys,
      pinned: config.CONCH_ENGINE,
      emit: (event) => this.broadcast.emit(event),
      // A different provider means different limits and a different model list.
      onSwitch: () => void this.usage.refresh({ force: true }),
    });
    // With the mock engine, integrations talk to a pretend vendor on this machine too.
    this.mockVendor = config.CONCH_ENGINE === 'mock' ? new MockVendor() : undefined;
    this.integrations = new IntegrationService({
      home: config.CONCH_HOME,
      heal,
      emit: (event) => this.broadcast.emit(event),
      engines: () => this.providers.ready(),
      cwd: () => this.settings.workspace(),
      blueprints: this.mockVendor && mockBlueprints(this.mockVendor),
      setup: this.setup,
      onHeal: (message) => void this.healed.note('integrations', message),
    });
    // Other agents' skill folders are read unless turned off; test runs (the mock engine) don't look.
    const skillSources =
      config.CONCH_SKILL_SOURCES ?? (config.CONCH_ENGINE === 'mock' ? 'off' : 'auto');
    this.skills = new SkillService({
      store: new SkillStore(
        config.CONCH_HOME,
        skillSources === 'auto' ? externalRoots() : [],
        () => this.#nativeSkillSources,
        heal,
      ),
      engines: () => this.providers.ready(),
      emit: (event) => this.broadcast.emit(event),
      onSpend: (usage) => void this.usage.recordTurn(usage).catch(() => undefined),
    });
    this.terminal = new TerminalService({
      home: config.CONCH_HOME,
      heal,
      workspace: () => this.settings.workspace(),
      emit: (event) => this.broadcast.emit(event),
    });
    // A device that's signed out takes the terminals it opened with it.
    this.gate.signedOut.on((ids) => this.terminal.endOwnedBy(ids.map((id) => `session:${id}`)));
    this.browser = new BrowserService({
      home: config.CONCH_HOME,
      heal,
      gatewayPort: config.CONCH_PORT,
      workspace: () => this.settings.workspace(),
      emit: (event) => this.broadcast.emit(event),
    });
    const conversationStore = new ConversationStore(join(config.CONCH_HOME, 'conversations'), heal);
    this.conversations = new ConversationManager({
      store: conversationStore,
      settings: this.settings,
      memory: this.memory,
      engine: (id) => this.providers.engineFor(id),
      // An engine that can't run Conch's own tools is never offered them.
      tools: (ctx) =>
        ctx.engine.hostTools === false
          ? []
          : [...this.routines.tools(ctx), ...this.skills.tools(ctx), ...this.browser.tools(ctx)],
      context: async (engine) =>
        [
          engine.hostTools === false ? '' : await this.routines.promptSection(),
          await this.skills.promptSection(engine).catch(() => ''),
          await this.browser.promptSection(engine).catch(() => ''),
          await this.integrations.promptSection(),
        ]
          .filter(Boolean)
          .join('\n\n'),
      expand: (text) => this.skills.expand(text),
      integrations: this.integrations,
      attachments: this.attachments,
      // A spend that can't be saved is lost, not fatal: an unhandled rejection would stop Conch.
      onSpend: (usage) => void this.usage.recordTurn(usage).catch(() => undefined),
    });
    this.routines = new RoutineService({
      store: new RoutineStore(join(config.CONCH_HOME, 'routines'), heal),
      conversations: this.conversations,
      engine: (id) => this.providers.engineFor(id),
      emit: (event) => this.broadcast.emit(event),
      onHeal: (message) => void this.healed.note('routines', message),
    });
    this.conversations.events.on((event) => this.broadcast.emit(event));
    // A deleted chat takes its browser tab and thumbnails with it.
    this.conversations.events.on((event) => {
      if (event.type === 'conversation.deleted') void this.browser.forget(event.conversationId);
    });
    this.memory.changed.on(() => this.broadcast.emit({ type: 'memory.changed' }));
    this.usage = new UsageService({
      home: config.CONCH_HOME,
      heal,
      engine: () => this.engine(),
      history: () => turnCosts(conversationStore),
    });
    this.usage.changed.on((usage) => this.broadcast.emit({ type: 'usage.changed', usage }));
    this.conversations.events.on((event) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
        void this.usage.recordTurn(event.event.usage).catch(() => undefined);
      }
    });
    this.usage.start();
    void (this.mockVendor?.start() ?? Promise.resolve()).then(() => this.integrations.start());
    this.search = new SearchService({
      path: join(config.CONCH_HOME, 'search.db'),
      source: {
        list: () => conversationStore.list(),
        events: (id) => conversationStore.events(id),
        detail: (id) => this.conversations.detail(id),
      },
      heal,
      log: (error) => console.error('[search]', error),
    });
    this.conversations.events.on((event) => this.search.onEvent(event));
    this.search.open();
  }

  /** The default provider: your choice, or `CONCH_ENGINE` when it's set. */
  engine(): Engine {
    return this.providers.engine();
  }

  /**
   * Skill folders a provider reads by itself, and who that is. Every listed
   * provider counts, not only connected ones: the answer must be quick, and a
   * provider that isn't connected isn't reading anything.
   */
  get #nativeSkillSources(): Map<SkillSource, string> {
    const map = new Map<SkillSource, string>();
    for (const engine of this.engines.values())
      for (const source of engine.skillSources ?? []) map.set(source, engine.label);
    return map;
  }

  /** What every connected provider offers, for the model picker. */
  models(force = false) {
    return this.providers.models({ force });
  }

  /** Read the remembered provider before the first request arrives. */
  async start() {
    await this.providers.load();
    // Uploads nobody sent (a closed tab, a dropped draft) are cleared on start and hourly.
    void this.attachments.sweep().catch(() => undefined);
    this.#sweeper ??= setInterval(
      () => void this.attachments.sweep().catch(() => undefined),
      60 * 60 * 1000,
    );
    this.#sweeper.unref();
  }

  stop() {
    clearInterval(this.#sweeper);
    this.#sweeper = undefined;
  }

  /**
   * Something Conch installed has landed: whatever was waiting on it looks
   * again now, instead of on its next check (the `op` state is cached for
   * half a minute, provider detection for twenty seconds).
   */
  async needLanded(id: string): Promise<void> {
    if (id === 'op') await this.keys.vault.onePassword.state({ force: true });
    // Ollama just landed: start it (quietly), so getting a model can follow straight on.
    if (id === 'ollama') await this.local.ensureRunning({ note: false });
    const engine = { codex: 'codex-cli', 'claude-code': 'claude-code', ollama: 'ollama' }[id] as
      EngineId | undefined;
    if (engine) await this.engines.get(engine)?.detect({ force: true });
    await this.integrations.recheckNeeding(id);
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

  /** One provider's models, commands and modes: the default's unless another is named. */
  async capabilities(force = false, id?: EngineId) {
    const engine = this.providers.engineFor(id);
    // Saved choices name the provider, whatever a stand-in calls itself.
    return {
      ...(await engine.capabilities({ force })),
      engine: engine.id,
      ...(engine.attachments && { attachments: engine.attachments }),
    };
  }

  get login() {
    return this.#login?.state;
  }

  startLogin(method: 'subscription' | 'console', id?: EngineId) {
    this.#login?.handle.cancel();
    const engine = (id && this.engines.get(id)) ?? this.engine();
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

  /**
   * The active provider's key. Kept for the first-run flow, which knows about
   * one provider; Settings uses `/api/providers/:id/key`.
   */
  async setApiKey(apiKey: string | undefined) {
    const id = this.providers.activeIdNow();
    if (apiKey === undefined) await this.providers.clearKey(id);
    else await this.providers.setKey(id, apiKey);
    return this.engineStatus(true);
  }
}

/**
 * Mock-mode catalog: web integrations point at the pretend vendor, local
 * ones run a tiny test server. Token vendors accept one fixed token each.
 */
function mockBlueprints(vendor: MockVendor) {
  vendor.validTokens.set('github', 'github_pat_mock_0123456789abcdefghij');
  vendor.validTokens.set('home-assistant', 'mock-home-token');
  const fixture = resolve(import.meta.dirname, 'test/mcpFixture.ts');
  return (id: string): Blueprint | undefined => {
    const entry = CATALOG.get(id);
    if (!entry?.blueprint) return undefined;
    if (entry.blueprint.type === 'stdio')
      return { type: 'stdio', command: process.execPath, args: [fixture] };
    return { type: 'http', url: () => vendor.url(id) };
  };
}
