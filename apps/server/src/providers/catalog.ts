/**
 * What each provider is, in the words a person would use.
 *
 * The engine knows how to *talk* to a provider; this file knows how to
 * *describe* it — the sentence on the card, what it's good at, and what
 * connecting it takes. Adding a provider is an entry here plus an engine: a
 * folder under `engines/`, or a row in `engines/api/presets.ts` for a model API
 * that speaks OpenAI's chat shape (ADR 0053).
 *
 * Every claim here was checked against the provider's own pages (October
 * 2026). What costs nothing says so in `free`; what a provider can't do is in
 * `limits`, said before you connect rather than discovered after.
 */
import type {
  BuiltInEngineId,
  EngineId,
  KeyForm,
  ProviderConnect,
  ProviderGroup,
} from '@conch/protocol';

export interface ProviderCopy {
  id: BuiltInEngineId;
  name: string;
  /** Four or five words. */
  tagline: string;
  /** One sentence: what you get. */
  description: string;
  connect: ProviderConnect;
  /** Where it sits in the gallery. */
  group: ProviderGroup;
  /** Offered first in the gallery, before "More providers". */
  featured?: boolean;
  /** A few honest words when it costs nothing to start. */
  free?: string;
  signInLabel?: string;
  signInHelp?: string;
  /** Two or three short phrases for the card. */
  highlights: string[];
  /** What it can't do, one plain sentence each. Said before you connect, not after. */
  limits?: string[];
  keyForm?: KeyForm;
  /**
   * Environment variables that usually hold this provider's key. A key found
   * in one is offered on the Providers page — used only when you press it.
   */
  envKeys?: readonly string[];
  /**
   * Whether Conch can ask you before each step with this provider. A provider
   * that decides inside its own sandbox can't be asked, and the security
   * checkup says so out loud.
   */
  asksFirst: boolean;
  /** Early support — we say so rather than pretend. */
  experimental?: boolean;
  color?: string;
  homepage?: string;
  /** Only offered when Conch is running with the mock engine. */
  internal?: boolean;
}

/** Said about every model API: Conch is the hands, the provider is the brain. */
const API_LIMIT =
  'Tool-capable models can use Conch’s files and connected apps. Commands need the OS sandbox and run without network access; chat-only models cannot take actions.';

/** Said about every agent program that works through Conch's tools instead of its own. */
const AGENT_LIMIT =
  'It works with Conch’s tools rather than its own: files in the chat’s work folder, sealed commands without network access, memory and your apps — so everything it changes can be put back.';

const key = (
  form: Omit<KeyForm, 'canSignIn' | 'placeholder' | 'help'> &
    Partial<Pick<KeyForm, 'placeholder' | 'help' | 'canSignIn'>>,
): KeyForm => ({ placeholder: '', help: '', canSignIn: false, ...form });

const PROVIDERS: ProviderCopy[] = [
  // ── Your subscriptions: a program on this computer, your own sign-in ──────
  {
    id: 'claude-code',
    name: 'Claude Code',
    tagline: 'Claude, on this computer',
    description:
      'Anthropic’s coding agent, already signed in on this machine. It reads and writes files, runs commands and brings your own settings, skills and MCP servers with it.',
    connect: 'program',
    group: 'subscription',
    highlights: ['Works with your files', 'Runs commands', 'Your Claude plan or an API key'],
    asksFirst: true,
    color: '#D97757',
    homepage: 'https://code.claude.com',
  },
  {
    id: 'codex-cli',
    name: 'Codex',
    tagline: 'Your ChatGPT subscription, connected',
    signInLabel: 'Sign in with your ChatGPT subscription',
    signInHelp:
      'No API key needed. Conch keeps a separate, encrypted connection. Existing Codex and other apps stay signed in as they are. Your plan’s models and limits apply.',
    description:
      'OpenAI’s agent for your machine, signed in with your ChatGPT plan or an OpenAI key. Conch supplies files, safe commands, memory and connected apps, with the same approvals as its other providers.',
    connect: 'program',
    group: 'subscription',
    highlights: ['Works with your files', 'Runs commands', 'Your ChatGPT plan or an OpenAI key'],
    asksFirst: true,
    limits: [
      'Available models and usage limits depend on your ChatGPT plan. Commands need this computer’s OS sandbox and run without network access.',
    ],
    color: '#0D0D0D',
    homepage: 'https://developers.openai.com/codex/cli',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    tagline: 'Your Copilot plan, connected',
    signInLabel: 'Sign in with GitHub',
    signInHelp:
      'GitHub shows a short code to confirm it’s you. Every Copilot plan works, including Copilot Free; your plan’s models and limits apply. No key is needed.',
    description:
      'GitHub’s coding agent, signed in with your Copilot plan — Free, Pro or Business. Conch hands it your files, sealed commands, memory and apps.',
    connect: 'program',
    group: 'subscription',
    featured: true,
    free: 'Copilot Free works',
    highlights: ['Copilot Free works', 'Sign in with GitHub', 'Uses your apps'],
    limits: [
      'Conch talks to it through GitHub’s agent connection, which GitHub still calls a preview.',
      AGENT_LIMIT,
    ],
    asksFirst: true,
    experimental: true,
    color: '#1F2328',
    homepage: 'https://github.com/features/copilot',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    tagline: 'Your Google account, connected',
    signInLabel: 'Sign in with Google',
    signInHelp:
      'Google’s sign-in page opens in a browser on the computer Conch runs on. Finish there and this updates by itself. No key and no card are needed.',
    description:
      'Google’s Gemini, signed in with your Google account through Google’s own Gemini CLI — free to start. Conch lends it your files, memory and apps.',
    connect: 'program',
    group: 'subscription',
    free: 'Free with a Google account',
    highlights: ['Free with a Google account', 'Sign in with Google', 'Uses your apps'],
    limits: [
      'Signing in opens a browser on the computer Conch runs on. The free tier allows about a thousand requests a day.',
      'Google’s terms for Gemini CLI apply. For use at work, a Google Gemini key is the clearer fit.',
      AGENT_LIMIT,
    ],
    asksFirst: true,
    experimental: true,
    color: '#8E75B2',
    homepage: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    id: 'grok',
    name: 'Grok',
    tagline: 'Your Grok plan, connected',
    signInLabel: 'Sign in with X',
    signInHelp:
      'xAI shows a short code to confirm it’s you. Your SuperGrok or X Premium+ plan’s usage applies, shared with your other Grok apps.',
    description:
      'xAI’s Grok, signed in with your SuperGrok or X Premium+ plan through xAI’s own Grok Build. Conch lends it your files, memory and apps.',
    connect: 'program',
    group: 'subscription',
    highlights: ['Your SuperGrok plan', 'Sign in with X', 'Uses your apps'],
    limits: [
      'Grok’s usage is one weekly pool shared with your other Grok apps.',
      AGENT_LIMIT,
    ],
    asksFirst: true,
    experimental: true,
    color: '#0D0D0D',
    homepage: 'https://x.ai/cli',
  },

  // ── On this computer ──────────────────────────────────────────────────────
  {
    id: 'ollama',
    name: 'On this computer',
    tagline: 'Private, free, and works offline',
    description:
      'An open model that runs right here, through Ollama. Your chats aren’t sent to any AI company, it costs nothing, and it keeps working when the internet doesn’t. Conch lends it your integrations.',
    // Ollama is a program on this computer; the page walks through getting it and a model.
    connect: 'program',
    group: 'local',
    free: 'Free',
    highlights: ['Private', 'Free', 'Works offline'],
    limits: [
      'Slower and less capable than the big cloud models: best for everyday questions, drafts and quick jobs.',
      'Tool-capable models can use Conch’s files and connected apps. Commands need the OS sandbox and run without network access; chat-only models cannot take actions.',
    ],
    asksFirst: true,
    color: '#2F6B5E',
    homepage: 'https://ollama.com',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    tagline: 'Your LM Studio models, here',
    description:
      'The models you already have in LM Studio, running right here — private, free and offline. Conch starts LM Studio’s server when it needs to.',
    connect: 'program',
    group: 'local',
    free: 'Free',
    highlights: ['Private', 'Free', 'Works offline'],
    limits: [
      'A model runs at your computer’s speed; the first answer waits while LM Studio loads it.',
      API_LIMIT,
    ],
    asksFirst: true,
    color: '#4F46E5',
    homepage: 'https://lmstudio.ai',
  },

  // ── Pay as you go, with a key ─────────────────────────────────────────────
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tagline: 'Hundreds of models, one key',
    description:
      'One key for models from every lab — Claude, GPT, Gemini, Llama and more — with the price shown next to each. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    featured: true,
    free: 'Free models',
    highlights: ['Every model in one list', 'Pay as you go', 'Uses your integrations'],
    limits: [API_LIMIT],
    asksFirst: true,
    keyForm: key({
      label: 'OpenRouter key',
      placeholder: 'sk-or-v1-…',
      help: 'Or sign in and let OpenRouter make a key for you.',
      url: 'https://openrouter.ai/settings/keys',
      pattern: '^sk-or-',
      patternHint: 'OpenRouter keys start with sk-or-.',
      canSignIn: true,
      recognise: { distinct: '^sk-or-' },
    }),
    envKeys: ['OPENROUTER_API_KEY'],
    color: '#6566F1',
    homepage: 'https://openrouter.ai',
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    tagline: 'Claude, billed per token',
    description:
      'Claude straight from Anthropic with a Console key — no subscription and nothing else installed. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    featured: true,
    highlights: ['Every Claude model', 'Pay as you go', 'Uses your integrations'],
    limits: [API_LIMIT],
    asksFirst: true,
    keyForm: key({
      label: 'Anthropic API key',
      placeholder: 'sk-ant-…',
      help: 'Create one in the Anthropic Console. Usage is billed to that account.',
      url: 'https://console.anthropic.com/settings/keys',
      pattern: '^sk-ant-',
      patternHint: 'Anthropic keys start with sk-ant-.',
      recognise: { distinct: '^sk-ant-' },
    }),
    envKeys: ['ANTHROPIC_API_KEY'],
    color: '#D97757',
    homepage: 'https://console.anthropic.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'GPT, billed per use',
    description:
      'OpenAI’s GPT models with an API key — billed per use, separately from a ChatGPT plan. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    featured: true,
    highlights: ['Every GPT model', 'Pay as you go', 'Uses your integrations'],
    limits: [
      'An API key is billed on its own, separately from ChatGPT. To use your ChatGPT plan, connect Codex instead.',
      API_LIMIT,
    ],
    asksFirst: true,
    keyForm: key({
      label: 'OpenAI API key',
      placeholder: 'sk-proj-…',
      help: 'Create a project key in the OpenAI dashboard. Usage is billed to that organization.',
      url: 'https://platform.openai.com/settings/organization/api-keys',
      pattern: '^sk-(?!ant-|or-|admin-)',
      patternHint:
        'OpenAI keys start with sk-. An admin key (sk-admin-) can’t chat: make a project key instead.',
      recognise: { distinct: '^sk-(proj|svcacct)-', loose: '^sk-[A-Za-z0-9_-]{20,}$' },
    }),
    envKeys: ['OPENAI_API_KEY'],
    color: '#0D0D0D',
    homepage: 'https://platform.openai.com',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'Gemini, free to start',
    description:
      'Google’s Gemini models with a free AI Studio key — very long context and good with pictures. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    featured: true,
    free: 'Free tier',
    highlights: ['Free tier', 'Very long context', 'Uses your integrations'],
    limits: [
      'Google may use what you send on the free tier to improve its products. Paid use isn’t used that way.',
      API_LIMIT,
    ],
    asksFirst: true,
    keyForm: key({
      label: 'Gemini API key',
      placeholder: 'AIza… or AQ.…',
      help: 'Create one in Google AI Studio. It’s free; a paid key raises the limits.',
      url: 'https://aistudio.google.com/apikey',
      pattern: '^(AIza[0-9A-Za-z_-]{35}|AQ\\.[A-Za-z0-9_.-]{20,})$',
      patternHint: 'Gemini keys start with AIza or AQ. — copy the whole key from AI Studio.',
      recognise: { distinct: '^(AIza[0-9A-Za-z_-]{35}|AQ\\.[A-Za-z0-9_.-]{20,})$' },
    }),
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    color: '#8E75B2',
    homepage: 'https://aistudio.google.com',
  },
  {
    id: 'xai',
    name: 'xAI API',
    tagline: 'Grok, billed per use',
    description:
      'Grok straight from xAI with a key and prepaid credits — strong at reasoning, with very long context. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    highlights: ['Every Grok model', 'Prepaid credits', 'Uses your integrations'],
    limits: [
      'Billed from prepaid credits, separately from a SuperGrok plan. To use your plan, connect Grok instead.',
      API_LIMIT,
    ],
    asksFirst: true,
    keyForm: key({
      label: 'xAI API key',
      placeholder: 'xai-…',
      help: 'Create one in the xAI console and load it with credits.',
      url: 'https://console.x.ai/team/default/api-keys',
      pattern: '^xai-',
      patternHint: 'xAI keys start with xai-.',
      recognise: { distinct: '^xai-' },
    }),
    envKeys: ['XAI_API_KEY'],
    color: '#0D0D0D',
    homepage: 'https://console.x.ai',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tagline: 'Strong models, tiny prices',
    description:
      'DeepSeek’s models — strong reasoning at a very low price, billed from a prepaid balance. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    featured: true,
    highlights: ['Very cheap', 'Strong reasoning', 'Uses your integrations'],
    limits: [API_LIMIT],
    asksFirst: true,
    keyForm: key({
      label: 'DeepSeek API key',
      placeholder: 'sk-…',
      help: 'Create one on the DeepSeek platform and top up its balance.',
      url: 'https://platform.deepseek.com/api_keys',
      pattern: '^sk-',
      patternHint: 'DeepSeek keys start with sk-.',
      recognise: { loose: '^sk-[a-f0-9]{32}$' },
    }),
    envKeys: ['DEEPSEEK_API_KEY'],
    color: '#4D6BFE',
    homepage: 'https://platform.deepseek.com',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    tagline: 'European models, free to start',
    description:
      'Mistral’s models from Europe — free to start with no card, good all-round. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    free: 'Free to start',
    highlights: ['Free to start', 'Made in Europe', 'Uses your integrations'],
    limits: [API_LIMIT],
    asksFirst: true,
    keyForm: key({
      label: 'Mistral API key',
      help: 'Create one in Mistral’s console. The free plan needs no card.',
      url: 'https://console.mistral.ai/api-keys',
      recognise: { loose: '^[A-Za-z0-9]{32}$' },
    }),
    envKeys: ['MISTRAL_API_KEY'],
    color: '#FA520F',
    homepage: 'https://console.mistral.ai',
  },
  {
    id: 'groq',
    name: 'Groq',
    tagline: 'Open models, instantly fast',
    description:
      'Open models answered remarkably fast — great when speed matters more than the very top quality. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    group: 'key',
    free: 'Free tier',
    highlights: ['Very fast', 'Free tier', 'Uses your integrations'],
    limits: [API_LIMIT],
    asksFirst: true,
    keyForm: key({
      label: 'Groq API key',
      placeholder: 'gsk_…',
      help: 'Create one in the Groq console.',
      url: 'https://console.groq.com/keys',
      pattern: '^gsk_',
      patternHint: 'Groq keys start with gsk_.',
      recognise: { distinct: '^gsk_' },
    }),
    envKeys: ['GROQ_API_KEY'],
    color: '#F55036',
    homepage: 'https://console.groq.com',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    tagline: 'The fastest open models',
    description:
      'Among the fastest answers anywhere, from a small set of open models — trial credit to start, then pay as you go. Conch lends it your integrations.',
    connect: 'key',
    group: 'key',
    highlights: ['Fastest answers', 'Open models', 'Uses your integrations'],
    limits: [API_LIMIT],
    asksFirst: true,
    keyForm: key({
      label: 'Cerebras API key',
      placeholder: 'csk-…',
      help: 'Create one in Cerebras Cloud.',
      url: 'https://cloud.cerebras.ai',
      pattern: '^csk-',
      patternHint: 'Cerebras keys start with csk-.',
      recognise: { distinct: '^csk-' },
    }),
    envKeys: ['CEREBRAS_API_KEY'],
    color: '#F05A28',
    homepage: 'https://cloud.cerebras.ai',
  },
  {
    id: 'zai',
    name: 'Z.ai',
    tagline: 'GLM models, very cheap',
    description:
      'Zhipu’s GLM models — strong at coding and very cheap. Keys from Z.ai and from BigModel in China both work; Conch finds which by itself.',
    connect: 'key',
    group: 'key',
    highlights: ['Very cheap', 'Strong at code', 'Uses your integrations'],
    limits: [
      'Pay-as-you-go keys only: the GLM Coding Plan’s terms keep it to the coding tools Z.ai lists.',
      API_LIMIT,
    ],
    asksFirst: true,
    keyForm: key({
      label: 'Z.ai API key',
      help: 'Create one on Z.ai, or on BigModel in China.',
      url: 'https://z.ai/manage-apikey/apikey-list',
      recognise: { distinct: '^[A-Za-z0-9]{20,}\\.[A-Za-z0-9]{8,}$' },
    }),
    envKeys: ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'],
    color: '#2D2D2D',
    homepage: 'https://z.ai',
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    tagline: 'Kimi models, very long context',
    description:
      'Moonshot’s Kimi models — very long context, strong at coding and agent work. Keys from either Kimi platform work; Conch finds which by itself.',
    connect: 'key',
    group: 'key',
    highlights: ['Very long context', 'Strong at code', 'Uses your integrations'],
    limits: [
      'Pay-as-you-go keys only: the Kimi Code plan is for the coding tools Moonshot lists.',
      API_LIMIT,
    ],
    asksFirst: true,
    keyForm: key({
      label: 'Kimi API key',
      placeholder: 'sk-…',
      help: 'Create one on the Kimi platform. It needs a top-up of at least $1 to start.',
      url: 'https://platform.kimi.ai/console/api-keys',
      pattern: '^sk-',
      patternHint: 'Kimi keys start with sk-.',
      recognise: { loose: '^sk-[A-Za-z0-9]{40,60}$' },
    }),
    envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    color: '#16191E',
    homepage: 'https://platform.kimi.ai',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    tagline: 'Strong agents, huge context',
    description:
      'MiniMax’s models — strong at agent and coding work, with a million-token context. Pay as you go, or use your M Plan key, which MiniMax allows in other apps.',
    connect: 'key',
    group: 'key',
    highlights: ['Million-token context', 'M Plan keys work', 'Uses your integrations'],
    limits: [API_LIMIT],
    asksFirst: true,
    keyForm: key({
      label: 'MiniMax API key',
      help: 'Create one on the MiniMax platform, or use your M Plan key.',
      url: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    }),
    envKeys: ['MINIMAX_API_KEY'],
    color: '#E73562',
    homepage: 'https://platform.minimax.io',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    tagline: 'Qwen models, tiny to frontier',
    description:
      'Alibaba’s Qwen models, from tiny to frontier, with a free starter quota. A key works in the region it was made in; Conch finds the region by itself.',
    connect: 'key',
    group: 'key',
    free: 'Free starter quota',
    highlights: ['Free starter quota', 'Every size', 'Uses your integrations'],
    limits: [
      'The free starter quota is for new accounts in Alibaba Cloud’s Singapore region.',
      API_LIMIT,
    ],
    asksFirst: true,
    keyForm: key({
      label: 'Alibaba Cloud Model Studio key',
      placeholder: 'sk-…',
      help: 'Create one in Alibaba Cloud Model Studio.',
      url: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key',
      pattern: '^sk-',
      patternHint: 'Model Studio keys start with sk-.',
      recognise: { distinct: '^sk-ws', loose: '^sk-[a-f0-9]{32}$' },
    }),
    envKeys: ['DASHSCOPE_API_KEY'],
    color: '#6950EF',
    homepage: 'https://www.alibabacloud.com/product/modelstudio',
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    tagline: 'Big open models, hosted',
    signInLabel: 'Sign in with Ollama',
    signInHelp:
      'Uses the Ollama app on this computer: sign in to your Ollama account and Conch reaches its cloud models through it. No key to copy.',
    description:
      'Big open models on Ollama’s servers, for when this computer is too small to run them. Sign in through the Ollama app, or use a key.',
    connect: 'key',
    group: 'key',
    free: 'Free plan',
    highlights: ['Big open models', 'Free plan', 'Uses your integrations'],
    limits: [
      'These models run on Ollama’s servers, not this computer: private to your account, but not offline.',
      API_LIMIT,
    ],
    asksFirst: true,
    keyForm: key({
      label: 'Ollama API key',
      help: 'Create one in your Ollama account settings.',
      url: 'https://ollama.com/settings/keys',
    }),
    envKeys: ['OLLAMA_API_KEY'],
    color: '#1B1B1B',
    homepage: 'https://ollama.com/cloud',
  },
];

/**
 * The scripted stand-in used by `pnpm dev:mock` and the end-to-end runs. It
 * borrows the words of the provider it stands in for — a test that reads
 * "Test double" wouldn't tell us anything about the real screen — and takes its
 * name from whatever the engine reports. It only ever appears when Conch was
 * started with `CONCH_ENGINE=mock`, and the UI says the choice is fixed.
 */
const MOCK: ProviderCopy = {
  ...(PROVIDERS[0] as ProviderCopy),
  id: 'mock',
  internal: true,
};

PROVIDERS.push(MOCK);

export const PROVIDER_COPY: ReadonlyMap<EngineId, ProviderCopy> = new Map(
  PROVIDERS.map((p) => [p.id, p]),
);

/** Display order: your subscriptions, this computer, then keys, then test doubles. */
export const PROVIDER_ORDER: readonly BuiltInEngineId[] = PROVIDERS.map((p) => p.id);

/**
 * A server you add yourself, as the gallery and the documentation describe
 * the idea; each server you add gets its own card with the name you gave it.
 */
export const SERVER_COPY = {
  name: 'Another server',
  tagline: 'Any OpenAI-compatible address',
  description:
    'A model server you run yourself — llama.cpp, vLLM, Jan, LiteLLM — or a service with an OpenAI-compatible address. Give it a name, and its models join the picker.',
  highlights: ['Your own models', 'On your network too', 'Uses your integrations'],
  limits: [
    'Plain http only on this computer or your own network; anywhere else, the address must be https.',
    API_LIMIT,
  ],
  color: '#475569',
} as const;
