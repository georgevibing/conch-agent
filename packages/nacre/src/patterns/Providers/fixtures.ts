import type { ProviderCardProps } from './ProviderCard';

/** The providers Conch ships with, as the cards see them. */
export const providers: ProviderCardProps[] = [
  {
    name: 'Claude Code',
    brand: 'claude-code',
    color: '#D97757',
    tagline: 'Claude, on this computer',
    state: 'ready',
    active: true,
    meta: 'Claude Max · ada@example.com · 2.1.284',
    highlights: ['Works with your files', 'Runs commands'],
  },
  {
    name: 'Codex',
    brand: 'codex-cli',
    color: '#0D0D0D',
    tagline: 'OpenAI’s coding agent',
    state: 'not-installed',
    experimental: true,
    message: 'Codex isn’t on this computer yet.',
    highlights: ['Works with your files', 'Runs commands', 'Your ChatGPT plan'],
  },
  {
    name: 'OpenRouter',
    brand: 'openrouter',
    color: '#475569',
    tagline: 'Hundreds of models, one key',
    state: 'signed-out',
    message: 'Sign in and OpenRouter will make a key for you.',
    highlights: ['Every model in one list', 'Pay as you go'],
  },
  {
    name: 'Anthropic API',
    brand: 'anthropic-api',
    color: '#D97757',
    tagline: 'Claude, billed per token',
    state: 'ready',
    meta: 'Key ending …4f2c, kept in 1Password',
    highlights: ['Every Claude model', 'Pay as you go'],
  },
];
