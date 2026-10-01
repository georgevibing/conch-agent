import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import type { EngineId, LoginState, ServerEvent, SkillSource, TurnProblem } from '@conch/protocol';

import { AttachmentStore } from './attachments/store';
import { type SystemKey, VaultService } from './vault/service';
import { vaultTools } from './vault/tools';
import { vaultCheck } from './vault/doctor';
import { deviceSealer, registerSealer } from './lib/sealed';
import { protectedPaths } from './lib/protect';
import { AccessStore } from './auth/store';
import { backupCheck } from './backup/doctor';
import { BackupService } from './backup/service';
import { BrowserService } from './browser/service';
import { adapterFor, type ChannelEndpoints, slackCheckFor } from './channels/adapters';
import { MockDiscord } from './channels/mock/discord';
import { MockSlack } from './channels/mock/slack';
import { MockTelegram } from './channels/mock/telegram';
import { ChannelService } from './channels/service';
import { ChannelStore } from './channels/store';
import { TerminalService } from './terminal/service';
import { Gatekeeper } from './security';
import type { Config } from './config';
import { CommandStore } from './commands/store';
import { ConversationManager, type TurnRoute } from './conversations/manager';
import { ConversationStore } from './conversations/store';
import { anthropicApiVariant, ApiEngine, ollamaVariant, openrouterVariant } from './engines/api';
import { ClaudeCodeEngine } from './engines/claude-code/engine';
import { CodexEngine } from './engines/codex/engine';
import { MockEngine } from './engines/mock/engine';
import type { Engine, LoginHandle } from './engines/types';
import { Emitter } from './lib/emitter';
import { registerCoreChecks } from './doctor/checks';
import { BOOT_ID, restart, restartable } from './lib/lifecycle';
import { Doctor } from './doctor/service';
import { NetworkWatch } from './network/watch';
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
import { ConchCheckout, findCheckout } from './updates/conch';
import { updatesCheck } from './updates/doctor';
import { lookup } from './updates/latest';
import { mockPrograms } from './updates/mock';
import { UpdatesService } from './updates/service';
import { UsageService } from './usage/service';
import { SERVER_VERSION } from './version';

export { SERVER_VERSION };

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
  /** Whether Conch can reach the internet (ADR 0023). */
  readonly network: NetworkWatch;
  /** A model on this computer: Ollama, found, started and fed models (ADR 0022). */
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
  /** Passwords: Conch's own vault and the managers it reads (ADR 0025). */
  readonly vault: VaultService;
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
  /** Updates for Conch and the programs it uses (ADR 0019). */
  readonly updates: UpdatesService;
  /** Back up and restore your Conch; a daily backup by itself (ADR 0020). */
  readonly backups: BackupService;
  /** When a chat last did anything: backups wait for a quiet moment. */
  #lastActivity = Date.now();
  /** Telegram, Discord and Slack bots that reach your assistant (ADR 0018). */
  readonly channels: ChannelService;
  /** The pretend Telegram and Discord used with the mock engine. */
  readonly mockTelegram?: MockTelegram;
  readonly mockDiscord?: MockDiscord;
  readonly mockSlack?: MockSlack;
  #login?: { handle: LoginHandle; state: LoginState };
  #channelStore?: ChannelStore;
  #sweeper?: NodeJS.Timeout;

  constructor(readonly config: Config) {
    this.healed = new Healed(config.CONCH_HOME, (note) =>
      this.broadcast.emit({ type: 'healed', note }),
    );
    this.setup = new Setup(KNOWN_NEEDS);
    this.network = new NetworkWatch({
      emit: (network) => this.broadcast.emit({ type: 'network.status', network }),
      // The scripted engine needs no internet: online unless a test pretends otherwise.
      ...(config.CONCH_ENGINE === 'mock' && { probe: async () => true }),
    });
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
    this.vault = new VaultService({
      home: config.CONCH_HOME,
      keystore:
        config.CONCH_VAULT_KEYSTORE ??
        (config.CONCH_ENGINE === 'mock' || process.env.VITEST ? 'file' : 'auto'),
      emit: () => this.broadcast.emit({ type: 'vault.changed' }),
      systemKeys: () => this.#systemKeys(),
    });
    // Conch's own keys (providers, integrations, channels) are sealed under this
    // computer's device key from here on (ADR 0025 § Keys Conch uses).
    registerSealer(
      config.CONCH_HOME,
      deviceSealer(() => this.vault.deviceKey()),
    );
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
    this.gate.devicesChanged.on(({ waiting }) =>
      this.broadcast.emit({ type: 'access.changed', waiting }),
    );
    this.browser = new BrowserService({
      home: config.CONCH_HOME,
      heal,
      gatewayPort: config.CONCH_PORT,
      workspace: () => this.settings.workspace(),
      emit: (event) => this.broadcast.emit(event),
    });
    // The browser fills sign-in fields from Passwords, with your OK (ADR 0025).
    this.browser.passwords = this.vault;
    const conversationStore = new ConversationStore(join(config.CONCH_HOME, 'conversations'), heal);
    this.conversations = new ConversationManager({
      store: conversationStore,
      settings: this.settings,
      memory: this.memory,
      engine: (id) => this.providers.engineFor(id),
      route: (engine, context) => this.route(engine, context),
      // An engine that can't run Conch's own tools is never offered them.
      tools: (ctx) =>
        ctx.engine.hostTools === false
          ? []
          : [
              ...this.routines.tools(ctx),
              ...this.skills.tools(ctx),
              ...this.browser.tools(ctx),
              ...vaultTools(this.vault, ctx),
            ],
      context: async (engine) =>
        [
          engine.hostTools === false ? '' : await this.routines.promptSection(),
          await this.skills.promptSection(engine).catch(() => ''),
          await this.browser.promptSection(engine).catch(() => ''),
          await this.integrations.promptSection(),
          engine.hostTools === false ? '' : this.vault.promptSection(),
        ]
          .filter(Boolean)
          .join('\n\n'),
      expand: (text) => this.skills.expand(text),
      integrations: this.integrations,
      attachments: this.attachments,
      redact: this.vault.redactor(),
      protectedPaths: protectedPaths(config.CONCH_HOME),
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
    // Repair everything looks at every part of Conch (see `doctor/checks.ts`).
    registerCoreChecks(this);
    // Back online: whatever waited goes now, in order.
    this.network.onChange((status) => {
      if (!status.online) return;
      void this.conversations.releaseHeld().then((sent) => {
        if (sent)
          void this.healed.note(
            'gateway',
            sent === 1
              ? 'You were offline for a while; your waiting message went when you were back.'
              : `You were offline for a while; your ${sent} waiting messages went when you were back.`,
          );
      });
    });
    this.updates = this.#updates(config);
    this.doctor.register(updatesCheck(this.updates));
    this.conversations.events.on((event) => {
      if (event.type === 'conversation.event') this.#lastActivity = Date.now();
    });
    this.backups = new BackupService({
      home: config.CONCH_HOME,
      conchVersion: SERVER_VERSION,
      busy: () => this.conversations.busy(),
      lastActivity: () => this.#lastActivity,
      emit: () => this.broadcast.emit({ type: 'backups.changed' }),
      heal,
      // Passwords travel only in a passphrase-locked backup, with the key that opens them.
      extraSecrets: () => this.vault.backupFiles(),
    });
    this.doctor.register(backupCheck(this.backups));
    this.doctor.register(vaultCheck(this.vault));

    // With the mock engine, channels talk to a pretend Telegram on this machine.
    this.mockTelegram = config.CONCH_ENGINE === 'mock' ? new MockTelegram() : undefined;
    this.mockDiscord = config.CONCH_ENGINE === 'mock' ? new MockDiscord() : undefined;
    this.mockSlack = config.CONCH_ENGINE === 'mock' ? new MockSlack() : undefined;
    const endpoints: ChannelEndpoints = {};
    this.#channelStore = new ChannelStore(config.CONCH_HOME, heal);
    this.channels = new ChannelService({
      store: this.#channelStore,
      conversations: this.conversations,
      attachments: this.attachments,
      settings: this.settings,
      adapter: (secrets) => adapterFor(secrets, endpoints),
      slack: (parts) => slackCheckFor(parts, endpoints),
      emit: (event) => this.broadcast.emit(event),
      onHeal: (message) => void this.healed.note('channels', message),
      routineTitle: async (id) =>
        (await this.routines.detail(id).catch(() => undefined))?.routine.title,
    });
    // Conversations and routine runs reach the channels through the same stream as the web app.
    this.broadcast.on((event) => this.channels.onEvent(event));
    this.#channelsReady = (async () => {
      if (this.mockTelegram) {
        const port = Number(process.env.CONCH_MOCK_TELEGRAM_PORT ?? 0);
        endpoints.telegram = await this.mockTelegram.start(port);
      }
      if (this.mockDiscord) {
        await this.mockDiscord.start(Number(process.env.CONCH_MOCK_DISCORD_PORT ?? 0));
        endpoints.discord = this.mockDiscord.api;
      }
      if (this.mockSlack) {
        await this.mockSlack.start(Number(process.env.CONCH_MOCK_SLACK_PORT ?? 0));
        endpoints.slack = this.mockSlack.api;
      }
    })();
  }

  /**
   * Updates. The mock engine gets pretend programs, and Conch's own folder
   * only when `CONCH_CHECKOUT` names one: a test never moves a real checkout.
   */
  #updates(config: Config): UpdatesService {
    const mock = config.CONCH_ENGINE === 'mock';
    const programs = mock
      ? mockPrograms(config.CONCH_HOME)
      : { specs: KNOWN_NEEDS, setup: this.setup, lookup: lookup() };
    const root =
      mock && !config.CONCH_CHECKOUT
        ? undefined
        : findCheckout(import.meta.dirname, config.CONCH_CHECKOUT);
    return new UpdatesService({
      home: config.CONCH_HOME,
      ...programs,
      conch: root ? new ConchCheckout(root) : undefined,
      version: SERVER_VERSION,
      bootId: BOOT_ID,
      emit: (status) => this.broadcast.emit({ type: 'updates.changed', status }),
      heal: (message) => void this.healed.note('updates', message),
      busy: () => this.conversations.busy(),
      landed: (id) => this.#recheckWaiting(id),
      restartable,
      restart,
      schedule: (config.CONCH_UPDATE_CHECKS ?? (mock ? 'off' : 'auto')) === 'auto',
    });
  }

  #channelsReady: Promise<void>;

  /**
   * The keys Conch itself uses, for Passwords (ADR 0025 § Keys Conch uses):
   * provider keys, integration keys and sign-ins, channel bot keys. Shown
   * read-only; each is changed where it's used.
   */
  async #systemKeys(): Promise<SystemKey[]> {
    const id = (...parts: string[]) =>
      `sys_${createHash('sha256').update(parts.join('\0')).digest('base64url').slice(0, 22)}`;
    const tail = (v: string) => (v.length > 8 ? `…${v.slice(-4)}` : 'saved');
    const out: SystemKey[] = [];
    for (const [engineId, engine] of this.engines) {
      if (engineId === 'mock') continue;
      const described = await this.keys.describe(engineId).catch(() => undefined);
      if (!described) continue;
      out.push({
        id: id('provider', engineId),
        title: `${engine.label} key`,
        usedBy: engine.label,
        hint: described.hint,
        savedAt: described.savedAt || undefined,
        manage: { label: 'Open Providers', place: 'providers', focus: engineId },
        reveal: async () => (await this.keys.value(engineId)) ?? '',
      });
    }
    for (const item of await this.integrations.store.all().catch(() => [])) {
      const secrets = await this.integrations.store.secrets(item.id).catch(() => undefined);
      for (const [key, value] of Object.entries(secrets?.values ?? {})) {
        if (!value) continue;
        out.push({
          id: id('integration', item.id, key),
          title: `${item.name} · ${key}`,
          usedBy: `${item.name} integration`,
          hint: tail(value),
          manage: { label: 'Open Integrations', place: 'integrations', focus: item.id },
          reveal: async () => value,
        });
      }
      if (secrets?.oauth?.tokens)
        out.push({
          id: id('integration', item.id, 'oauth'),
          title: `${item.name} sign-in`,
          usedBy: `${item.name} integration`,
          hint: 'Signed in',
          manage: { label: 'Open Integrations', place: 'integrations', focus: item.id },
          reveal: () =>
            Promise.reject(
              new Error(
                'This sign-in is kept by Conch and renewed by itself; there’s nothing to copy.',
              ),
            ),
        });
    }
    for (const channel of (await this.#channelStore?.all().catch(() => [])) ?? []) {
      const secrets = await this.#channelStore?.secrets(channel.id).catch(() => undefined);
      if (!secrets) continue;
      const name = channel.bot.name ? `${channel.bot.name} (${channel.kind})` : channel.kind;
      const tokens: [string, string][] =
        secrets.kind === 'slack'
          ? [
              ['bot token', secrets.botToken],
              ['app token', secrets.appToken],
            ]
          : [['bot token', secrets.token]];
      for (const [label, value] of tokens)
        out.push({
          id: id('channel', channel.id, label),
          title: `${name} ${label}`,
          usedBy: `${name} channel`,
          hint: tail(value),
          manage: { label: 'Open Channels', place: 'channels', focus: channel.id },
          reveal: async () => value,
        });
    }
    return out;
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
    this.network.start();
    await this.#channelsReady;
    void this.channels.start().catch((error: unknown) => console.error('[channels]', error));
    // Uploads nobody sent (a closed tab, a dropped draft) are cleared on start and hourly.
    void this.attachments.sweep().catch(() => undefined);
    this.#sweeper ??= setInterval(
      () => void this.attachments.sweep().catch(() => undefined),
      60 * 60 * 1000,
    );
    this.#sweeper.unref();
    this.updates.start();
    this.backups.start();
  }

  stop() {
    this.channels.stop();
    void this.mockTelegram?.stop();
    void this.mockDiscord?.stop();
    void this.mockSlack?.stop();
    clearInterval(this.#sweeper);
    this.#sweeper = undefined;
    this.network.stop();
    this.updates.stop();
    this.backups.stop();
    // Let go of the index file, so a restore (or a test) can replace it.
    this.search.close();
  }

  /** A provider on this computer that's ready to answer, for when the internet isn't there. */
  async localReady(): Promise<Engine | undefined> {
    // Only a provider Conch uses: one merely installed here isn't a choice you made
    // (and a pinned provider, like the mock engine, is the only one there is).
    const ready = await this.providers.ready().catch(() => []);
    return ready.find((engine) => engine.local);
  }

  /**
   * Who answers a turn (ADR 0023). Offline, the model on this computer answers
   * (if you let it) or the message waits for the internet; at a usage limit,
   * your pick carries on until it resets. Otherwise, the chat's own provider.
   */
  async route(engine: Engine, context: { failed?: TurnProblem }): Promise<TurnRoute> {
    const { preferences } = await this.settings.get();
    if (!engine.local) {
      // A provider that stopped answering is the moment to look again.
      const online =
        context.failed === 'unavailable'
          ? (await this.network.check()).online
          : this.network.online;
      if (!online) {
        const local = preferences.offlineFallback ? await this.localReady() : undefined;
        return local
          ? {
              kind: 'use',
              engine: local,
              routed: {
                reason: 'offline',
                message: `You’re offline, so ${local.label} answered from this computer.`,
              },
            }
          : { kind: 'hold' };
      }
    }
    const fallback = preferences.limitFallback;
    if (fallback && fallback !== engine.id) {
      const usage =
        engine.id === this.engine().id
          ? await this.usage.snapshot().catch(() => undefined)
          : undefined;
      if (context.failed === 'limit' || usage?.blocked) {
        const other = this.providers.engineFor(fallback);
        const ready = other.id !== engine.id && (await other.detect().catch(() => undefined));
        if (ready && ready.state === 'ready') {
          const until = usage?.blocked?.until;
          return {
            kind: 'use',
            engine: other,
            routed: {
              reason: 'limit',
              message: `${engine.label} reached its limit${until ? ` until ${clock(until)}` : ' for now'}, so ${other.label} answered.`,
            },
          };
        }
      }
    }
    return { kind: 'use', engine };
  }

  /**
   * Something Conch installed has landed: whatever was waiting on it looks
   * again now, instead of on its next check (the `op` state is cached for
   * half a minute, provider detection for twenty seconds).
   */
  async needLanded(id: string): Promise<void> {
    await this.#recheckWaiting(id);
    // Updates reads its version again (an update from Repair or a provider's page).
    await this.updates.landed(id);
  }

  async #recheckWaiting(id: string): Promise<void> {
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

/** "15:00" in this computer's time: when a limit resets. */
function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
