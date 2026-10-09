/**
 * Providers — connecting them, choosing the default, and saying how they are.
 *
 * Every connected provider is available at once: the model picker lists all of
 * their models and a conversation remembers which one answers (ADR 0012). The
 * *default* — what a new chat starts with — is a preference, not an
 * environment variable. An operator who sets `CONCH_ENGINE` pins it: that
 * provider is then the only one, and the UI says so.
 */
import {
  isAppProviderId,
  isServerId,
  type AppProviderId,
  type AddServerBody,
  type EngineId,
  type EngineStatus,
  type Found,
  type KeyForm,
  type ModelCatalog,
  type Provider,
  type ProviderModels,
  type ProvidersList,
  type SavedSecret,
  type ServerConfig,
  type ServerEvent,
  type ServerId,
  type ServerProbe,
  type UpdateServerBody,
} from '@conch/protocol';

import type { CloudService } from '../clouds/service';
import type { FetchLike } from '../engines/api/types';
import type { Engine } from '../engines/types';
import { SecretError } from '../secrets/vault';
import type { SettingsStore } from '../settings/store';
import { PROVIDER_COPY, PROVIDER_ORDER, SERVER_COPY, type ProviderCopy } from './catalog';
import { environmentKeys, foundKeyValue, FoundThings } from './found';
import type { ProviderKeys } from './keys';
import { canSignIn, ProviderSignIns, type SignInDisplay } from './oauth';
import { newServerId, probeServer, SERVER_PRESETS } from './servers';

/** What a server's card asks for: a key only some servers want. */
const SERVER_KEY: KeyForm = {
  label: 'Key',
  placeholder: '',
  help: 'Only if this server asks for one. It’s sent to this server and nowhere else.',
  canSignIn: false,
};

/** Where an address answers from (scheme, host and port), or nothing it could be. */
function origin(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Detection talks to other programs and other people's servers; don't hang on it. */
const DETECT_TIMEOUT_MS = 30_000;
/** Listing models can mean starting a CLI; one slow provider mustn't hold up the picker. */
const MODELS_TIMEOUT_MS = 20_000;

/**
 * A provider a Conch app brings (ADR 0119), as its card shows it: the words
 * from its manifest, what the person types, and where it came from.
 */
export interface AppProviderInfo {
  id: AppProviderId;
  appId: string;
  name: string;
  tagline: string;
  description: string;
  keyForm?: KeyForm;
  from: 'made' | 'link';
  speaks: 'openai' | 'anthropic' | 'code';
  reaches: string[];
  /** Its engine, built from the app's manifest. */
  engine: Engine;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'invalid' | 'pinned' = 'invalid',
  ) {
    super(message);
  }
}

export interface ProviderServiceDeps {
  /** Every provider's engine. Servers you add join it, and leave it, as you add and remove them. */
  engines: Map<EngineId, Engine>;
  settings: SettingsStore;
  keys: ProviderKeys;
  /** Build the engine for a server you added. */
  makeServer?: (config: ServerConfig) => Engine;
  /** For looking at addresses and this computer's usual ports. */
  fetch?: FetchLike;
  /**
   * Look around this computer for things that would connect a provider in one
   * press: keys in this environment, servers on the usual ports. Off in tests.
   */
  lookAround?: { env: NodeJS.ProcessEnv };
  /** Cloud sign-ins on this computer, offered in one press too (ADR 0109). Off in tests. */
  clouds?: Pick<CloudService, 'found' | 'useFound'>;
  /** `CONCH_ENGINE`, when the operator set it. */
  pinned?: EngineId;
  emit: (event: ServerEvent) => void;
  /** Called after the default provider changes, so limits and models are re-read. */
  onSwitch?: () => void;
}

export class ProviderService {
  /** Providers that can mint a key when you sign in (OpenRouter today). */
  readonly signIns = new ProviderSignIns();
  #active?: EngineId;
  #loading?: Promise<EngineId>;
  /** The servers you added, in the order you added them, as settings last said. */
  #servers: ServerConfig[] = [];
  /** The providers Conch apps bring (ADR 0119), as the apps you have say. */
  #apps: AppProviderInfo[] = [];
  readonly #found: FoundThings;

  constructor(private readonly deps: ProviderServiceDeps) {
    this.#found = new FoundThings(deps.fetch);
  }

  /** Build an engine for each server in settings: once at start-up. */
  async loadServers(): Promise<void> {
    const { servers } = await this.deps.settings.get();
    this.#servers = servers;
    if (!this.deps.makeServer) return;
    for (const server of servers)
      if (!this.deps.engines.has(server.id))
        this.deps.engines.set(server.id, this.deps.makeServer(server));
  }

  /**
   * The providers Conch apps bring (ADR 0119), as the apps you have now say:
   * each one's engine joins the others, and one whose app went leaves, with
   * its key. A chat that used one that's gone moves to the default.
   */
  async setAppProviders(list: readonly AppProviderInfo[]): Promise<void> {
    const next = new Set(list.map((p) => p.id));
    for (const gone of this.#apps.filter((p) => !next.has(p.id))) {
      // Its key first: nothing is listed that could still send one.
      await this.deps.keys.clear(gone.id).catch(() => undefined);
      await this.deps.settings.setConnected(gone.id, false).catch(() => undefined);
      this.deps.engines.delete(gone.id);
      if (this.#active === gone.id) {
        this.#active = undefined;
        await this.deps.settings
          .update({ preferences: { engine: 'claude-code' } })
          .catch(() => undefined);
      }
    }
    for (const provider of list) this.deps.engines.set(provider.id, provider.engine);
    this.#apps = [...list];
  }

  /** A provider a Conch app brings, by its id. */
  appProvider(id: EngineId): AppProviderInfo | undefined {
    return isAppProviderId(id) ? this.#apps.find((p) => p.id === id) : undefined;
  }

  /**
   * The active provider without waiting: the remembered choice once settings
   * have been read, and the safe default until then. `load()` removes the gap.
   */
  activeIdNow(): EngineId {
    return this.deps.pinned ?? this.#active ?? 'claude-code';
  }

  /** Read the remembered choice. Called once at start-up, cheap afterwards. */
  load(): Promise<EngineId> {
    if (this.deps.pinned) return Promise.resolve(this.deps.pinned);
    if (this.#active) return Promise.resolve(this.#active);
    this.#loading ??= this.deps.settings
      .get()
      .then(({ preferences }) => {
        // A provider that's been removed from the build shouldn't break start-up.
        const id = this.deps.engines.has(preferences.engine) ? preferences.engine : 'claude-code';
        this.#active = id;
        return id;
      })
      .finally(() => (this.#loading = undefined));
    return this.#loading;
  }

  /**
   * The active provider in the words the security checkup needs: its name, and
   * whether Conch can ask you before each step with it.
   */
  activeCopy(): { name: string; asksFirst: boolean } {
    const id = this.activeIdNow();
    const copy = PROVIDER_COPY.get(id);
    return { name: copy?.name ?? id, asksFirst: copy?.asksFirst ?? true };
  }

  /**
   * For the security checkup: any connected provider can answer a chat now,
   * so the one that can't ask before each step is the one to warn about.
   */
  async checkupCopy(): Promise<{ name: string; asksFirst: boolean }> {
    const ready = await this.ready().catch(() => []);
    const silent = ready
      .map((engine) => PROVIDER_COPY.get(engine.id))
      .find((copy) => copy && copy.asksFirst === false);
    return silent ? { name: silent.name, asksFirst: false } : this.activeCopy();
  }

  /** The default provider: new chats, routines without a choice, and usage limits. */
  engine(): Engine {
    const engines = this.deps.engines;
    return engines.get(this.activeIdNow()) ?? (engines.get('claude-code') as Engine);
  }

  /**
   * The engine for a turn: the one the conversation chose, else the default.
   * A pinned provider is the only one, whatever a conversation remembers.
   */
  engineFor(id: EngineId | undefined): Engine {
    if (!id) return this.engine();
    if (this.deps.pinned && !(this.deps.pinned === 'mock' && isAppProviderId(id)))
      return this.engine();
    return (
      (this.#listed(this.activeIdNow()).includes(id) && this.deps.engines.get(id)) || this.engine()
    );
  }

  /** The providers Conch shows and uses: with a pin, that one alone. */
  listed(): EngineId[] {
    return this.#listed(this.activeIdNow());
  }

  /**
   * Providers worth showing: the pin alone, else every real one (the test
   * double only as the default), then the servers you added.
   */
  #listed(active: EngineId): EngineId[] {
    const apps = this.#apps.map((p) => p.id).filter((id) => this.deps.engines.has(id));
    // The test double is pinned for UI work and journeys (`pnpm dev:mock`, e2e): what you add
    // to Conch from an app joins it, so making one and chatting with it can be tried end to end.
    if (this.deps.pinned === 'mock') return ['mock', ...apps];
    if (this.deps.pinned) return [this.deps.pinned];
    const known = PROVIDER_ORDER.filter((id) => {
      const copy = PROVIDER_COPY.get(id);
      if (!copy || !this.deps.engines.has(id)) return false;
      // The test double is only interesting when Conch is running on it.
      return !copy.internal || id === active;
    });
    const servers = this.#servers.map((s) => s.id).filter((id) => this.deps.engines.has(id));
    return [...known, ...servers, ...apps];
  }

  #copy(id: EngineId): ProviderCopy | undefined {
    return isServerId(id) || isAppProviderId(id) ? undefined : PROVIDER_COPY.get(id);
  }

  /**
   * Every connected provider, the default first. Detection is cached by each
   * engine, so this is cheap to call per page.
   */
  async ready(): Promise<Engine[]> {
    const active = await this.load();
    const ids = this.#listed(active).sort((a, b) => Number(b === active) - Number(a === active));
    const engines = ids.flatMap((id) => {
      const engine = this.deps.engines.get(id);
      return engine ? [engine] : [];
    });
    const states = await Promise.all(engines.map((engine) => this.#detect(engine)));
    const ready = engines.filter((_, i) => states[i]?.state === 'ready');
    const settled = await this.#settle(
      active,
      ready.map((engine) => engine.id),
    );
    return settled === active
      ? ready
      : ready.sort((a, b) => Number(b.id === settled) - Number(a.id === settled));
  }

  /**
   * A default that has never worked here, while another provider does, isn't
   * a choice anyone made: new chats would only fail. Move it to one that works
   * (one off the internet first). A default that worked before and stopped is
   * left alone — Health asks you about it instead.
   */
  async #settle(active: EngineId, ready: EngineId[]): Promise<EngineId> {
    if (this.deps.pinned || ready.includes(active)) return active;
    const candidates = ready.filter((id) => !PROVIDER_COPY.get(id)?.internal);
    const next = candidates.find((id) => !this.deps.engines.get(id)?.local) ?? candidates[0];
    if (!next || (await this.connected().catch(() => new Set<EngineId>())).has(active))
      return active;
    try {
      await this.deps.settings.update({ preferences: { engine: next } });
    } catch {
      return active;
    }
    this.#active = next;
    this.deps.onSwitch?.();
    return next;
  }

  /** What every connected provider offers, for the model picker. */
  async models(options: { force?: boolean } = {}): Promise<ModelCatalog> {
    const active = await this.load();
    const engines = await this.ready();
    const providers = await Promise.all(
      engines.map(async (engine): Promise<ProviderModels> => {
        try {
          const capabilities = await Promise.race([
            engine.capabilities({ force: options.force }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`${engine.label} didn’t list its models in time.`)),
                MODELS_TIMEOUT_MS,
              ).unref?.(),
            ),
          ]);
          // The id a choice is saved under is the provider's, whatever a stand-in calls itself.
          return {
            ...capabilities,
            engine: engine.id,
            local: Boolean(engine.local),
            places: engine.places === true,
            ...(engine.attachments && { attachments: engine.attachments }),
          };
        } catch (error) {
          return {
            engine: engine.id,
            label: engine.label,
            local: Boolean(engine.local),
            places: engine.places === true,
            ...(engine.attachments && { attachments: engine.attachments }),
            models: [],
            commands: [],
            permissionModes: ['default'],
            message: (error as Error).message || `${engine.label} couldn’t list its models.`,
          };
        }
      }),
    );
    return { default: active, providers };
  }

  #engineOrThrow(id: EngineId): Engine {
    const engine = this.deps.engines.get(id);
    if (!engine) throw new ProviderError(`There's no provider called “${id}”.`, 'not-found');
    return engine;
  }

  /**
   * Providers that have worked on this computer and that you haven't removed
   * since. Health only worries about these (and about having none at all).
   */
  async connected(): Promise<Set<EngineId>> {
    return new Set((await this.deps.settings.get()).connected as EngineId[]);
  }

  /** Every provider worth showing, with live status. */
  async list(options: { force?: boolean } = {}): Promise<ProvidersList> {
    const active = await this.load();
    // A pinned provider is the only one worth showing: you can't switch, and
    // detecting the rest would only offer choices that wouldn't take.
    const ids = this.#listed(active);
    const described = await Promise.all(
      ids.map((id: EngineId) => this.#describe(id, active, options)),
    );
    const settled = await this.#settle(
      active,
      described.filter((p) => p.ready).map((p) => p.id),
    );
    const providers = described.map((p) => ({ ...p, active: p.id === settled }));
    if (settled !== active) {
      const chosen = providers.find((p) => p.id === settled);
      if (chosen) this.deps.emit({ type: 'engine.status', status: chosen.status });
    }
    return {
      active: settled,
      providers,
      onePassword: await this.deps.keys.vault.onePassword.state(),
      pinned: this.deps.pinned
        ? `Conch was started with CONCH_ENGINE=${this.deps.pinned}, so it’s the only provider.`
        : undefined,
      found: this.deps.pinned ? [] : await this.#foundNow(providers, options.force),
      serverPresets: this.deps.pinned ? [] : [...SERVER_PRESETS],
    };
  }

  /** What's on this computer that would connect a provider in one press. */
  async #foundNow(providers: Provider[], force?: boolean): Promise<Found[]> {
    const around = this.deps.lookAround;
    if (!around) return [];
    const connected = new Set(providers.filter((p) => p.ready || p.key).map((p) => p.id));
    const keys = environmentKeys(connected, around.env).map(({ key: _key, ...found }) => found);
    const servers = await this.#found.servers(this.#servers, force).catch(() => []);
    const clouds = await (this.deps.clouds?.found(connected) ?? Promise.resolve([])).catch(
      () => [],
    );
    return [...keys, ...clouds, ...servers];
  }

  /** Use something found on this computer: save a found key, or add a found server. */
  async useFound(id: string): Promise<ProvidersList> {
    // A cloud sign-in found here: that account, for its provider.
    if (id.startsWith('cloud-') && this.deps.clouds) {
      const provider = await this.deps.clouds.useFound(id).catch((error: unknown) => {
        throw new ProviderError((error as Error).message, 'not-found');
      });
      if (provider) {
        await this.#detect(this.#engineOrThrow(provider), true);
        return this.list();
      }
    }
    const env = this.deps.lookAround?.env ?? {};
    const key = environmentKeys(new Set(), env).find((found) => found.id === id)?.key;
    if (key) {
      const value = foundKeyValue(key, env);
      if (!value) throw new ProviderError('That key isn’t on this computer any more.', 'not-found');
      return this.setKey(key.provider, value);
    }
    const server = (await this.#found.servers(this.#servers, true)).find((f) => f.id === id);
    if (server?.url) {
      await this.addServer({
        url: server.url,
        ...(server.name !== 'A model server' && { name: server.name }),
      });
      return this.list();
    }
    throw new ProviderError('That’s not on this computer any more.', 'not-found');
  }

  // ── Servers you run yourself ──────────────────────────────────────────────

  /** Look at an address before adding it. */
  probeServer(url: string, key?: string): Promise<ServerProbe> {
    return probeServer(this.deps.fetch ?? globalThis.fetch, url, key);
  }

  /**
   * Add a server: look at it first, so "Added" means its models answer. A key
   * is kept like every provider key; the address and name go in settings.
   */
  async addServer(body: AddServerBody): Promise<{ id: ServerId; list: ProvidersList }> {
    if (!this.deps.makeServer) throw new ProviderError('Servers can’t be added here.');
    if (this.deps.pinned)
      throw new ProviderError(
        `Conch was started with CONCH_ENGINE=${this.deps.pinned}. Remove it to add servers.`,
        'pinned',
      );
    const probe = await this.probeServer(body.url, body.key);
    if (!probe.ok || !probe.url)
      throw new ProviderError(probe.message ?? 'Nothing answered there.');
    const taken = new Set(this.#servers.map((s) => s.name.toLowerCase()));
    const wanted = (body.name?.trim() || probe.kind || new URL(probe.url).host).slice(0, 56);
    let name = wanted;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} ${n}`;
    const config: ServerConfig = {
      id: newServerId(),
      name,
      url: probe.url,
      ...(probe.kind && { kind: probe.kind }),
      addedAt: Date.now(),
    };
    if (body.key?.trim()) await this.deps.keys.save(config.id, body.key.trim());
    this.#servers = await this.deps.settings.setServer(config.id, config);
    this.deps.engines.set(config.id, this.deps.makeServer(config));
    this.#found.forget();
    return { id: config.id, list: await this.list() };
  }

  /** Rename a server, or point it somewhere new (looked at first). */
  async updateServer(id: ServerId, body: UpdateServerBody): Promise<ProvidersList> {
    const current = this.#servers.find((s) => s.id === id);
    if (!current || !this.deps.makeServer)
      throw new ProviderError('There’s no server like that here.', 'not-found');
    let url = current.url;
    let kind = current.kind;
    let moved = false;
    if (body.url && body.url !== current.url) {
      // A key belongs to the server it was given for: the new address is looked at
      // without it, and only a server at the same origin is shown it.
      let probe = await this.probeServer(body.url);
      const sameOrigin = Boolean(probe.url) && origin(probe.url) === origin(current.url);
      if (!probe.ok && probe.needsKey && sameOrigin) {
        const saved = await this.deps.keys.value(id).catch(() => undefined);
        if (saved) probe = await this.probeServer(body.url, saved);
      }
      if (!probe.ok || !probe.url)
        throw new ProviderError(
          probe.needsKey && !sameOrigin
            ? 'That server asks for a key. Remove this one and add it again with its own key.'
            : (probe.message ?? 'Nothing answered there.'),
        );
      url = probe.url;
      kind = probe.kind;
      moved = !sameOrigin;
    }
    const { kind: _old, ...rest } = current;
    const next: ServerConfig = {
      ...rest,
      ...(body.name && { name: body.name.trim().slice(0, 60) }),
      url,
      ...(kind && { kind }),
    };
    // Somewhere else now: the old server's key stays behind, never sent to the new one.
    if (moved) await this.deps.keys.clear(id);
    this.#servers = await this.deps.settings.setServer(id, next);
    this.deps.engines.set(id, this.deps.makeServer(next));
    return this.list();
  }

  /** Take a server away: its key, its card and its models. Chats that used it move to the default. */
  async removeServer(id: ServerId): Promise<ProvidersList> {
    if (!this.#servers.some((s) => s.id === id))
      throw new ProviderError('There’s no server like that here.', 'not-found');
    await this.deps.keys.clear(id);
    this.#servers = await this.deps.settings.setServer(id, undefined);
    this.deps.engines.delete(id);
    if (this.#active === id) {
      this.#active = undefined;
      await this.deps.settings
        .update({ preferences: { engine: 'claude-code' } })
        .catch(() => undefined);
    }
    this.#found.forget();
    return this.list();
  }

  async get(id: EngineId, options: { force?: boolean } = {}): Promise<Provider> {
    this.#engineOrThrow(id);
    return this.#describe(id, await this.load(), options);
  }

  async #describe(id: EngineId, active: EngineId, options: { force?: boolean }): Promise<Provider> {
    const copy = this.#copy(id);
    const engine = this.#engineOrThrow(id);
    const server = isServerId(id) ? this.#servers.find((s) => s.id === id) : undefined;
    const status = await this.#detect(engine, options.force);
    const before = (await this.connected().catch(() => new Set<EngineId>())).has(id);
    if (status.state === 'ready')
      // Remembering is best-effort: a settings file that won't write mustn't fail a page.
      await this.deps.settings.setConnected(id, true).catch(() => undefined);
    let key: SavedSecret | undefined;
    try {
      key = await this.deps.keys.describe(id);
    } catch {
      // Describing a key must never fail a page; the status already says enough.
    }
    const fromApp = this.appProvider(id);
    if (fromApp)
      return {
        id,
        name: fromApp.name,
        tagline: fromApp.tagline,
        description: fromApp.description,
        connect: 'key',
        local: false,
        status,
        active: id === active,
        ready: status.state === 'ready',
        highlights: [],
        limits:
          fromApp.from === 'made'
            ? []
            : ['It came from someone else: it reaches only the sites its card shows.'],
        install: [],
        key,
        ...(fromApp.keyForm && { keyForm: fromApp.keyForm }),
        experimental: false,
        hidden: false,
        group: 'key',
        featured: false,
        brand: 'app',
        connectedBefore: before || status.state === 'ready',
        contributed: {
          app: fromApp.appId,
          from: fromApp.from,
          speaks: fromApp.speaks,
          reaches: fromApp.reaches,
        },
      };
    if (server)
      return {
        id,
        name: server.name,
        tagline: server.kind
          ? `${server.kind} · ${new URL(server.url).host}`
          : new URL(server.url).host,
        description: SERVER_COPY.description,
        connect: 'key',
        local: Boolean(engine.local),
        status,
        active: id === active,
        ready: status.state === 'ready',
        highlights: [...SERVER_COPY.highlights],
        limits: [...SERVER_COPY.limits],
        install: [],
        key,
        keyForm: SERVER_KEY,
        experimental: false,
        color: SERVER_COPY.color,
        hidden: false,
        group: 'server',
        featured: false,
        brand: 'server',
        server,
        connectedBefore: true,
      };
    return {
      id,
      // A stand-in is named by whatever it's standing in for.
      name: (copy?.internal ? status.label : copy?.name) ?? engine.label,
      tagline: copy?.tagline ?? '',
      signInLabel: copy?.signInLabel,
      signInHelp: copy?.signInHelp,
      disconnectable: Boolean(engine.disconnect),
      description: copy?.description ?? '',
      connect: copy?.connect ?? 'program',
      local: Boolean(engine.local),
      status,
      active: id === active,
      ready: status.state === 'ready',
      highlights: copy?.highlights ?? [],
      limits: copy?.limits ?? [],
      install: status.install,
      key,
      // Only the flow that actually exists may be offered.
      keyForm: copy?.keyForm && { ...copy.keyForm, canSignIn: canSignIn(id) },
      experimental: copy?.experimental ?? false,
      color: copy?.color,
      homepage: copy?.homepage,
      hidden: copy?.internal ?? false,
      group: copy?.group ?? 'key',
      featured: copy?.featured ?? false,
      ...(copy?.free && { free: copy.free }),
      ...(copy?.cloud && { cloud: copy.cloud }),
      connectedBefore: before || status.state === 'ready',
    };
  }

  /** Detection that can't hang and can't throw: a failure is a state, not an error. */
  async #detect(engine: Engine, force?: boolean): Promise<EngineStatus> {
    const fallback = (message: string): EngineStatus => ({
      engine: engine.id,
      label: engine.label,
      state: 'error',
      message,
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    });
    try {
      return await Promise.race([
        engine.detect({ force }),
        new Promise<EngineStatus>((resolve) =>
          setTimeout(
            () => resolve(fallback(`${engine.label} didn’t answer in time.`)),
            DETECT_TIMEOUT_MS,
          ).unref?.(),
        ),
      ]);
    } catch (error) {
      const message = error instanceof SecretError ? error.message : (error as Error).message;
      return fallback(message);
    }
  }

  /** Make `id` the provider new chats start with. */
  async use(id: EngineId): Promise<ProvidersList> {
    if (this.deps.pinned && this.deps.pinned !== id)
      throw new ProviderError(
        `Conch was started with CONCH_ENGINE=${this.deps.pinned}. Remove it to choose here.`,
        'pinned',
      );
    this.#engineOrThrow(id);
    await this.deps.settings.update({ preferences: { engine: id } });
    this.#active = id;
    const list = await this.list();
    const chosen = list.providers.find((p) => p.id === id);
    if (chosen) this.deps.emit({ type: 'engine.status', status: chosen.status });
    this.deps.onSwitch?.();
    return list;
  }

  /**
   * Save a provider's key — the value, or an `op://…` reference to it. The key is
   * checked before it's kept, so "Saved" means it actually works.
   */
  async setKey(id: EngineId, value: string): Promise<ProvidersList> {
    const engine = this.#engineOrThrow(id);
    const copy = this.#copy(id);
    const form = isServerId(id) ? SERVER_KEY : (this.appProvider(id)?.keyForm ?? copy?.keyForm);
    const name = copy?.name ?? engine.label;
    if (!form) throw new ProviderError(`${name} doesn’t take a key.`);

    const previous = await this.deps.keys.stored(id);
    const stored = await this.deps.keys.save(id, value);

    // Resolve 1Password now: better to fail here, with the dialog open, than at
    // the first message. A pattern that doesn't match is almost always a paste
    // from the wrong place.
    let resolved: string | undefined;
    try {
      resolved = await this.deps.keys.value(id);
    } catch (error) {
      await this.#restore(id, previous);
      throw new ProviderError((error as Error).message);
    }
    const pattern = form.pattern;
    if (resolved && pattern && !new RegExp(pattern).test(resolved)) {
      await this.#restore(id, previous);
      throw new ProviderError(
        stored.source === '1password'
          ? `That 1Password field doesn’t look like a key. ${form.patternHint ?? ''}`.trim()
          : (form.patternHint ?? 'That doesn’t look like a key.'),
      );
    }

    await engine.setApiKey?.(resolved);
    const status = await this.#detect(engine, true);
    if (status.state === 'signed-out' || status.state === 'error') {
      await this.#restore(id, previous);
      // Said where a key is being added: "add one in Settings" would point at this very page.
      const said = (status.message ?? `${name} didn’t accept that key.`).replace(
        /\s*Add a new one in Settings\.$/,
        '',
      );
      throw new ProviderError(
        status.state === 'signed-out' ? `${said} Check that you copied all of it.` : said,
      );
    }
    return this.list();
  }

  /** Open the provider's own page so it can make a key for you. */
  startSignIn(input: { id: EngineId; origin: string; display: SignInDisplay }) {
    this.#engineOrThrow(input.id);
    return this.signIns.start({
      providerId: input.id,
      origin: input.origin,
      display: input.display,
    });
  }

  /** The provider sent us back with a code: turn it into a saved key. */
  async finishSignIn(flowId: string, code: string) {
    const { providerId, display, key } = await this.signIns.finish(flowId, code);
    await this.setKey(providerId, key);
    return { providerId, display };
  }

  async clearKey(id: EngineId): Promise<ProvidersList> {
    const engine = this.#engineOrThrow(id);
    await engine.disconnect?.();
    await this.deps.keys.clear(id);
    await engine.setApiKey?.(undefined);
    // You removed it: it's no longer something Health should miss.
    await this.deps.settings.setConnected(id, false);
    await this.#detect(engine, true);
    return this.list();
  }

  async #restore(id: EngineId, previous: Awaited<ReturnType<ProviderKeys['stored']>>) {
    if (previous) await this.deps.settings.setProviderSecret(id, previous);
    else await this.deps.keys.clear(id);
  }
}
