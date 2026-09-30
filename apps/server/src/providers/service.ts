/**
 * Providers — connecting them, choosing the default, and saying how they are.
 *
 * Every connected provider is available at once: the model picker lists all of
 * their models and a conversation remembers which one answers (ADR 0012). The
 * *default* — what a new chat starts with — is a preference, not an
 * environment variable. An operator who sets `CONCH_ENGINE` pins it: that
 * provider is then the only one, and the UI says so.
 */
import type {
  EngineId,
  ModelCatalog,
  Provider,
  ProviderModels,
  ProvidersList,
  SavedSecret,
  ServerEvent,
  EngineStatus,
} from '@conch/protocol';

import type { Engine } from '../engines/types';
import { SecretError } from '../secrets/vault';
import type { SettingsStore } from '../settings/store';
import { PROVIDER_COPY, PROVIDER_ORDER } from './catalog';
import type { ProviderKeys } from './keys';
import { canSignIn, ProviderSignIns, type SignInDisplay } from './oauth';

/** Detection talks to other programs and other people's servers; don't hang on it. */
const DETECT_TIMEOUT_MS = 30_000;
/** Listing models can mean starting a CLI; one slow provider mustn't hold up the picker. */
const MODELS_TIMEOUT_MS = 20_000;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'invalid' | 'pinned' = 'invalid',
  ) {
    super(message);
  }
}

export interface ProviderServiceDeps {
  engines: ReadonlyMap<EngineId, Engine>;
  settings: SettingsStore;
  keys: ProviderKeys;
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

  constructor(private readonly deps: ProviderServiceDeps) {}

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
    if (this.deps.pinned || !id) return this.engine();
    return (
      (this.#listed(this.activeIdNow()).includes(id) && this.deps.engines.get(id)) || this.engine()
    );
  }

  /** Providers worth showing: the pin alone, else every real one (the test double only as the default). */
  #listed(active: EngineId): EngineId[] {
    if (this.deps.pinned) return [this.deps.pinned];
    return PROVIDER_ORDER.filter((id) => {
      const copy = PROVIDER_COPY.get(id);
      if (!copy || !this.deps.engines.has(id)) return false;
      // The test double is only interesting when Conch is running on it.
      return !copy.internal || id === active;
    });
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
    return engines.filter((_, i) => states[i]?.state === 'ready');
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
            ...(engine.attachments && { attachments: engine.attachments }),
          };
        } catch (error) {
          return {
            engine: engine.id,
            label: engine.label,
            local: Boolean(engine.local),
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

  /** Every provider worth showing, with live status. */
  async list(options: { force?: boolean } = {}): Promise<ProvidersList> {
    const active = await this.load();
    // A pinned provider is the only one worth showing: you can't switch, and
    // detecting the rest would only offer choices that wouldn't take.
    const ids = this.#listed(active);
    const providers = await Promise.all(
      ids.map((id: EngineId) => this.#describe(id, active, options)),
    );
    return {
      active,
      providers,
      onePassword: await this.deps.keys.vault.onePassword.state(),
      pinned: this.deps.pinned
        ? `Conch was started with CONCH_ENGINE=${this.deps.pinned}, so it’s the only provider.`
        : undefined,
    };
  }

  async get(id: EngineId, options: { force?: boolean } = {}): Promise<Provider> {
    this.#engineOrThrow(id);
    return this.#describe(id, await this.load(), options);
  }

  async #describe(id: EngineId, active: EngineId, options: { force?: boolean }): Promise<Provider> {
    const copy = PROVIDER_COPY.get(id);
    const engine = this.#engineOrThrow(id);
    const status = await this.#detect(engine, options.force);
    let key: SavedSecret | undefined;
    try {
      key = await this.deps.keys.describe(id);
    } catch {
      // Describing a key must never fail a page; the status already says enough.
    }
    return {
      id,
      // A stand-in is named by whatever it's standing in for.
      name: (copy?.internal ? status.label : copy?.name) ?? engine.label,
      tagline: copy?.tagline ?? '',
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
    const copy = PROVIDER_COPY.get(id);
    if (!copy?.keyForm)
      throw new ProviderError(`${copy?.name ?? engine.label} doesn’t take a key.`);

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
    const pattern = copy.keyForm.pattern;
    if (resolved && pattern && !new RegExp(pattern).test(resolved)) {
      await this.#restore(id, previous);
      throw new ProviderError(
        stored.source === '1password'
          ? `That 1Password field doesn’t look like a key. ${copy.keyForm.patternHint ?? ''}`.trim()
          : (copy.keyForm.patternHint ?? 'That doesn’t look like a key.'),
      );
    }

    await engine.setApiKey?.(resolved);
    const status = await this.#detect(engine, true);
    if (status.state === 'signed-out' || status.state === 'error') {
      await this.#restore(id, previous);
      throw new ProviderError(status.message ?? `${copy.name} didn’t accept that key.`);
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
    await this.deps.keys.clear(id);
    await engine.setApiKey?.(undefined);
    await this.#detect(engine, true);
    return this.list();
  }

  async #restore(id: EngineId, previous: Awaited<ReturnType<ProviderKeys['stored']>>) {
    if (previous) await this.deps.settings.setProviderSecret(id, previous);
    else await this.deps.keys.clear(id);
  }
}
