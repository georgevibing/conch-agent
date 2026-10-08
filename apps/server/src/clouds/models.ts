/**
 * Claude on the clouds (ADR 0109). Neither Bedrock nor Vertex has
 * Anthropic's Models API, so the models Conch could offer are written here,
 * as each cloud names them (checked against Anthropic's and AWS's pages on
 * 2026-10-08), with what each can do. Conch never offers one of these on
 * faith: each is asked about with a free token count first, and only the
 * ones this account can actually use reach the picker (`usable`).
 */
import type { CloudRegion } from '@conch/protocol';

/** What a Claude model can do, for the model list. */
export interface ClaudeModel {
  /** The first-party id: `claude-opus-5-5`. */
  base: string;
  name: string;
  /** Tokens it reads at once. */
  context: number;
  /** Thinking levels it takes; none means it takes no `effort`. */
  efforts: readonly string[];
  /** It thinks adaptively, so the wire may ask it to. */
  thinking: boolean;
  maxOutput: number;
  /** Only on Vertex, or only on Bedrock; unset for both. */
  only?: 'bedrock' | 'vertex';
  /** Vertex's dated id, for a model it names with a snapshot (`claude-haiku-4-5@20251001`). */
  vertexId?: string;
}

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Newest and most capable first: the first usable one is a new chat's model. */
export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  {
    base: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-fable-5',
    name: 'Claude Fable 5',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-opus-5',
    name: 'Claude Opus 5',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    context: 1_000_000,
    efforts: ALL,
    thinking: true,
    maxOutput: 128_000,
  },
  {
    base: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    context: 1_000_000,
    efforts: ['low', 'medium', 'high', 'max'],
    thinking: true,
    maxOutput: 128_000,
    only: 'vertex',
  },
  {
    base: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    context: 1_000_000,
    efforts: ['low', 'medium', 'high', 'max'],
    thinking: true,
    maxOutput: 64_000,
    only: 'vertex',
  },
  // Haiku 5.5's thinking levels aren't published yet: it's asked without one.
  {
    base: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    context: 1_000_000,
    efforts: [],
    thinking: false,
    maxOutput: 64_000,
  },
  {
    base: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    context: 200_000,
    efforts: [],
    thinking: false,
    maxOutput: 64_000,
    vertexId: 'claude-haiku-4-5@20251001',
  },
];

/** The id each cloud calls a model by. */
export function cloudModelId(model: ClaudeModel, cloud: 'bedrock' | 'vertex'): string {
  return cloud === 'bedrock' ? `anthropic.${model.base}` : (model.vertexId ?? model.base);
}

/** The models a cloud might have, in its own ids. */
export function candidates(cloud: 'bedrock' | 'vertex'): { id: string; model: ClaudeModel }[] {
  return CLAUDE_MODELS.filter((m) => !m.only || m.only === cloud).map((model) => ({
    id: cloudModelId(model, cloud),
    model,
  }));
}

/**
 * A model as the Models API would describe it, so the Anthropic wire reads
 * it the same way: its window, its output, and its thinking.
 */
export function modelEntry(id: string, model: ClaudeModel, rank: number): Record<string, unknown> {
  return {
    id,
    display_name: model.name,
    // Only the order matters: newest-first, as listed above.
    created_at: new Date(Date.UTC(2026, 0, 1) - rank * 86_400_000).toISOString(),
    max_input_tokens: model.context,
    max_tokens: model.maxOutput,
    capabilities: {
      ...(model.thinking && { thinking: { types: { adaptive: {} } } }),
      effort: Object.fromEntries(model.efforts.map((level) => [level, {}])),
    },
  };
}

/** A model id Conch may put in an address: one of the shapes the clouds use, nothing else. */
export const BEDROCK_MODEL =
  /^(?:(?:global|us|eu|jp|au|apac)\.)?anthropic\.claude-[a-z0-9.-]{3,60}$/;
export const VERTEX_MODEL = /^claude-[a-z0-9.-]{3,60}(?:@\d{8})?$/;

/**
 * Where Claude in Amazon Bedrock answers (Anthropic's region table,
 * 2026-10-08). The global endpoint routes to capacity anywhere and costs
 * least; Conch uses the region you're set up for, else US East.
 */
export const BEDROCK_REGIONS: readonly CloudRegion[] = [
  { id: 'us-east-1', label: 'US East (N. Virginia)' },
  { id: 'us-east-2', label: 'US East (Ohio)' },
  { id: 'us-west-1', label: 'US West (N. California)' },
  { id: 'us-west-2', label: 'US West (Oregon)' },
  { id: 'ca-central-1', label: 'Canada (Central)' },
  { id: 'ca-west-1', label: 'Canada West (Calgary)' },
  { id: 'sa-east-1', label: 'South America (São Paulo)' },
  { id: 'eu-west-1', label: 'Europe (Ireland)' },
  { id: 'eu-west-2', label: 'Europe (London)' },
  { id: 'eu-west-3', label: 'Europe (Paris)' },
  { id: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { id: 'eu-central-2', label: 'Europe (Zurich)' },
  { id: 'eu-north-1', label: 'Europe (Stockholm)' },
  { id: 'eu-south-1', label: 'Europe (Milan)' },
  { id: 'eu-south-2', label: 'Europe (Spain)' },
  { id: 'il-central-1', label: 'Israel (Tel Aviv)' },
  { id: 'me-central-1', label: 'Middle East (UAE)' },
  { id: 'af-south-1', label: 'Africa (Cape Town)' },
  { id: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { id: 'ap-south-2', label: 'Asia Pacific (Hyderabad)' },
  { id: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { id: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { id: 'ap-southeast-3', label: 'Asia Pacific (Jakarta)' },
  { id: 'ap-southeast-4', label: 'Asia Pacific (Melbourne)' },
  { id: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { id: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { id: 'ap-northeast-3', label: 'Asia Pacific (Osaka)' },
];

/**
 * Where Claude on Vertex AI answers. Global serves every model and costs
 * least; the US and EU multi-regions keep the data in one place. A single
 * region serves only older models, so it isn't offered.
 */
export const VERTEX_REGIONS: readonly CloudRegion[] = [
  { id: 'global', label: 'Global (recommended)' },
  { id: 'us', label: 'United States' },
  { id: 'eu', label: 'European Union' },
];

/** Vertex's host for a region. */
export function vertexHost(region: string): string {
  if (region === 'global') return 'aiplatform.googleapis.com';
  if (region === 'us' || region === 'eu') return `aiplatform.${region}.rep.googleapis.com`;
  return `${region}-aiplatform.googleapis.com`;
}

/** The region to use: the one asked for if it's real, else the profile's, else the first. */
export function pickRegion(
  regions: readonly CloudRegion[],
  ...wanted: (string | undefined)[]
): string {
  for (const region of wanted) if (region && regions.some((r) => r.id === region)) return region;
  return regions[0]?.id ?? 'us-east-1';
}
