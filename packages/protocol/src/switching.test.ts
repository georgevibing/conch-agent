import { describe, expect, it } from 'vitest';

import type { ModelCatalog, ModelInfo, ProviderModels } from './engine';
import {
  choiceText,
  modelTier,
  resolveSwitch,
  switchCandidates,
  switchedLine,
  switchList,
  switchWords,
  type ModelRef,
  type SwitchCandidate,
  type SwitchResolution,
} from './switching';

const model = (id: string, label: string, more: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  label,
  description: '',
  efforts: [],
  supportsFastMode: false,
  supportsAutoMode: false,
  ...more,
});

const provider = (
  engine: ProviderModels['engine'],
  label: string,
  models: ModelInfo[],
  more: Partial<ProviderModels> = {},
): ProviderModels => ({
  engine,
  label,
  models,
  commands: [],
  permissionModes: ['default'],
  local: false,
  tools: { host: true, files: true, shell: true, approvals: true },
  ...more,
});

const CLAUDE_CODE = provider(
  'claude-code',
  'Claude Code',
  [
    model('default', 'Default (recommended)', {
      description: 'Use the default model (currently Opus 5.5)',
    }),
    model('sonnet', 'Sonnet 5.5', { description: 'Fast and capable for everyday tasks' }),
    model('opus', 'Opus 5.5', { description: 'Most capable for complex work' }),
    model('haiku', 'Haiku 4.5', { description: 'Quickest for simple questions' }),
  ],
  { billing: 'plan', account: 'Claude Max' },
);
const CODEX = provider(
  'codex-agent',
  'Codex',
  [model('gpt-5.5', 'GPT-5.5'), model('gpt-5.5-mini', 'GPT-5.5 mini')],
  { billing: 'plan', account: 'ChatGPT Plus' },
);
const CODEX_CLI = provider('codex-cli', 'Codex CLI', [model('gpt-5.5', 'GPT-5.5')], {
  billing: 'plan',
  account: 'ChatGPT Plus',
});
const ANTHROPIC = provider(
  'anthropic-api',
  'Anthropic API',
  [
    model('claude-opus-5-5', 'Claude Opus 5.5'),
    model('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
    model('claude-haiku-4-5', 'Claude Haiku 4.5'),
  ],
  { billing: 'metered' },
);
const OPENROUTER = provider(
  'openrouter',
  'OpenRouter',
  [
    model('anthropic/claude-opus-5.5', 'Anthropic: Claude Opus 5.5'),
    model('openai/gpt-5.5', 'OpenAI: GPT-5.5'),
    model('meta-llama/llama-3.3-70b-instruct:free', 'Meta: Llama 3.3 70B (free)'),
  ],
  { billing: 'metered' },
);
const OLLAMA = provider(
  'ollama',
  'Ollama',
  [model('llama3.2:3b', 'llama3.2:3b', { tools: false }), model('qwen3:8b', 'qwen3:8b')],
  { local: true },
);

const PRICES: Record<string, number> = {
  'claude-opus-5-5': 0.03,
  'claude-sonnet-5-5': 0.015,
  'claude-haiku-4-5': 0.006,
  'anthropic/claude-opus-5.5': 0.03,
  'openai/gpt-5.5': 0.02,
};

const catalog = (...providers: ProviderModels[]): Pick<ModelCatalog, 'providers'> => ({
  providers,
});
const all = switchCandidates(
  catalog(CLAUDE_CODE, CODEX, ANTHROPIC, OPENROUTER, OLLAMA),
  (id) => PRICES[id],
);

const ON_CODEX: ModelRef = { engine: 'codex-agent', model: 'gpt-5.5' };
const ON_OPUS: ModelRef = { engine: 'claude-code', model: 'opus' };

/** The one it chose, as "engine/model", or the kind when it chose none. */
function picked(result: SwitchResolution): string {
  if (result.kind === 'one' || result.kind === 'already')
    return `${result.kind === 'already' ? 'already ' : ''}${result.choice.engine}/${result.choice.model}`;
  if (result.kind === 'some')
    return `${result.why}: ${result.choices.map((c) => `${c.engine}/${c.model}`).join(', ')}`;
  return `none (${result.why}${result.connect ? `, connect ${result.connect}` : ''})`;
}

describe('reading the words', () => {
  it('keeps versions whole and splits a name from its number', () => {
    expect(switchWords('Use Opus5.5!')).toEqual(['use', 'opus', '5.5']);
    expect(switchWords('claude-opus-5-5')).toEqual(['claude', 'opus', '5.5']);
    expect(switchWords('claude-opus-4-20250514')).toEqual(['claude', 'opus', '4', '20250514']);
    expect(switchWords('GPT-5.5 mini')).toEqual(['gpt', '5.5', 'mini']);
    expect(switchWords('Gemini 2.5 Pro.')).toEqual(['gemini', '2.5', 'pro']);
  });

  it('ranks models by their names, roughly', () => {
    expect(modelTier({ id: 'opus', label: 'Opus 5.5' })).toBe(3);
    expect(modelTier({ id: 'sonnet', label: 'Sonnet 5.5' })).toBe(2);
    expect(modelTier({ id: 'haiku', label: 'Haiku 4.5' })).toBe(1);
    expect(modelTier({ id: 'gpt-5.5', label: 'GPT-5.5' })).toBe(3);
    expect(modelTier({ id: 'gpt-5.5-mini', label: 'GPT-5.5 mini' })).toBe(1);
    expect(modelTier({ id: 'qwen3:8b', label: 'qwen3:8b' })).toBe(1);
    expect(modelTier({ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' })).toBe(3);
  });

  it('turns the catalog into candidates: no “Default” entry, the model it stands for leads', () => {
    const claude = all.filter((c) => c.engine === 'claude-code');
    expect(claude.map((c) => c.model)).toEqual(['sonnet', 'opus', 'haiku']);
    expect(claude.find((c) => c.lead)?.model).toBe('opus');
    expect(claude[0]).toMatchObject({
      billing: 'plan',
      account: 'Claude Max',
      provider: 'Claude Code',
    });
    expect(all.find((c) => c.model === 'llama3.2:3b')).toMatchObject({
      local: true,
      billing: 'free',
      chatOnly: true,
    });
    expect(all.find((c) => c.model === 'claude-opus-5-5')?.perReplyUsd).toBe(0.03);
  });
});

describe('which model the person means (ADR 0132)', () => {
  const cases: [string, ModelRef | undefined, string][] = [
    // The bug: on Codex, "use Opus 5.5" with a Claude plan connected.
    ['use Opus 5.5', ON_CODEX, 'claude-code/opus'],
    ['switch to opus5.5 please', ON_CODEX, 'claude-code/opus'],
    ['Opus', ON_CODEX, 'claude-code/opus'],
    ['use my Claude plan', ON_CODEX, 'claude-code/opus'],
    ['use Claude', ON_CODEX, 'claude-code/opus'],
    ['try this with GPT', ON_OPUS, 'codex-agent/gpt-5.5'],
    ['use ChatGPT', ON_OPUS, 'codex-agent/gpt-5.5'],
    ['switch to sonnet', ON_OPUS, 'claude-code/sonnet'],
    ['gpt 5.5 mini', ON_OPUS, 'codex-agent/gpt-5.5-mini'],
    // Named with its provider: that way, even when it's paid per use.
    ['Claude Opus 5.5 on OpenRouter', ON_CODEX, 'openrouter/anthropic/claude-opus-5.5'],
    ['use the Anthropic API', ON_CODEX, 'anthropic-api/claude-opus-5-5'],
    // Two keys with the same model: which one is the person's to say.
    [
      'opus with my API key',
      ON_CODEX,
      'ambiguous: anthropic-api/claude-opus-5-5, openrouter/anthropic/claude-opus-5.5',
    ],
    // On a key, the same model stays on that key.
    [
      'sonnet',
      { engine: 'anthropic-api', model: 'claude-opus-5-5' },
      'anthropic-api/claude-sonnet-5-5',
    ],
    // Relative: among what's connected, plans before keys, the same provider first.
    ['switch to the cheaper model', ON_OPUS, 'claude-code/sonnet'],
    ['use something faster', ON_OPUS, 'claude-code/sonnet'],
    [
      'use a stronger model for this',
      { engine: 'claude-code', model: 'sonnet' },
      'claude-code/opus',
    ],
    ['use the most capable model', { engine: 'claude-code', model: 'haiku' }, 'claude-code/opus'],
    ['cheaper', { engine: 'anthropic-api', model: 'claude-opus-5-5' }, 'claude-code/opus'],
    // This computer: one that can use apps, while the chat's can.
    ['use a local model', ON_OPUS, 'ollama/qwen3:8b'],
    ['run it offline on this computer', ON_OPUS, 'ollama/qwen3:8b'],
    ['a free one', ON_OPUS, 'ollama/qwen3:8b'],
    // Already there.
    ['use Opus 5.5', ON_OPUS, 'already claude-code/opus'],
    ['use my Claude plan', { engine: 'claude-code' }, 'already claude-code/opus'],
    // Not connected: say which provider would serve it.
    ['use Gemini 2.5 Pro', ON_OPUS, 'none (nothing, connect gemini-cli)'],
    ['gemini with my api key', ON_OPUS, 'none (nothing, connect gemini)'],
    ['use Grok', ON_OPUS, 'none (nothing, connect grok)'],
    [
      'use my ChatGPT plan',
      { engine: 'anthropic-api', model: 'claude-opus-5-5' },
      'codex-agent/gpt-5.5',
    ],
    // Nothing stronger than the strongest.
    ['use a stronger model', ON_OPUS, 'none (no-stronger)'],
    ['go back', ON_OPUS, 'none (no-previous)'],
  ];
  it.each(cases)('“%s”', (request, current, want) => {
    expect(picked(resolveSwitch(all, request, { current }))).toBe(want);
  });

  it('goes back to the one before', () => {
    const back = resolveSwitch(all, 'go back to Codex', { current: ON_OPUS, previous: ON_CODEX });
    expect(picked(back)).toBe('codex-agent/gpt-5.5');
    expect(
      picked(resolveSwitch(all, 'switch back', { current: ON_OPUS, previous: ON_CODEX })),
    ).toBe('codex-agent/gpt-5.5');
  });

  it('prefers the plan for the same model, and names the other ways', () => {
    const result = resolveSwitch(all, 'use Opus 5.5', { current: ON_CODEX });
    expect(result.kind).toBe('one');
    if (result.kind !== 'one') return;
    expect(result.named).toBe(true);
    expect(result.also?.map((c) => c.engine)).toEqual(['anthropic-api', 'openrouter']);
  });

  it('offers the closest when the version asked for isn’t connected', () => {
    expect(picked(resolveSwitch(all, 'use Opus 4.1', { current: ON_CODEX }))).toBe(
      'near: claude-code/opus, anthropic-api/claude-opus-5-5, openrouter/anthropic/claude-opus-5.5',
    );
  });

  it('asks which, when two plans fit as well', () => {
    const both = switchCandidates(catalog(CLAUDE_CODE, CODEX, CODEX_CLI));
    // "Codex" is Codex, not Codex CLI: its whole name was said.
    expect(picked(resolveSwitch(both, 'use Codex', { current: ON_OPUS }))).toBe(
      'codex-agent/gpt-5.5',
    );
    expect(picked(resolveSwitch(both, 'GPT-5.5', { current: ON_OPUS }))).toBe(
      'ambiguous: codex-agent/gpt-5.5, codex-cli/gpt-5.5',
    );
  });

  it('never starts paying on a guess at “stronger”: it asks', () => {
    const keysOnly = switchCandidates(catalog(ANTHROPIC, OLLAMA), (id) => PRICES[id]);
    const result = resolveSwitch(keysOnly, 'use a stronger model', {
      current: { engine: 'ollama', model: 'qwen3:8b' },
    });
    expect(picked(result)).toBe(
      'pays: anthropic-api/claude-opus-5-5, anthropic-api/claude-sonnet-5-5',
    );
    // Named, it's the person's choice to pay.
    expect(
      picked(resolveSwitch(keysOnly, 'use Claude Opus', { current: { engine: 'ollama' } })),
    ).toBe('anthropic-api/claude-opus-5-5');
  });

  it('a chip’s words mean exactly its model', () => {
    for (const c of all.filter((c) => !c.chatOnly)) {
      const result = resolveSwitch(all, choiceText(c), { current: { engine: 'mock' } });
      expect(picked(result), choiceText(c)).toBe(`${c.engine}/${c.model}`);
    }
  });
});

describe('what the chat and the assistant are told', () => {
  const find = (engine: string, id: string) =>
    all.find((c) => c.engine === engine && c.model === id) as SwitchCandidate;

  it('says where it answers from', () => {
    expect(switchedLine(find('claude-code', 'opus'))).toBe(
      'Switched to Opus 5.5 on your Claude Max plan',
    );
    expect(switchedLine(find('anthropic-api', 'claude-opus-5-5'))).toBe(
      'Switched to Claude Opus 5.5 on Anthropic API, about $0.03 a reply',
    );
    expect(switchedLine(find('ollama', 'qwen3:8b'))).toBe('Switched to qwen3:8b on this computer');
    expect(switchedLine(find('codex-agent', 'gpt-5.5'), true)).toBe(
      'Back to GPT-5.5 on your ChatGPT Plus plan',
    );
  });

  it('lists what it can switch to in a few lines, the one answering marked', () => {
    const lines = switchList(all, ON_CODEX);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(
      '- Claude Code (your Claude Max plan): Sonnet 5.5 [everyday], Opus 5.5 [strongest], Haiku 4.5 [quick]',
    );
    expect(lines[1]).toContain('GPT-5.5 [strongest, answering now]');
    expect(lines[4]).toContain('llama3.2:3b [quick, chat only]');
    expect(lines.join('\n').length).toBeLessThan(1400);
  });

  it('keeps a long list short', () => {
    const many = switchCandidates(
      catalog(
        provider(
          'openrouter',
          'OpenRouter',
          Array.from({ length: 300 }, (_, i) => model(`m/${i}`, `Model ${i}`)),
          { billing: 'metered' },
        ),
      ),
    );
    const [line] = switchList(many, undefined);
    expect(line).toBe(
      '- OpenRouter (OpenRouter, pay per use): 300 models, ask by name; e.g. Model 0, Model 1, Model 2',
    );
  });
});
