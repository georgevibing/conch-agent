/**
 * Your company's cloud as a provider (ADR 0109).
 *
 * - **Amazon Bedrock** — Claude through Bedrock's Messages API endpoint
 *   (`bedrock-mantle.{region}.api.aws/anthropic`), signed with the AWS
 *   sign-in you picked (SigV4), or a Bedrock API key.
 * - **Google Vertex AI** — Claude through Vertex's `rawPredict`, with a token
 *   from your Google Cloud sign-in, billed to the project you picked.
 * - **Azure OpenAI** — your resource's deployments through Azure's v1 API,
 *   with a token from your Azure sign-in.
 *
 * Bedrock and Vertex speak Anthropic's Messages API, so they are the
 * Anthropic wire with a route (`AnthropicRoute`): thinking, caching, tools and
 * healing are the same code as for Anthropic's own API. Azure speaks
 * OpenAI's, so it is the OpenAI wire with a token in place of a key.
 *
 * None of them invents a model. Bedrock and Vertex have no model list, so
 * each Claude model is asked about with a free token count and only the ones
 * the account can use are offered (`usable`); Azure lists your deployments.
 */
import type { EngineStatus, LoginState } from '@conch/protocol';

import { signRequest } from '../../clouds/sigv4';
import { CloudError } from '../../clouds/errors';
import {
  BEDROCK_MODEL,
  candidates,
  modelEntry,
  vertexHost,
  VERTEX_MODEL,
  type ClaudeModel,
} from '../../clouds/models';
import type { CloudService } from '../../clouds/service';
import type { Completion, LoginHandle, Picture } from '../types';
import { AnthropicWire, type AnthropicRoute, type RoutedRequest } from './anthropic';
import { OpenAiWire, type ChatPreset } from './openai';
import { defaultHome } from './session';
import {
  ApiError,
  type ApiDeps,
  type ApiVariant,
  type FetchLike,
  type WireAccount,
  type WireCompletion,
  type WireEvent,
  type WireMessage,
  type WireModel,
  type WireRequest,
} from './types';
import { send, type ToolResult, type Wire } from './wire';

const ANTHROPIC_VERSION = '2023-06-01';
const VERTEX_VERSION = 'vertex-2023-10-16';
/** A model list is asked for at most this often per account; the engine keeps it longer. */
const PROBE_MS = 5 * 60_000;

/** One probe's answer: the account can use it, can't, or Conch couldn't tell. */
type Probe = 'yes' | 'no' | 'unsure';

/** What a free token count's status says about a model. A refused sign-in is thrown. */
export function probed(status: number, said: string): Probe {
  if (status >= 200 && status < 300) return 'yes';
  if (status === 401) throw new ApiError('auth', said || 'The cloud refused this sign-in.');
  if (status === 403 || status === 404) return 'no';
  if (status === 400 && /model|not (found|available|supported)|invalid.*id|access/i.test(said))
    return 'no';
  return 'unsure';
}

/**
 * The models an account can use: each candidate asked about with a free
 * token count, all at once. A model Conch couldn't ask about (a blip, a
 * throttle) is offered anyway, as the cloud would answer for it at use.
 */
export async function usable(
  list: readonly { id: string; model: ClaudeModel }[],
  ask: (id: string) => Promise<Probe>,
): Promise<Record<string, unknown>[]> {
  const answers = await Promise.all(
    list.map(async (entry, rank) => ({
      entry,
      rank,
      answer: await ask(entry.id).catch((error: unknown) => {
        if (error instanceof ApiError && error.kind === 'auth') throw error;
        return 'unsure' as const;
      }),
    })),
  );
  return answers
    .filter((a) => a.answer !== 'no')
    .map((a) => modelEntry(a.entry.id, a.entry.model, a.rank));
}

/** Memo for a model list, by account: the probes are free, but not instant. */
function memo() {
  let last: { at: number; id: string; value: Record<string, unknown>[] } | undefined;
  return async (id: string, load: () => Promise<Record<string, unknown>[]>) => {
    if (last && last.id === id && Date.now() - last.at < PROBE_MS) return last.value;
    const value = await load();
    last = { at: Date.now(), id, value };
    return value;
  };
}

async function said(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return (body.error?.message ?? body.message ?? '').slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

// ── Amazon Bedrock ──────────────────────────────────────────────────────────

/** A Bedrock API key: AWS's own marks for its long-term and short-term keys. */
export const BEDROCK_KEY = /^(ABSK[A-Za-z0-9+/=]{20,}|bedrock-api-key-[A-Za-z0-9+/=_-]{20,})$/;

function bedrockRoute(clouds: CloudService, fetchImpl: FetchLike): AnthropicRoute {
  const where = async () => {
    const choice = await clouds.choice('bedrock');
    return { region: choice?.region ?? 'us-east-1', choice };
  };
  const signed = async (
    url: string,
    body: Record<string, unknown>,
    key: string,
    extra: Record<string, string>,
    region: string,
    service: 'bedrock-mantle' | 'bedrock',
    method: 'GET' | 'POST' = 'POST',
  ): Promise<Record<string, string>> => {
    const headers = { 'content-type': 'application/json', ...extra };
    // A Bedrock API key needs no signing: Bedrock reads it as it is.
    if (key)
      return service === 'bedrock-mantle'
        ? { ...headers, 'x-api-key': key }
        : { ...headers, authorization: `Bearer ${key}` };
    const choice = await clouds.choice('bedrock');
    if (!choice) throw new CloudError('not-chosen', 'Choose an AWS account for Amazon Bedrock.');
    const credentials = await clouds.aws.credentials(choice.account);
    return signRequest({
      method,
      url,
      ...(method === 'POST' && { body: JSON.stringify(body) }),
      headers,
      region,
      service,
      credentials,
    });
  };
  const prepare: AnthropicRoute['prepare'] = async (input) => {
    if (!BEDROCK_MODEL.test(input.model))
      throw new ApiError(
        'not-found',
        'That isn’t a Claude model on Amazon Bedrock. Pick another one.',
      );
    const { region } = await where();
    const url = `https://bedrock-mantle.${region}.api.aws/anthropic/v1/messages${input.kind === 'count' ? '/count_tokens' : ''}`;
    const body = input.body;
    const headers = await signed(
      url,
      body,
      input.key,
      {
        'anthropic-version': ANTHROPIC_VERSION,
        ...(input.beta && { 'anthropic-beta': input.beta }),
      },
      region,
      'bedrock-mantle',
    );
    return { url, headers, body } satisfies RoutedRequest;
  };
  const remember = memo();

  /** Claude models Bedrock lists by itself that Conch doesn't know yet join the candidates. */
  const listed = async (
    region: string,
    key: string,
  ): Promise<{ id: string; model: ClaudeModel }[]> => {
    const url = `https://bedrock.${region}.amazonaws.com/foundation-models?byProvider=anthropic&byOutputModality=TEXT`;
    try {
      const response = await send({
        fetchImpl,
        url,
        method: 'GET',
        headers: await signed(url, {}, key, {}, region, 'bedrock', 'GET'),
        label: 'Amazon Bedrock',
        ...(key && { key }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as { modelSummaries?: unknown[] };
      const known = new Set(candidates('bedrock').map((c) => c.id));
      return (body.modelSummaries ?? []).flatMap((raw) => {
        const summary = raw as {
          modelId?: unknown;
          modelName?: unknown;
          modelLifecycle?: { status?: unknown };
        };
        const id = typeof summary.modelId === 'string' ? summary.modelId : '';
        if (!BEDROCK_MODEL.test(id) || known.has(id) || summary.modelLifecycle?.status === 'LEGACY')
          return [];
        return [
          {
            id,
            model: {
              base: id.replace(/^anthropic\./, ''),
              name: typeof summary.modelName === 'string' ? summary.modelName : id,
              context: 200_000,
              efforts: [],
              thinking: false,
              maxOutput: 32_000,
            },
          },
        ];
      });
    } catch {
      return [];
    }
  };

  const list: AnthropicRoute['list'] = async ({ key, signal }) => {
    const { region, choice } = await where();
    return remember(`${key ? 'key' : choice?.account}|${region}`, async () => {
      const all = [...candidates('bedrock'), ...(await listed(region, key))];
      return usable(all, async (id) => {
        const { url, headers, body } = await prepare({
          kind: 'count',
          stream: false,
          model: id,
          body: { model: id, messages: [{ role: 'user', content: 'hi' }] },
          key,
        });
        const response = await send({
          fetchImpl,
          url,
          method: 'POST',
          headers,
          body,
          label: 'Amazon Bedrock',
          ...(key && { key }),
          signal: signal ?? AbortSignal.timeout(15_000),
        });
        return probed(response.status, await said(response));
      });
    });
  };

  return {
    voice: {
      label: 'Amazon Bedrock',
      refused:
        'Amazon Bedrock refused this AWS sign-in. Sign in to AWS again, or choose another account.',
      forbidden:
        'This AWS account isn’t allowed to use that model. Turn on model access in the Bedrock console, or pick another model.',
      missing:
        'That model isn’t in Amazon Bedrock in this region. Pick another model, or another region.',
    },
    prepare,
    list,
    async check({ key, signal }) {
      const { region, choice } = await where();
      const models = await list({ key, ...(signal && { signal }) });
      if (!models.length)
        throw new CloudError(
          'no-access',
          `This AWS account can’t use Claude in ${region} yet. Turn on model access in the Bedrock console, or choose another region.`,
        );
      const who = key ? 'Bedrock API key' : (choice?.label ?? choice?.account ?? 'AWS');
      return {
        description: `${who} · ${region} · ${models.length} model${models.length === 1 ? '' : 's'}`,
      };
    },
  };
}

// ── Google Vertex AI ────────────────────────────────────────────────────────

function vertexRoute(clouds: CloudService, fetchImpl: FetchLike): AnthropicRoute {
  const where = async () => {
    const choice = await clouds.choice('vertex');
    if (!choice) throw new CloudError('not-chosen', 'Choose a Google Cloud project for Vertex AI.');
    return { project: choice.account, region: choice.region ?? 'global', label: choice.label };
  };
  const prepare: AnthropicRoute['prepare'] = async (input) => {
    if (!VERTEX_MODEL.test(input.model))
      throw new ApiError('not-found', 'That isn’t a Claude model on Vertex AI. Pick another one.');
    const { project, region } = await where();
    const token = await clouds.gcp.token();
    const host = vertexHost(region);
    const base = `https://${host}/v1/projects/${project}/locations/${region}/publishers/anthropic/models`;
    const { model: _model, ...rest } = input.body;
    const url =
      input.kind === 'count'
        ? `${base}/count-tokens:rawPredict`
        : `${base}/${input.model}:${input.stream ? 'streamRawPredict' : 'rawPredict'}`;
    const body =
      input.kind === 'count'
        ? { anthropic_version: VERTEX_VERSION, ...input.body }
        : { anthropic_version: VERTEX_VERSION, ...rest };
    return {
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        // Bill the project you chose, whoever's sign-in it is.
        'x-goog-user-project': project,
        ...(input.beta && { 'anthropic-beta': input.beta }),
      },
      body,
    };
  };
  const remember = memo();
  const list: AnthropicRoute['list'] = async ({ signal }) => {
    const { project, region } = await where();
    return remember(`${project}|${region}`, () =>
      usable(candidates('vertex'), async (id) => {
        const { url, headers, body } = await prepare({
          kind: 'count',
          stream: false,
          model: id,
          body: { model: id, messages: [{ role: 'user', content: 'hi' }] },
          key: '',
        });
        const response = await send({
          fetchImpl,
          url,
          method: 'POST',
          headers,
          body,
          label: 'Google Vertex AI',
          signal: signal ?? AbortSignal.timeout(15_000),
        });
        return probed(response.status, await said(response));
      }),
    );
  };
  return {
    voice: {
      label: 'Google Vertex AI',
      refused: 'Google Cloud refused this sign-in. Sign in to Google Cloud again.',
      forbidden:
        'This project can’t use that model yet. Turn Claude on in Vertex AI’s Model Garden, or pick another model.',
      missing:
        'That model isn’t on Vertex AI in this region. Pick another model, or the global region.',
    },
    prepare,
    list,
    async check({ signal }) {
      const { project, region, label } = await where();
      const models = await list({ key: '', ...(signal && { signal }) });
      if (!models.length)
        throw new CloudError(
          'no-access',
          `Project ${project} can’t use Claude yet. Turn Claude on in Vertex AI’s Model Garden, and Conch notices.`,
        );
      return {
        description: `${label ?? project} · ${region === 'global' ? 'Global' : region.toUpperCase()} · ${models.length} model${models.length === 1 ? '' : 's'}`,
      };
    },
  };
}

// ── Azure OpenAI ────────────────────────────────────────────────────────────

/** A deployment that isn't a chat model: embeddings, speech, pictures. */
const NOT_CHAT =
  /(embedding|whisper|tts|dall-e|gpt-image|sora|transcribe|realtime|audio|moderation)/i;
const SEES = /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o3|o4|vision)/i;
const REASONS = /^(o\d|gpt-5)/i;

/** OpenAI's wire, with a token from your Azure sign-in in place of a key. */
class AzureWire implements Wire {
  readonly source = 'Azure OpenAI';
  readonly #inner: OpenAiWire;
  /** The chosen resource's address, set before each request. */
  readonly #at = { base: '' };

  constructor(
    private readonly clouds: CloudService,
    fetchImpl: FetchLike,
  ) {
    const at = this.#at;
    const preset: ChatPreset = {
      id: 'azure-openai',
      label: 'Azure OpenAI',
      get endpoints() {
        return [{ id: 'resource', base: at.base }];
      },
      // A deployment name is what a request names; the model behind it says what it can do.
      listModels: async () => {
        const choice = await clouds.choice('azure-openai');
        if (!choice)
          throw new CloudError('not-chosen', 'Choose an Azure resource for Azure OpenAI.');
        const deployments = await clouds.azure.deployments(choice.account, choice.tenant);
        return deployments.flatMap((d) => {
          const model = d.properties?.model?.name ?? d.name;
          if (NOT_CHAT.test(model) || NOT_CHAT.test(d.name)) return [];
          if (d.properties?.model?.format && !/openai/i.test(d.properties.model.format)) return [];
          return [
            {
              id: d.name,
              display_name: model === d.name ? model : `${model} · ${d.name}`,
              type: 'chat',
              capabilities: { vision: SEES.test(model), function_calling: true },
              ...(REASONS.test(model) && {
                effort: { supported_levels: ['low', 'medium', 'high'] },
              }),
            },
          ];
        });
      },
      small: /(mini|nano|small)/i,
      maxTokens: 'max_completion_tokens',
    };
    this.#inner = new OpenAiWire(preset, fetchImpl);
  }

  /** The resource's address and a fresh token, for one request. */
  async #token(): Promise<string> {
    const choice = await this.clouds.choice('azure-openai');
    if (!choice?.endpoint)
      throw new CloudError('not-chosen', 'Choose an Azure resource for Azure OpenAI.');
    this.#at.base = `${choice.endpoint}/openai/v1`;
    return this.clouds.azure.token('cognitive', choice.tenant);
  }

  async check(input: { key: string; signal?: AbortSignal }): Promise<WireAccount> {
    const token = await this.#token();
    await this.#inner.check({ key: token, ...(input.signal && { signal: input.signal }) });
    const choice = await this.clouds.choice('azure-openai');
    const models = await this.#inner.models({ key: token });
    if (!models.length)
      throw new CloudError(
        'no-access',
        `${choice?.label ?? 'This resource'} has no chat model deployed yet. Deploy one in the Azure AI Foundry portal, and Conch notices.`,
      );
    return {
      description: `${choice?.label ?? 'Azure'}${choice?.region ? ` · ${choice.region}` : ''} · ${models.length} deployment${models.length === 1 ? '' : 's'}`,
    };
  }

  async models(input: { key?: string; signal?: AbortSignal }): Promise<WireModel[]> {
    const token = await this.#token();
    return this.#inner.models({ key: token, ...(input.signal && { signal: input.signal }) });
  }

  async *stream(request: WireRequest): AsyncIterable<WireEvent> {
    const token = await this.#token();
    yield* this.#inner.stream({ ...request, key: token });
  }

  async complete(request: WireCompletion): Promise<Completion> {
    const token = await this.#token();
    return this.#inner.complete({ ...request, key: token });
  }

  userMessage(text: string, images?: readonly Picture[]): WireMessage {
    return this.#inner.userMessage(text, images);
  }

  toolResults(results: ToolResult[]): WireMessage[] {
    return this.#inner.toolResults(results);
  }

  smallModel(): string | undefined {
    return this.#inner.smallModel();
  }

  toolsFor(model: string): boolean | undefined {
    return this.#inner.toolsFor(model);
  }

  seesFor(model: string): boolean | undefined {
    return this.#inner.seesFor(model);
  }
}

// ── The variants ────────────────────────────────────────────────────────────

const METHOD = { bedrock: 'bedrock', vertex: 'vertex', 'azure-openai': 'foundry' } as const;
const PICK = {
  bedrock: 'Choose the AWS account Conch should use. It found the ones on this computer.',
  vertex: 'Choose the Google Cloud project Conch should bill.',
  'azure-openai': 'Choose the Azure OpenAI resource Conch should use.',
} as const;

/**
 * How a cloud provider is, for its card: nothing chosen (not ready, so no bill
 * starts by itself), a sign-in that ended (one press signs in again), the
 * cloud's program missing (one press installs it), or ready with its models.
 */
async function cloudStatus(
  id: 'bedrock' | 'vertex' | 'azure-openai',
  label: string,
  docsUrl: string,
  clouds: CloudService,
  wire: Wire,
  key: string | undefined,
): Promise<EngineStatus> {
  const base = {
    engine: id,
    label,
    install: [],
    docsUrl,
    canSignIn: false,
    checkedAt: Date.now(),
  } satisfies Omit<EngineStatus, 'state'>;
  const choice = await clouds.choice(id);
  if (!choice && !key) return { ...base, state: 'signed-out', message: PICK[id] };
  try {
    const account = await wire.check({ key: key ?? '', signal: AbortSignal.timeout(30_000) });
    return {
      ...base,
      state: 'ready',
      auth: { method: METHOD[id], description: `${label} · ${account.description}` },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} didn’t answer.`;
    if (error instanceof CloudError) {
      if (error.problem === 'missing-tool' || error.problem === 'outdated-tool')
        return {
          ...base,
          state: error.problem === 'missing-tool' ? 'not-installed' : 'error',
          message,
          ...(error.need && {
            fix: {
              need: error.need,
              kind: error.problem === 'missing-tool' ? 'install' : 'update',
            },
          }),
        };
      if (error.problem === 'signed-out' || error.problem === 'not-chosen')
        return {
          ...base,
          state: 'signed-out',
          message,
          canSignIn: error.problem === 'signed-out',
        };
      return { ...base, state: 'error', message };
    }
    if (error instanceof ApiError && error.kind === 'auth')
      return { ...base, state: 'signed-out', message, canSignIn: !key };
    return { ...base, state: 'error', message };
  }
}

/** The cloud's own sign-in, as the provider's (`aws sso login`, `gcloud`, `az login`). */
function cloudLogin(clouds: CloudService, id: 'bedrock' | 'vertex' | 'azure-openai') {
  return (update: (state: LoginState) => void): LoginHandle => {
    let handle: LoginHandle | undefined;
    let cancelled = false;
    void clouds
      .signIn(id, update)
      .then((started) => {
        handle = started;
        if (cancelled) started.cancel();
      })
      .catch((error: unknown) =>
        update({
          loginId: 'cloud',
          phase: 'failed',
          message: error instanceof Error ? error.message : 'Signing in didn’t start.',
        }),
      );
    return {
      submitCode: (code) => handle?.submitCode(code),
      cancel: () => {
        cancelled = true;
        handle?.cancel();
      },
    };
  };
}

export interface CloudVariantDeps extends ApiDeps {
  clouds: CloudService;
}

export function bedrockVariant(deps: CloudVariantDeps): ApiVariant {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const wire = new AnthropicWire(fetchImpl, bedrockRoute(deps.clouds, fetchImpl));
  const docsUrl = 'https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html';
  return {
    id: 'bedrock',
    label: 'Amazon Bedrock',
    docsUrl,
    keyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys',
    canSignIn: false,
    // A Bedrock API key is one way in; an AWS sign-in is the other.
    keyOptional: true,
    wire,
    home: deps.home ?? defaultHome(),
    status: (key) => cloudStatus('bedrock', 'Amazon Bedrock', docsUrl, deps.clouds, wire, key),
    login: cloudLogin(deps.clouds, 'bedrock'),
  };
}

export function vertexVariant(deps: CloudVariantDeps): ApiVariant {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const wire = new AnthropicWire(fetchImpl, vertexRoute(deps.clouds, fetchImpl));
  const docsUrl = 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude';
  return {
    id: 'vertex',
    label: 'Google Vertex AI',
    docsUrl,
    keyUrl: 'https://console.cloud.google.com/vertex-ai/model-garden',
    canSignIn: false,
    keyless: true,
    wire,
    home: deps.home ?? defaultHome(),
    status: () => cloudStatus('vertex', 'Google Vertex AI', docsUrl, deps.clouds, wire, undefined),
    login: cloudLogin(deps.clouds, 'vertex'),
  };
}

export function azureVariant(deps: CloudVariantDeps): ApiVariant {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const wire = new AzureWire(deps.clouds, fetchImpl);
  const docsUrl = 'https://learn.microsoft.com/azure/ai-foundry/openai/';
  return {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    docsUrl,
    keyUrl: 'https://ai.azure.com',
    canSignIn: false,
    keyless: true,
    wire,
    home: deps.home ?? defaultHome(),
    status: () =>
      cloudStatus('azure-openai', 'Azure OpenAI', docsUrl, deps.clouds, wire, undefined),
    login: cloudLogin(deps.clouds, 'azure-openai'),
  };
}
