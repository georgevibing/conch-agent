/**
 * What each provider is, in the words a person would use.
 *
 * The engine knows how to *talk* to a provider; this file knows how to
 * *describe* it — the sentence on the card, what it's good at, and what
 * connecting it takes. Adding a provider is an entry here plus a folder under
 * `engines/`.
 */
import type { EngineId, KeyForm, ProviderConnect } from '@conch/protocol';

export interface ProviderCopy {
  id: EngineId;
  name: string;
  /** Four or five words. */
  tagline: string;
  /** One sentence: what you get. */
  description: string;
  connect: ProviderConnect;
  /** Two or three short phrases for the card. */
  highlights: string[];
  /** What it can't do, one plain sentence each. Said before you connect, not after. */
  limits?: string[];
  keyForm?: KeyForm;
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

const PROVIDERS: ProviderCopy[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    tagline: 'Claude, on this computer',
    description:
      'Anthropic’s coding agent, already signed in on this machine. It reads and writes files, runs commands and brings your own settings, skills and MCP servers with it.',
    connect: 'program',
    highlights: ['Works with your files', 'Runs commands', 'Your Claude plan or an API key'],
    asksFirst: true,
    color: '#D97757',
    homepage: 'https://code.claude.com',
  },
  {
    id: 'codex-cli',
    name: 'Codex',
    tagline: 'OpenAI’s coding agent',
    description:
      'OpenAI’s agent for your machine, signed in with your ChatGPT plan or an OpenAI key. It reads and writes files and runs commands in its own sandbox.',
    connect: 'program',
    highlights: ['Works with your files', 'Runs commands', 'Your ChatGPT plan or an OpenAI key'],
    // `codex exec` decides inside its own sandbox: there's no channel to ask us.
    asksFirst: false,
    limits: [
      'Codex decides inside its own sandbox, so Conch can’t ask you before each step — it can only choose how much Codex may touch.',
      'Codex can read what Conch remembers about you, but it can’t save a new memory itself.',
    ],
    experimental: true,
    color: '#0D0D0D',
    homepage: 'https://developers.openai.com/codex/cli',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tagline: 'Hundreds of models, one key',
    description:
      'One key for models from every lab — Claude, GPT, Gemini, Llama and more — with the price shown next to each. Conch runs the conversation and lends it your integrations.',
    connect: 'key',
    highlights: ['Every model in one list', 'Pay as you go', 'Uses your integrations'],
    limits: ['No files and no commands: this provider only talks to a model.'],
    asksFirst: true,
    keyForm: {
      label: 'OpenRouter key',
      placeholder: 'sk-or-v1-…',
      help: 'Or sign in and let OpenRouter make a key for you.',
      url: 'https://openrouter.ai/settings/keys',
      pattern: '^sk-or-',
      patternHint: 'OpenRouter keys start with sk-or-.',
      canSignIn: true,
    },
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
    highlights: ['Every Claude model', 'Pay as you go', 'Uses your integrations'],
    limits: ['No files and no commands: this provider only talks to a model.'],
    asksFirst: true,
    keyForm: {
      label: 'Anthropic API key',
      placeholder: 'sk-ant-…',
      help: 'Create one in the Anthropic Console. Usage is billed to that account.',
      url: 'https://console.anthropic.com/settings/keys',
      pattern: '^sk-ant-',
      patternHint: 'Anthropic keys start with sk-ant-.',
      canSignIn: false,
    },
    color: '#D97757',
    homepage: 'https://console.anthropic.com',
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

/** Display order: what's on this computer first, then keys, then test doubles. */
export const PROVIDER_ORDER: readonly EngineId[] = PROVIDERS.map((p) => p.id);
