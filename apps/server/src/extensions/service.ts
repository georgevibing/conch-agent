/**
 * Providers and chat apps that Conch apps bring (ADR 0122): the one place
 * that joins what the apps you have declare to the rest of Conch.
 *
 * - **Providers.** Every app with `provider` in its manifest is a provider
 *   of its own (`app-<id>`) in the model picker and Settings → Providers, on
 *   the same engine every model API runs on. Its key is a provider key like
 *   any other, kept with them (never in the app); removing the app takes it
 *   away, with its key.
 * - **Chat apps.** Every app with `channel` is a tile in Apps → Talk to me
 *   here; each one connected is a channel like Telegram, its adapter the
 *   app's sealed code (`AppChannelAdapter`). Removing the app disconnects it.
 * - **The live test.** **Test it** on a card or a preview runs exactly the
 *   files on offer, sealed, with what the person typed for the test only: a
 *   one-line answer from a provider, or who the bot is for a chat app.
 * - **Adding it.** What the person typed into the card is kept where Conch
 *   keeps its own (`apply`): a provider's key with every provider key, a
 *   chat app's fields with every channel's.
 */
import {
  appProviderId,
  ownedHere,
  type AppPartTest,
  type AppPartValues,
  type ChannelCatalogEntry,
  type ChannelSecrets,
  type ConchAppManifest,
  type TestAppPartBody,
} from '@conch/protocol';

import type { ChannelDoorService } from '../channels/door';
import type { ChannelService } from '../channels/service';
import { ChannelError, type ChannelAdapter } from '../channels/types';
import type { ConchAppService } from '../conchapps/service';
import type { AppRecord } from '../conchapps/store';
import type { AppRuntime } from '../conchapps/types';
import type { ApiVariant, FetchLike } from '../engines/api/types';
import type { Engine } from '../engines/types';
import { ProviderError, type AppProviderInfo, type ProviderService } from '../providers/service';
import { AppChannelAdapter } from './channel';
import { partFetch, type PartFetchOptions } from './fetch';
import { partVariant, partWire, providerName } from './provider';

type WithProvider = ConchAppManifest & { provider: NonNullable<ConchAppManifest['provider']> };
type WithChannel = ConchAppManifest & { channel: NonNullable<ConchAppManifest['channel']> };

/** The test a provider answers: short, cheap, and impossible to mistake. */
const TEST_PROMPT = 'Say hello to the person setting you up, in five words or fewer.';
const TEST_MS = 60_000;

/** The colours an app's icon may take, as a chat app's tile colour when it names none. */
const TILE: Record<string, string> = {
  red: '#E5484D',
  orange: '#F76B15',
  amber: '#FFB224',
  yellow: '#F5D90A',
  lime: '#99D52A',
  green: '#30A46C',
  teal: '#12A594',
  cyan: '#05A2C2',
  blue: '#0090FF',
  indigo: '#3E63DD',
  violet: '#6E56CF',
  pink: '#D6409F',
  slate: '#687076',
};

export interface ExtensionServiceDeps {
  apps: Pick<ConchAppService, 'runtimeFor' | 'trial' | 'load'> & {
    store: { peek(): readonly AppRecord[] };
  };
  providers: ProviderService;
  /** The engine for a provider part: `new ApiEngine(variant, settings, keys)`. */
  engine: (variant: ApiVariant) => Engine;
  /** Made after this: the channels a chat app connects as. */
  channels: () => ChannelService | undefined;
  door?: ChannelDoorService;
  home: string;
  /** How a provider part reaches its company (`partFetch`); tests point it elsewhere. */
  fetchOptions?: Partial<Omit<PartFetchOptions, 'app' | 'provider'>>;
  log?: (message: string) => void;
}

export class ExtensionService {
  /** Each provider's engine, by app, and the files it was built from. */
  #engines = new Map<string, { hash: string; info: AppProviderInfo }>();
  #syncing?: Promise<void>;
  #again = false;

  constructor(private readonly deps: ExtensionServiceDeps) {}

  /** What the apps you have bring, now: their providers join or leave, their chat apps follow. */
  sync(): Promise<void> {
    if (this.#syncing) {
      this.#again = true;
      return this.#syncing;
    }
    this.#syncing = (async () => {
      do {
        this.#again = false;
        await this.#sync().catch((error: unknown) =>
          this.deps.log?.(`extensions: ${error instanceof Error ? error.message : String(error)}`),
        );
      } while (this.#again);
    })().finally(() => {
      this.#syncing = undefined;
    });
    return this.#syncing;
  }

  async #sync() {
    await this.deps.apps.load();
    const records = this.deps.apps.store.peek();
    const providers: AppProviderInfo[] = [];
    for (const record of records) {
      if (!record.enabled || !record.manifest.provider) continue;
      const held = this.#engines.get(record.id);
      if (held?.hash === record.hash) {
        providers.push(held.info);
        continue;
      }
      const info = this.#provider(record);
      this.#engines.set(record.id, { hash: record.hash, info });
      providers.push(info);
    }
    for (const id of [...this.#engines.keys()])
      if (!providers.some((p) => p.appId === id)) this.#engines.delete(id);
    await this.deps.providers.setAppProviders(providers);
    // A chat app whose app went: disconnected, its keys with it.
    const channels = this.deps.channels();
    if (channels) {
      const present = new Set(records.filter((r) => r.manifest.channel).map((r) => r.id));
      for (const channel of (await channels.list()).channels)
        if (channel.kind === 'app' && channel.contributed && !present.has(channel.contributed.app))
          await channels.remove(channel.id).catch(() => undefined);
    }
  }

  #fetch(manifest: WithProvider): FetchLike {
    return partFetch({
      ...this.deps.fetchOptions,
      app: { id: manifest.id, name: providerName(manifest), reaches: manifest.reaches },
      provider: manifest.provider,
    });
  }

  #provider(record: AppRecord): AppProviderInfo {
    const manifest = record.manifest as WithProvider;
    const part = manifest.provider;
    const id = appProviderId(record.id);
    const engine = this.deps.engine(
      partVariant({
        engineId: id,
        manifest,
        runtime: () => this.deps.apps.runtimeFor(record.id),
        fetch: this.#fetch(manifest),
        home: this.deps.home,
      }),
    );
    return {
      id,
      appId: record.id,
      name: providerName(manifest),
      tagline: manifest.tagline,
      description: manifest.description || manifest.tagline,
      ...(part.key && {
        keyForm: {
          label: part.key.label,
          placeholder: '',
          help:
            part.key.help ??
            `It’s kept by Conch with your other keys and sent only to ${manifest.reaches.join(', ')}.`,
          ...(part.key.link && { url: part.key.link }),
          ...(part.key.pattern && { pattern: part.key.pattern }),
          canSignIn: false,
        },
      }),
      from: ownedHere(record.source) ? 'made' : 'link',
      speaks: part.speaks,
      reaches: [...manifest.reaches],
      engine,
    };
  }

  // ── Chat apps ───────────────────────────────────────────────────────────

  /** The tiles in Apps → Talk to me here for the chat apps your apps bring. */
  catalog(): ChannelCatalogEntry[] {
    return this.deps.apps.store
      .peek()
      .filter((r) => r.enabled && r.manifest.channel)
      .map((record) => {
        const manifest = record.manifest as WithChannel;
        const part = manifest.channel;
        return {
          id: `app:${record.id}`,
          name: part.name ?? manifest.name,
          tagline: manifest.tagline,
          short: manifest.tagline.slice(0, 40),
          color: part.color ?? TILE[manifest.icon.color] ?? '#687076',
          available: true,
          contributed: {
            app: record.id,
            fields: part.fields.map((f) => ({
              key: f.key,
              label: f.label,
              ...(f.help && { help: f.help }),
              ...(f.link && { link: f.link }),
              ...(f.placeholder && { placeholder: f.placeholder }),
              secret: f.secret,
              optional: f.optional,
            })),
            steps: [...part.steps],
            receives: part.receives,
            from: ownedHere(record.source) ? 'made' : 'link',
          },
        };
      });
  }

  /** What a chat app is called, by its app. */
  name(app: string): string | undefined {
    const record = this.deps.apps.store.peek().find((r) => r.id === app);
    return record?.manifest.channel
      ? (record.manifest.channel.name ?? record.manifest.name)
      : undefined;
  }

  /** Made here, by the person: its code may speak for its owner (`ChannelService`'s `trusted`). */
  trusted(app: string): boolean {
    const record = this.deps.apps.store.peek().find((r) => r.id === app);
    return Boolean(record && ownedHere(record.source));
  }

  /** The adapter for a chat app's channel: the app's sealed code, while the app is here and on. */
  adapter(secrets: Extract<ChannelSecrets, { kind: 'app' }>): ChannelAdapter {
    const record = () => this.deps.apps.store.peek().find((r) => r.id === secrets.app);
    const now = record();
    const name = now?.manifest.channel?.name ?? now?.manifest.name ?? 'This chat app';
    return new AppChannelAdapter(secrets, {
      name,
      part: now?.manifest.channel ?? { receives: 'poll', fields: [], steps: [], buttons: false },
      runtime: async (): Promise<AppRuntime> => {
        const current = record();
        if (!current?.manifest.channel)
          throw new ChannelError('setup', `${name}’s app isn’t in Conch any more. Add it again.`);
        if (!current.enabled)
          throw new ChannelError('setup', `${name}’s app is turned off in Apps. Turn it on again.`);
        return this.deps.apps.runtimeFor(current.id);
      },
      ...(this.deps.door && { door: this.deps.door }),
    });
  }

  // ── The live test ───────────────────────────────────────────────────────

  /**
   * **Test it**: exactly the files on offer, sealed, with what the person
   * typed, used for this and nothing else. A provider answers one line; a
   * chat app says who its bot is (the hello comes once it's added).
   */
  async test(
    ref: { conversationId: string; offerId: string } | { packageId: string; appId: string },
    body: TestAppPartBody,
  ): Promise<AppPartTest> {
    const trial = await this.deps.apps.trial(ref);
    try {
      return await this.testWith(trial.manifest, trial.runtime, body);
    } finally {
      await trial.dispose();
    }
  }

  /** The live test on a runtime already sealed on the files to test (a card's, a draft's). */
  async testWith(
    manifest: ConchAppManifest,
    runtime: AppRuntime,
    body: TestAppPartBody,
  ): Promise<AppPartTest> {
    const started = Date.now();
    const trial = { runtime };
    const part = body.part ?? (manifest.provider ? 'provider' : 'channel');
    try {
      if (part === 'provider' && manifest.provider) {
        const withProvider = manifest as WithProvider;
        const wire = partWire({
          engineId: appProviderId(manifest.id),
          manifest: withProvider,
          runtime: async () => trial.runtime,
          fetch: this.#fetch(withProvider),
          home: this.deps.home,
        });
        const key = body.key?.trim() ?? '';
        const signal = AbortSignal.timeout(TEST_MS);
        if (!key && withProvider.provider.auth !== 'none' && !withProvider.provider.key?.optional)
          return {
            ok: false,
            part,
            message: `Paste your ${withProvider.provider.key?.label ?? 'key'} first: the test sends one short question with it.`,
          };
        const model =
          withProvider.provider.small ??
          withProvider.provider.models[0]?.id ??
          (await wire.models({ key, signal }))[0]?.info.id;
        if (!model)
          return { ok: false, part, message: `${providerName(manifest)} listed no models to try.` };
        const answer = await wire.complete({
          key,
          model,
          system: 'You are being connected to Conch. Answer in one short, friendly line.',
          prompt: TEST_PROMPT,
          maxTokens: 60,
          signal,
        });
        const said = answer.text.replace(/\s+/g, ' ').trim();
        if (!said)
          return {
            ok: false,
            part,
            message: `${providerName(manifest)} answered, but said nothing. Try another model, or check the address.`,
          };
        return { ok: true, part, said: said.slice(0, 400), model, ms: Date.now() - started };
      }
      if (part === 'channel' && manifest.channel) {
        const missing = manifest.channel.fields.find(
          (f) => !f.optional && !body.fields[f.key]?.trim(),
        );
        if (missing)
          return { ok: false, part, field: missing.key, message: `Paste ${missing.label} first.` };
        const adapter = new AppChannelAdapter(
          {
            kind: 'app',
            app: manifest.id,
            fields: Object.fromEntries(
              Object.entries(body.fields).map(([key, value]) => [key, value.trim()]),
            ),
          },
          {
            name: manifest.channel.name ?? manifest.name,
            part: manifest.channel,
            runtime: async () => trial.runtime,
          },
        );
        const bot = await adapter.identify(AbortSignal.timeout(TEST_MS));
        return {
          ok: true,
          part,
          said: `Connected as ${bot.name}${bot.username ? ` (@${bot.username})` : ''}`,
          ms: Date.now() - started,
        };
      }
      return { ok: false, part, message: 'There’s nothing like that in this app to test.' };
    } catch (error) {
      return {
        ok: false,
        part,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      };
    }
  }

  // ── Adding it ───────────────────────────────────────────────────────────

  /**
   * What the person typed into the card, kept where Conch keeps its own,
   * once the app is in: a provider's key (checked as every key is), a chat
   * app connected as a channel (its hello waiting). Undefined when all went
   * in; else why not, in one sentence.
   */
  async apply(appId: string, values: AppPartValues | undefined): Promise<string | undefined> {
    await this.sync();
    const record = this.deps.apps.store.peek().find((r) => r.id === appId);
    if (!record || !values) return undefined;
    const problems: string[] = [];
    const provider = record.manifest.provider;
    if (provider && values.key?.trim() && provider.auth !== 'none')
      await this.deps.providers
        .setKey(appProviderId(appId), values.key.trim())
        .catch((error: unknown) =>
          problems.push(
            error instanceof ProviderError ? error.message : 'Its key couldn’t be kept.',
          ),
        );
    const channel = record.manifest.channel;
    const channels = this.deps.channels();
    if (channel && channels && Object.values(values.fields).some((v) => v.trim()))
      await channels
        .create({ kind: 'app', app: appId, fields: values.fields })
        .catch((error: unknown) =>
          problems.push(error instanceof Error ? error.message : 'It couldn’t connect.'),
        );
    return problems.length ? problems.join(' ').slice(0, 500) : undefined;
  }
}
