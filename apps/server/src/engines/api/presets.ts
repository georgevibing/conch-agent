/**
 * The model APIs Conch knows by name, as rows (ADR 0053). Each says where the
 * provider answers, how its list reads and what's different about it; the
 * shared adapter (`openai.ts`) does the rest.
 *
 * Every fact here was checked against the provider's own documentation and a
 * live request on 2026-10-02/03 (the research notes are in the ADR). What a
 * row can't know — the models, their names, what they can do — is read live
 * from the provider each time; nothing here names a model.
 */
import type { BuiltInEngineId } from '@conch/protocol';

import { ApiError } from './types';
import type { ChatPreset, ListContext, ModelFacts } from './openai';

export type PresetId = Extract<
  BuiltInEngineId,
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'groq'
  | 'cerebras'
  | 'zai'
  | 'moonshot'
  | 'minimax'
  | 'qwen'
  | 'ollama-cloud'
>;

/** A preset, with the pages a person needs. */
export interface Preset extends ChatPreset {
  id: PresetId;
  docsUrl: string;
  keyUrl: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Gemini's own list says what each model is; the compatibility list only gives ids. */
async function geminiModels(context: ListContext): Promise<unknown[]> {
  const out: unknown[] = [];
  let page: string | undefined;
  for (let i = 0; i < 5; i++) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (page) url.searchParams.set('pageToken', page);
    const body = await context.get(url.toString(), {
      // The native API reads a Bearer header as an OAuth token and refuses it.
      bearer: false,
      headers: { 'x-goog-api-key': context.key ?? '' },
    });
    if (!isRecord(body)) break;
    if (Array.isArray(body.models)) out.push(...body.models);
    page = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
    if (!page) break;
  }
  return out;
}

function geminiFacts(entry: Record<string, unknown>): Partial<ModelFacts> {
  const name = typeof entry.name === 'string' ? entry.name.replace(/^models\//, '') : undefined;
  const methods = Array.isArray(entry.supportedGenerationMethods)
    ? entry.supportedGenerationMethods
    : undefined;
  return {
    ...(name && { id: name }),
    ...(methods && { chat: methods.includes('generateContent') }),
    // Every Gemini chat model looks at pictures.
    images: true,
    ...(typeof entry.thinking === 'boolean' && { thinking: entry.thinking }),
  };
}

/**
 * Ollama's cloud lists its models publicly by name only; `show` says what each
 * can do. Both read without a key.
 */
async function ollamaModels(context: ListContext): Promise<unknown[]> {
  const tags = await context.get('https://ollama.com/api/tags', { bearer: false });
  const models = isRecord(tags) && Array.isArray(tags.models) ? tags.models.filter(isRecord) : [];
  const shown = await Promise.all(
    models.slice(0, 60).map(async (model) => {
      const name = typeof model.name === 'string' ? model.name : undefined;
      if (!name) return undefined;
      const show = await context
        .post('https://ollama.com/api/show', { model: name }, { bearer: false })
        .catch(() => undefined);
      return { ...model, id: name, show };
    }),
  );
  return shown.filter(Boolean);
}

function ollamaFacts(entry: Record<string, unknown>): Partial<ModelFacts> {
  const show = isRecord(entry.show) ? entry.show : {};
  const caps = Array.isArray(show.capabilities) ? show.capabilities : [];
  const info = isRecord(show.model_info) ? show.model_info : {};
  const arch = typeof info['general.architecture'] === 'string' ? info['general.architecture'] : '';
  const context = info[`${arch}.context_length`];
  const thinking =
    isRecord(show.thinking) && Array.isArray(show.thinking.values) ? show.thinking.values : [];
  return {
    ...(typeof entry.id === 'string' && { id: entry.id }),
    ...(caps.length && {
      tools: caps.includes('tools'),
      images: caps.includes('vision'),
      thinking: caps.includes('thinking'),
      chat: caps.includes('completion'),
    }),
    ...(typeof context === 'number' && { context }),
    // A model that takes levels names them; one that only turns thinking on doesn't.
    efforts: thinking.filter((v): v is string => typeof v === 'string'),
  };
}

/** Cerebras' authorised list only has ids; its public one says what each model can do. */
async function cerebrasModels(context: ListContext): Promise<unknown[]> {
  const body = await context.get('https://api.cerebras.ai/public/v1/models', { bearer: false });
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body.data)) return body.data;
  throw new ApiError('other', 'Cerebras sent a model list Conch didn’t understand.');
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    docsUrl: 'https://developers.openai.com/api/docs',
    keyUrl: 'https://platform.openai.com/settings/organization/api-keys',
    endpoints: [{ id: 'global', base: 'https://api.openai.com/v1' }],
    // Responses-only and special-purpose models a chat can't use.
    hide: /(deep-research|codex|search|-instruct|o1-pro|-pro$|gpt-3\.5)/i,
    rank: [/^gpt-6/, /^gpt-5/, /^o\d/, /^gpt-4\.1/, /^gpt-4o/],
    small: /(luna|nano|mini)/,
    // OpenAI: "Chat Completions does not support function calling with GPT-6 Astra or GPT-6.1 Sol."
    noTools: /^gpt-6(\.1)?-(astra|sol)\b/,
    // The list says nothing about sight; its chat models look at pictures.
    sees: true,
    efforts: (model) => (/^(o\d|gpt-5|gpt-6)/.test(model.id) ? ['low', 'medium', 'high'] : []),
    maxTokens: 'max_completion_tokens',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyUrl: 'https://aistudio.google.com/apikey',
    endpoints: [{ id: 'global', base: 'https://generativelanguage.googleapis.com/v1beta/openai' }],
    listModels: geminiModels,
    facts: geminiFacts,
    hide: /(embedding|aqa|imagen|veo|tts|native-audio|live|image|robotics|computer-use|learnlm)/i,
    rank: [/^gemini-\d/, /^gemma/],
    small: /flash-lite|flash/,
    // Gemma on the Gemini API has no function calling: its tools go in the prompt (ADR 0069).
    noTools: /^gemma/,
    sees: true,
    // The OpenAI endpoint reads only Gemini's OpenAPI subset of JSON Schema.
    schemas: 'gemini',
    efforts: (model) => (model.thinking ? ['low', 'medium', 'high'] : []),
  },
  {
    id: 'xai',
    label: 'xAI API',
    docsUrl: 'https://docs.x.ai/developers',
    keyUrl: 'https://console.x.ai/team/default/api-keys',
    endpoints: [{ id: 'global', base: 'https://api.x.ai/v1' }],
    hide: /(image|imagine|vision-beta)/i,
    rank: [/^grok-\d/],
    sees: /^grok-([4-9]|\d{2})/,
    small: /(fast|mini|non-reasoning)/,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    docsUrl: 'https://api-docs.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    endpoints: [{ id: 'global', base: 'https://api.deepseek.com' }],
    rank: [/pro/, /flash/],
    small: /flash/,
    // With tools, DeepSeek refuses a request that leaves out the earlier thinking.
    replayReasoning: 'reasoning_content',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    docsUrl: 'https://docs.mistral.ai',
    keyUrl: 'https://console.mistral.ai/api-keys',
    endpoints: [{ id: 'global', base: 'https://api.mistral.ai/v1' }],
    hide: /(ocr|moderation|embed|voxtral|saba)/i,
    rank: [/^mistral-(medium|large)/, /^(devstral|codestral)/, /^mistral-small/, /^ministral/],
    small: /(small|ministral|tiny)/,
    // Its list says which models see (`capabilities.vision`). A tool's
    // pictures follow its results, and Mistral wants a turn between.
    toolThenUser: 'bridge',
  },
  {
    id: 'groq',
    label: 'Groq',
    docsUrl: 'https://console.groq.com/docs',
    keyUrl: 'https://console.groq.com/keys',
    endpoints: [{ id: 'global', base: 'https://api.groq.com/openai/v1' }],
    rank: [/gpt-oss-120b/, /qwen/, /llama/],
    small: /(20b|8b|instant|mini)/,
    sees: /llama-4|scout|maverick|vision/,
    efforts: (model) => (/gpt-oss/.test(model.id) ? ['low', 'medium', 'high'] : []),
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    docsUrl: 'https://inference-docs.cerebras.ai',
    keyUrl: 'https://cloud.cerebras.ai',
    endpoints: [{ id: 'global', base: 'https://api.cerebras.ai/v1' }],
    listModels: cerebrasModels,
    // The public list reads without a key; the authorised one proves the key.
    checkPath: '/models',
    efforts: (model) => (/(gpt-oss|qwen)/.test(model.id) ? ['low', 'medium', 'high'] : []),
  },
  {
    id: 'zai',
    label: 'Z.ai',
    docsUrl: 'https://docs.z.ai',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    // The pay-as-you-go addresses. The GLM Coding Plan's terms keep it to the
    // coding tools Z.ai lists, so Conch doesn't use it.
    endpoints: [
      { id: 'intl', base: 'https://api.z.ai/api/paas/v4', label: 'International' },
      { id: 'cn', base: 'https://open.bigmodel.cn/api/paas/v4', label: 'China' },
    ],
    regionHint: '(or it’s from Z.ai’s other site: international keys and BigModel keys don’t mix)',
    rank: [/^glm-\d/],
    small: /(flash|air)/,
    sees: /^glm-[\d.]+v\b|vision/,
    efforts: (model) => (/^glm-5/.test(model.id) ? ['low', 'high', 'max'] : []),
  },
  {
    id: 'moonshot',
    label: 'Kimi',
    docsUrl: 'https://platform.kimi.ai/docs',
    keyUrl: 'https://platform.kimi.ai/console/api-keys',
    // The pay-as-you-go addresses; the Kimi Code plan is for the tools Moonshot lists.
    endpoints: [
      { id: 'intl', base: 'https://api.moonshot.ai/v1', label: 'International' },
      { id: 'cn', base: 'https://api.moonshot.cn/v1', label: 'China' },
    ],
    regionHint:
      '(or it’s from Kimi’s other site: platform.kimi.ai and platform.kimi.com keys don’t mix)',
    // Retired families.
    hide: /^(moonshot-v1|kimi-k2-)/,
    rank: [/k3/, /k2\.\d/],
    small: /(k2\.6|turbo|mini)/,
    sees: /k3|k2\.[5-9]|vision|vl/,
    replayReasoning: 'reasoning_content',
    efforts: (model) => (/k3/.test(model.id) ? ['low', 'high', 'max'] : []),
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    docsUrl: 'https://platform.minimax.io/docs',
    keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    endpoints: [
      { id: 'intl', base: 'https://api.minimax.io/v1', label: 'International' },
      { id: 'cn', base: 'https://api.minimaxi.com/v1', label: 'China' },
    ],
    regionHint: '(or it’s from MiniMax’s other site: international and China keys don’t mix)',
    rank: [/m3/i, /m2/i],
    small: /(highspeed|flash|lite)/i,
    // MiniMax thinks inside <think> tags in the answer, and wants them back.
    thinkTags: true,
  },
  {
    id: 'qwen',
    label: 'Qwen',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio',
    keyUrl: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key',
    // Alibaba Cloud's regions; a key only works in the one it was made in.
    endpoints: [
      {
        id: 'sg',
        base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        label: 'Singapore',
      },
      {
        id: 'us',
        base: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
        label: 'United States',
      },
      { id: 'cn', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: 'China' },
      {
        id: 'hk',
        base: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
        label: 'Hong Kong',
      },
    ],
    regionHint: '(or it was made for a region Conch didn’t try)',
    hide: /(ocr|asr|tts|realtime|wanx|paraformer|cosyvoice|gte-|image|livetranslate|mt-)/i,
    rank: [/max/, /plus/, /qwen3/, /flash|turbo/],
    small: /(flash|turbo)/,
    sees: /vl|omni|vision|qwen3\.[5-9]/,
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    docsUrl: 'https://docs.ollama.com/cloud',
    keyUrl: 'https://ollama.com/settings/keys',
    endpoints: [{ id: 'global', base: 'https://ollama.com/v1' }],
    listModels: ollamaModels,
    facts: ollamaFacts,
    // The model list is public, so it can't prove a key. This page can: it
    // refuses a bad key and answers a good one.
    checkKey: async (context) => {
      const status = await context.status('https://ollama.com/api/usage');
      if (status === 401 || status === 403)
        throw new ApiError('auth', 'Ollama refused your key. Add a new one in Settings.');
      if (status >= 500)
        throw new ApiError('overloaded', 'Ollama Cloud is unavailable right now.', {
          retryable: true,
        });
    },
    rank: [/gpt-oss:120b/, /deepseek/, /kimi/, /glm/, /qwen/],
    small: /(20b|flash|nano|mini)/,
  },
];

export const PRESET_IDS: readonly PresetId[] = PRESETS.map((p) => p.id);
