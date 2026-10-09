import type { FallbackOption } from './FallbackPicker';

/** 3 PM on a Friday, so reset times read the same in every story and test. */
export const fallbackNow = new Date(2026, 9, 9, 15, 0).getTime();
const hours = (n: number) => fallbackNow + n * 3_600_000;

/** Claude Code at its limit, with a ChatGPT plan and two keys to carry on. */
export const fallbackOptions: FallbackOption[] = [
  {
    id: 'codex-agent',
    name: 'Codex',
    account: 'ChatGPT Plus · ada@example.com',
    billing: 'plan',
    room: 'room',
    leftPercent: 72,
    resetsAt: hours(3),
    model: 'GPT-5.5',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    account: 'Key …4f2c',
    billing: 'metered',
    room: 'room',
    perReplyUsd: 0.006,
    model: 'GPT-5 mini',
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    account: 'Key …9a1d',
    billing: 'metered',
    room: 'room',
    perReplyUsd: 0.026,
    model: 'Claude Sonnet 5',
  },
];

/** Two ChatGPT accounts, named so they can be told apart; one at its own limit. */
export const fallbackTwoAccounts: FallbackOption[] = [
  {
    id: 'codex-cli',
    name: 'Codex · ada@work.example',
    account: 'ChatGPT Team',
    billing: 'plan',
    room: 'none',
    leftPercent: 0,
    resetsAt: hours(2),
    skip: 'At its limit',
    model: 'GPT-5.5',
  },
  {
    id: 'codex-agent',
    name: 'Codex · ada@home.example',
    account: 'ChatGPT Plus',
    billing: 'plan',
    room: 'low',
    leftPercent: 8,
    resetsAt: hours(1),
    model: 'GPT-5.5',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    account: 'Key …4f2c',
    billing: 'metered',
    room: 'none',
    skip: 'This month’s budget is used up',
    model: 'GPT-5 mini',
    perReplyUsd: 0.006,
  },
];
