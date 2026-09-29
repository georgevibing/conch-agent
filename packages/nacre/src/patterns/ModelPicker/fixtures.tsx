/* Story/test fixtures — not exported from the package. */
import { Eye, FileEdit, ListChecks, ShieldCheck, Sparkles } from 'lucide-react';
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

export const futureProviders: ModelProvider[] = [
  claudeCode,
  { id: 'codex', label: 'Codex CLI', logo: 'openai', models: [], note: 'Coming soon' },
  { id: 'openrouter', label: 'OpenRouter', logo: 'openrouter', models: [], note: 'Coming soon' },
];

export const efforts: EffortOption[] = [
  { value: 'auto', label: 'Auto', description: 'Claude decides how long to think' },
  { value: 'low', label: 'Low', description: 'Quick answers, minimal thinking' },
  { value: 'medium', label: 'Med', description: 'Balanced speed and depth' },
  { value: 'high', label: 'High', description: 'Thinks carefully before answering' },
  { value: 'xhigh', label: 'Extra', description: 'Deep thinking for hard problems' },
  { value: 'max', label: 'Max', description: 'As much thinking as it takes' },
];

export const modes: ModeOption[] = [
  {
    value: 'default',
    label: 'Ask first',
    description: 'Asks before editing files or running commands',
    icon: <ShieldCheck />,
  },
  {
    value: 'auto',
    label: 'Auto',
    description: 'Runs safe actions itself, asks about risky ones',
    icon: <Sparkles />,
  },
  {
    value: 'acceptEdits',
    label: 'Edit freely',
    description: 'Edits files without asking; asks before commands',
    icon: <FileEdit />,
    tone: 'caution',
  },
  {
    value: 'plan',
    label: 'Plan only',
    description: 'Reads and plans, never changes anything',
    icon: <ListChecks />,
  },
  {
    value: 'bypassPermissions',
    label: 'Full trust',
    description: 'Does anything without asking — use with care',
    icon: <Eye />,
    tone: 'danger',
  },
];

/** A stateful model + mode toolbar, as the app wires it. */
export function DemoToolbar({ providers = [claudeCode] }: { providers?: ModelProvider[] }) {
  const [model, setModel] = useState('opus');
  const [effort, setEffort] = useState('auto');
  const [fast, setFast] = useState(false);
  const [mode, setMode] = useState('default');
  const [defaults, setDefaults] = useState({
    model: 'opus',
    effort: 'auto',
    fast: false,
    mode: 'default',
  });
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
