/**
 * Providers — connecting them, switching between them, and saying how they are.
 *
 * Conch drives one engine at a time. Which one is a *preference*, not an
 * environment variable, so it can be changed from Settings and remembered. An
 * operator who sets `CONCH_ENGINE` pins the choice: the UI then says so instead
 * of offering a switch that wouldn't take.
 */
import type {
  EngineId,
  Provider,
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
  /** Called after the active provider changes, so limits and models are re-read. */
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

  /** The engine every turn goes through. */
  engine(): Engine {
    const engines = this.deps.engines;
    return engines.get(this.activeIdNow()) ?? (engines.get('claude-code') as Engine);
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
    const ids = this.deps.pinned
      ? [this.deps.pinned]
      : PROVIDER_ORDER.filter((id) => {
          const copy = PROVIDER_COPY.get(id);
          if (!copy || !this.deps.engines.has(id)) return false;
          // The test double is only interesting when Conch is running on it.
          return !copy.internal || id === active;
        });
    const providers = await Promise.all(
      ids.map((id: EngineId) => this.#describe(id, active, options)),
    );
    return {
      active,
      providers,
      onePassword: await this.deps.keys.vault.onePassword.state(),
      pinned: this.deps.pinned
        ? `Conch was started with CONCH_ENGINE=${this.deps.pinned}, so the provider is fixed.`
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

  /** Make `id` the provider new conversations use. */
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
