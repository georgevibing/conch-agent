/* Story/test fixtures — not exported from the package. */
import { Eye, FilePen, Hand, ShieldCheck, Zap } from 'lucide-react';
import { useState } from 'react';

import type { ModeOption } from '../ModePicker/ModePicker';
import { ModePicker } from '../ModePicker/ModePicker';
import { ModelPicker, type EffortOption, type ModelProvider } from './ModelPicker';

export const claudeCode: ModelProvider = {
  id: 'claude-code',
  label: 'Claude Code',
  logo: 'claude',
  models: [
    { id: 'default', label: 'Default', description: 'Recommended for your plan' },
    { id: 'opus', label: 'Opus 5.5', description: 'Most capable for complex, long-running work' },
    { id: 'sonnet', label: 'Sonnet 5', description: 'Fast and smart for everyday tasks' },
    { id: 'haiku', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
    {
      id: 'fable',
      label: 'Fable 5.1',
      description: 'Our most capable model for the hardest work',
      badge: 'New',
      secondary: true,
    },
    {
      id: 'opus[1m]',
      label: 'Opus 5.5 (1M context)',
      description: 'For very long sessions',
      secondary: true,
    },
    {
      id: 'sonnet[1m]',
      label: 'Sonnet 5 (1M context)',
      description: 'For very long sessions',
      secondary: true,
    },
    { id: 'claude-opus-5', label: 'Opus 5', description: 'Previous Opus', secondary: true },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', description: 'Previous Opus', secondary: true },
    { id: 'claude-opus-4-7', label: 'Opus 4.7', description: 'Legacy', secondary: true },
    {
      id: 'claude-sonnet-4-6',
      label: 'Sonnet 4.6',
      description: 'Previous Sonnet',
      secondary: true,
    },
    {
      id: 'opusplan',
      label: 'Opus Plan',
      description: 'Opus for planning, Sonnet for doing',
      secondary: true,
    },
  ],
};

/** OpenRouter: many models from many labs — the case search is for. */
export const openRouter: ModelProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  logo: 'openrouter',
  models: [
    ['openai/gpt-5.2', 'OpenAI: GPT-5.2', '400K context · $1.25/$10 per million tokens'],
    ['google/gemini-3-pro', 'Google: Gemini 3 Pro', '1M context · $2/$12 per million tokens'],
    [
      'anthropic/claude-sonnet-5.5',
      'Anthropic: Claude Sonnet 5.5',
      '1M context · $3/$15 per million tokens',
    ],
    ['qwen/qwen3-coder', 'Qwen: Qwen3 Coder', '262K context · $0.22/$0.95 per million tokens'],
    [
      'deepseek/deepseek-v3.2',
      'DeepSeek: DeepSeek V3.2',
      '164K context · $0.27/$0.4 per million tokens',
    ],
    [
      'moonshotai/kimi-k2.5',
      'MoonshotAI: Kimi K2.5',
      '262K context · $0.6/$2.5 per million tokens',
    ],
    ['x-ai/grok-4.1-fast', 'xAI: Grok 4.1 Fast', '2M context · $0.2/$0.5 per million tokens'],
    [
      'meta-llama/llama-4-maverick',
      'Meta: Llama 4 Maverick',
      '1M context · $0.15/$0.6 per million tokens',
    ],
    [
      'mistralai/mistral-medium-3.2',
      'Mistral: Mistral Medium 3.2',
      '131K context · $0.4/$2 per million tokens',
    ],
    ['z-ai/glm-4.6', 'Z.AI: GLM 4.6', '203K context · $0.4/$1.75 per million tokens'],
    ['qwen/qwen3-235b-a22b:free', 'Qwen: Qwen3 235B (free)', '131K context · free'],
    ['liquid/lfm-7b', 'Liquid: LFM 7B', '33K context · $0.01/$0.01 per million tokens'],
  ].map(([id = '', label = '', description = ''], i) => ({
    id,
    label,
    description,
    secondary: i >= 6,
    // Some models on OpenRouter can't call tools: they only chat (ADR 0050).
    ...(id === 'liquid/lfm-7b' && { chatOnly: true }),
  })),
};

export const codex: ModelProvider = {
  id: 'codex-cli',
  label: 'Codex',
  logo: 'openai',
  models: [
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', description: 'Tuned for coding in your folder' },
    { id: 'gpt-5.2', label: 'GPT-5.2', description: 'OpenAI’s general model' },
  ],
};

/** Models on this computer (Ollama): private, free, and they work offline. */
export const onThisComputer: ModelProvider = {
  id: 'ollama',
  label: 'On this computer',
  logo: 'local',
  models: [
    { id: 'qwen3.5:9b', label: 'Qwen3.5 9B', description: '6.6 GB · uses your apps' },
    { id: 'qwen3:4b-instruct', label: 'Qwen3 4B', description: '2.5 GB · uses your apps' },
    { id: 'gemma3:1b', label: 'Gemma3 1B', description: '800 MB', chatOnly: true },
  ],
};

/** Every provider you've connected, side by side — the default first. */
export const connectedProviders: ModelProvider[] = [
  { ...claudeCode, note: 'Default' },
  openRouter,
  codex,
  {
    id: 'anthropic-api',
    label: 'Anthropic API',
    logo: 'claude',
    models: [],
    message: 'Anthropic didn’t answer in time. Your other providers still work.',
  },
];

export const efforts: EffortOption[] = [
  { value: 'auto', label: 'Auto', description: 'Claude decides how long to think' },
  { value: 'low', label: 'Low', description: 'Quick answers, minimal thinking' },
  { value: 'medium', label: 'Med', description: 'Balanced speed and depth' },
  { value: 'high', label: 'High', description: 'Thinks carefully before answering' },
  { value: 'xhigh', label: 'Extra', description: 'Deep thinking for hard problems' },
  { value: 'max', label: 'Max', description: 'As much thinking as it takes' },
];

/** The app's modes, in its words and icons (`@conch/protocol` `MODE_WORDS`), Plan only to Full trust. */
export const modes: ModeOption[] = [
  {
    value: 'plan',
    label: 'Plan only',
    description: 'Looks around and plans. Changes nothing until you say go.',
    icon: <Eye />,
  },
  {
    value: 'default',
    label: 'Ask first',
    description: 'Asks before it changes a file, runs a command or acts in an app.',
    icon: <Hand />,
  },
  {
    value: 'acceptEdits',
    label: 'Edit freely',
    description: 'Changes files in this folder without asking. Anything more needs your OK.',
    icon: <FilePen />,
    tone: 'caution',
  },
  {
    value: 'auto',
    label: 'Auto',
    description:
      'Gets on with the work. Stops to ask only before something serious, like deleting, publishing or reaching your keys.',
    icon: <ShieldCheck />,
    tone: 'caution',
  },
  {
    value: 'bypassPermissions',
    label: 'Full trust',
    description:
      'Never stops to ask. A page or file it reads could trick it, so only in a folder you can afford to lose.',
    icon: <Zap />,
    tone: 'danger',
  },
];

/** A stateful model + mode toolbar, as the app wires it. */
export function DemoToolbar({
  providers = [claudeCode],
  initial = {},
}: {
  providers?: ModelProvider[];
  initial?: { model?: string; effort?: string; fast?: boolean; mode?: string };
}) {
  const [model, setModel] = useState(initial.model ?? 'opus');
  const [effort, setEffort] = useState(initial.effort ?? 'auto');
  const [fast, setFast] = useState(initial.fast ?? false);
  const [mode, setMode] = useState(initial.mode ?? 'default');
  const [defaults, setDefaults] = useState({ model, effort, fast, mode });
  return (
    <>
      <ModelPicker
        providers={providers}
        model={model}
        onModelChange={setModel}
        effort={effort}
        efforts={model === 'haiku' ? [] : efforts}
        onEffortChange={setEffort}
        fastMode={fast}
        fastModeAvailable={model === 'opus'}
        onFastModeChange={setFast}
        isDefault={defaults.model === model && defaults.effort === effort && defaults.fast === fast}
        onMakeDefault={() => setDefaults((d) => ({ ...d, model, effort, fast }))}
      />
      <ModePicker
        options={modes}
        value={mode}
        onValueChange={setMode}
        isDefault={defaults.mode === mode}
        onMakeDefault={() => setDefaults((d) => ({ ...d, mode }))}
      />
    </>
  );
}
