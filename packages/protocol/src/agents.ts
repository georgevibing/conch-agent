/**
 * Agents (ADR 0101): the assistants you talk to, each with a name, a face, a
 * voice and instructions of its own. They are personas of the same Conch, not
 * separate programs: every agent shares your memory, apps, skills, providers
 * and safety settings, and none of them can change what Conch's rules allow.
 *
 * One agent is the default: new chats, chat apps and routines start with it
 * unless they choose another. There is always at least one; the first is made
 * from the personality chosen at setup (`Persona`), so nothing changes for
 * someone who never makes a second.
 *
 * The system prompt is layered, and the order is the precedence (`layers`):
 * Conch's own rules and safety first, then how it solves problems
 * (resilience), then this agent's persona, then its instructions, then what
 * it knows about you and the chat. A later layer shapes the voice; it never
 * overrides an earlier one.
 */
import { z } from 'zod';

import { EffortChoice, EngineId, PermissionModeId } from './common';
import { AppColor } from './conch-apps';
import type { ConversationEvent, ConversationSummary } from './index';

// ── Ids and limits ──────────────────────────────────────────────────────────

/** An agent's id: `ag_` and a few letters, never a path. Made when it's created, kept forever. */
export const AgentId = z.string().regex(/^ag_[A-Za-z0-9_-]{4,40}$/, 'Not an agent.');
export type AgentId = z.infer<typeof AgentId>;

/**
 * The agent made from the personality chosen at setup (before agents). Chats
 * from before agents (no `agentId`) are with this one while it exists, and
 * with the default agent once it's gone.
 */
export const FIRST_AGENT_ID: AgentId = 'ag_conch';

export const AGENT_LIMITS = {
  /** How many agents a Conch keeps: plenty for a cast, never a second filing system. */
  count: 50,
  /** Shown in the chat beside every reply: short, like a person's name. */
  name: 40,
  /** One line on what it's for, shown in pickers: "Plans trips and keeps the bookings". */
  role: 120,
  /** Its personality in your words, beside the tone: "Dry humour, never gushes". */
  personality: 2000,
  /**
   * What it should always do, in your words. Part of every turn's prompt, so
   * bounded, but roomy: an agent brought from OpenClaw can have a whole
   * handbook (≈25k tokens at most). Long ones are warned about, never cut
   * (`instructionsWeight`).
   */
  instructions: 100_000,
  /** An uploaded picture, after the browser framed and shrank it (bytes). */
  avatarBytes: 700_000,
  /** A picture made by a model, before the browser frames it (bytes). */
  generatedBytes: 12_000_000,
  /** What a generated picture should show, in your words. */
  avatarPrompt: 1000,
} as const;

/**
 * The instructions a Conch from before 100,000 read (ADR 0051): the store
 * keeps the first this many characters where that Conch looks, and the rest
 * beside them, so going back a version still reads the start.
 */
export const OLDER_INSTRUCTIONS = 8000;

// ── How heavy instructions are ──────────────────────────────────────────────

/** Tokens in plain text, roughly: about four ASCII characters each, about one for anything else. */
export function roughTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other);
}

/** From this many tokens, instructions cost noticeably on every reply, whatever the model. */
export const LONG_INSTRUCTIONS_TOKENS = 4_000;
/** Instructions taking more than this share of a model's window crowd it. */
export const CROWDED_INSTRUCTIONS_SHARE = 0.1;

/**
 * How much an agent's instructions weigh on every turn: `long` when they cost
 * noticeably on every reply, `crowded` when they take a real share of the
 * model's window (`window`, when the model says). Only ever a note: they're
 * kept whole either way.
 */
export function instructionsWeight(
  text: string,
  window?: number,
): { tokens: number; level: 'fine' | 'long' | 'crowded' } {
  const tokens = roughTokens(text.trim());
  if (window && tokens > window * CROWDED_INSTRUCTIONS_SHARE) return { tokens, level: 'crowded' };
  return { tokens, level: tokens >= LONG_INSTRUCTIONS_TOKENS ? 'long' : 'fine' };
}

/** “≈9k tokens”, “≈800 tokens”: a size a person can picture. */
export function aboutTokens(tokens: number): string {
  if (tokens < 1_000) return `≈${Math.max(10, Math.round(tokens / 10) * 10)} tokens`;
  return `≈${Math.round(tokens / 1_000)}k tokens`;
}

// ── Tone ────────────────────────────────────────────────────────────────────

/** How it speaks: a preset, with your own words beside it (`AgentPersona.personality`). */
export const Tone = z.enum(['warm', 'concise', 'playful', 'precise', 'calm', 'formal', 'candid']);
export type Tone = z.infer<typeof Tone>;

/**
 * Each tone's words: `label` and `description` for the page that picks one,
 * `prompt` for the model (the same sentence every turn, so it never costs a
 * prompt cache).
 */
export const TONES: Record<Tone, { label: string; description: string; prompt: string }> = {
  warm: {
    label: 'Warm',
    description: 'Friendly and encouraging',
    prompt:
      'Warm, encouraging and human. Plain language, a light touch of personality, never saccharine.',
  },
  concise: {
    label: 'Concise',
    description: 'Brief and to the point',
    prompt:
      'Brief and direct. Lead with the answer, skip pleasantries, use as few words as clarity allows.',
  },
  playful: {
    label: 'Playful',
    description: 'Curious, with a sense of humour',
    prompt:
      'Curious and good-humoured. Wit is welcome when it helps, but substance always comes first.',
  },
  precise: {
    label: 'Precise',
    description: 'Careful and exact',
    prompt:
      'Careful and exact. State assumptions, qualify uncertainty, prefer specifics over generalities.',
  },
  calm: {
    label: 'Calm',
    description: 'Patient and reassuring',
    prompt:
      'Calm and patient. Unhurried, reassuring without being vague, one step at a time when things are stressful.',
  },
  formal: {
    label: 'Formal',
    description: 'Polished and professional',
    prompt:
      'Professional and polished. Complete sentences, no slang or emoji, courteous and to the point.',
  },
  candid: {
    label: 'Candid',
    description: 'Honest, and says when you’re wrong',
    prompt:
      'Candid and straightforward. Say plainly when something is a bad idea and why, disagree when the facts call for it, never flatter.',
  },
};

// ── The face ────────────────────────────────────────────────────────────────

/** The pictures Conch draws itself (the web app owns the artwork; these are their names). */
export const AGENT_AVATAR_PRESETS = [
  'shell',
  'pearl',
  'wave',
  'coral',
  'spark',
  'leaf',
  'moon',
  'sun',
  'star',
  'cloud',
  'flame',
  'feather',
  'compass',
  'orbit',
  'owl',
  'fox',
  'cat',
  'bot',
] as const;
export const AgentAvatarPreset = z.enum(AGENT_AVATAR_PRESETS);
export type AgentAvatarPreset = z.infer<typeof AgentAvatarPreset>;

/** A picture's id: changes with every new picture, so its address can be cached for good. */
export const AgentImageId = z.string().regex(/^im_[A-Za-z0-9_-]{4,40}$/, 'Not a picture.');
export type AgentImageId = z.infer<typeof AgentImageId>;

/** The kinds a picture may be: never SVG, which can carry script. */
export const AgentImageType = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export type AgentImageType = z.infer<typeof AgentImageType>;

/**
 * Its face: one of Conch's pictures (in a colour), or a picture of your own
 * (uploaded, or made by a model and kept). `url` is where an image is served
 * from, behind sign-in; it changes when the picture does.
 */
export const AgentAvatar = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('preset'),
    id: AgentAvatarPreset,
    color: AppColor.optional(),
  }),
  z.object({
    kind: z.literal('image'),
    id: AgentImageId,
    type: AgentImageType,
    url: z.string().max(200),
  }),
]);
export type AgentAvatar = z.infer<typeof AgentAvatar>;

/** Where an agent's picture is served from: `GET /api/agents/:id/avatar/:imageId`. */
export function agentImageUrl(agentId: AgentId, imageId: AgentImageId): string {
  return `/api/agents/${agentId}/avatar/${imageId}`;
}

/** What a body may say about the face: an image only through its own routes. */
export const AgentPresetAvatar = AgentAvatar.options[0];
export type AgentPresetAvatar = z.infer<typeof AgentPresetAvatar>;

// ── The agent ───────────────────────────────────────────────────────────────

const name = z.string().trim().min(1).max(AGENT_LIMITS.name);
const role = z.string().trim().max(AGENT_LIMITS.role);
const personality = z.string().trim().max(AGENT_LIMITS.personality);
const instructions = z.string().trim().max(AGENT_LIMITS.instructions);

/** How it speaks: a tone, and your words for the rest of its personality. */
export const AgentPersona = z.object({
  tone: Tone.default('warm'),
  personality: personality.default(''),
});
export type AgentPersona = z.infer<typeof AgentPersona>;

/**
 * What a new chat with it starts with, unless the chat chooses otherwise.
 * Never Full trust: that is chosen for a chat, or as the default for every
 * chat, by a person (ADR 0100), and an agent can't carry it in.
 */
export const AgentDefaults = z
  .object({
    engine: EngineId.optional(),
    model: z.string().min(1).max(200).optional(),
    effort: EffortChoice.optional(),
    permissionMode: z
      .union([
        PermissionModeId.exclude(['bypassPermissions']),
        // Edit freely, before ADR 0119, reads as Auto (as `PermissionMode` does).
        z.literal('acceptEdits').transform(() => 'auto' as const),
      ])
      .optional(),
  })
  .strict()
  .refine((d) => !d.model || d.engine, { message: 'A model needs its provider.' });
export type AgentDefaults = z.infer<typeof AgentDefaults>;

/** Brought from another agent app (ADR 0042), so its card can say where it came from. */
export const AgentImported = z.object({
  /** `openclaw`, `hermes`. */
  from: z.string().min(1).max(40),
  /** The app's own id for it: `main`, `work`. */
  id: z.string().max(80).optional(),
  at: z.number(),
});
export type AgentImported = z.infer<typeof AgentImported>;

export const Agent = z.object({
  id: AgentId,
  /** What it calls itself, and what the chat shows beside its replies. */
  name,
  /** One line on what it's for. Empty: it's for anything. */
  role: role.default(''),
  avatar: AgentAvatar,
  persona: AgentPersona,
  /** What it should always do, in your words. */
  instructions: instructions.default(''),
  defaults: AgentDefaults.optional(),
  /** New chats, chat apps and routines start with it unless they choose another. Exactly one is. */
  isDefault: z.boolean(),
  /** Its place in pickers, smallest first. */
  order: z.number(),
  imported: AgentImported.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Agent = z.infer<typeof Agent>;

/** `GET /api/agents`, and `agents.changed`: every agent in its order, and which is the default. */
export const AgentList = z.object({
  agents: z.array(Agent).min(1).max(AGENT_LIMITS.count),
  defaultId: AgentId,
});
export type AgentList = z.infer<typeof AgentList>;

// ── REST bodies ─────────────────────────────────────────────────────────────

/** `POST /api/agents`. The picture can be a preset here; an image goes through its own route. */
export const CreateAgentBody = z
  .object({
    name,
    role: role.default(''),
    avatar: AgentPresetAvatar.default({ kind: 'preset', id: 'shell' }),
    persona: AgentPersona.default({ tone: 'warm', personality: '' }),
    instructions: instructions.default(''),
    defaults: AgentDefaults.optional(),
    /** Make it the default straight away. */
    isDefault: z.boolean().optional(),
  })
  .strict();
export type CreateAgentBody = z.input<typeof CreateAgentBody>;

/** `PATCH /api/agents/:id`: what changes. `defaults: null` takes them away. */
export const UpdateAgentBody = z
  .object({
    name: name.optional(),
    role: role.optional(),
    /** Back to one of Conch's pictures (the image it had is let go). */
    avatar: AgentPresetAvatar.optional(),
    persona: z
      .object({ tone: Tone.optional(), personality: personality.optional() })
      .strict()
      .optional(),
    instructions: instructions.optional(),
    defaults: AgentDefaults.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Nothing to change.',
  });
export type UpdateAgentBody = z.infer<typeof UpdateAgentBody>;

/** `PUT /api/agents/order`: every agent's id, in the new order. */
export const ReorderAgentsBody = z
  .object({ ids: z.array(AgentId).min(1).max(AGENT_LIMITS.count) })
  .strict();
export type ReorderAgentsBody = z.infer<typeof ReorderAgentsBody>;

/** `PUT /api/agents/default`: which agent new chats start with. */
export const DefaultAgentBody = z.object({ id: AgentId }).strict();
export type DefaultAgentBody = z.infer<typeof DefaultAgentBody>;

/**
 * `PUT /api/agents/:id/avatar`: a picture of your own, framed and shrunk by
 * the browser, as base64 PNG, JPEG or WebP. The gateway reads what it really
 * is from its bytes and keeps it without what a camera writes in it.
 */
export const AgentAvatarBody = z
  .object({
    data: z
      .string()
      .min(1)
      .max(Math.ceil((AGENT_LIMITS.avatarBytes * 4) / 3) + 4),
  })
  .strict();
export type AgentAvatarBody = z.infer<typeof AgentAvatarBody>;

/**
 * `GET /api/agents/avatar/generate`: whether a picture can be made, and by
 * whom. Unavailable: the page hides the button (`reason` says what would make
 * it possible, for a hint).
 */
export const AvatarGeneration = z.object({
  available: z.boolean(),
  /** The provider that would make it: "OpenRouter". */
  by: z.string().max(80).optional(),
  /** Why not, in a sentence, when it isn't. */
  reason: z.string().max(300).optional(),
  /** It costs money, billed by `by`. */
  paid: z.boolean().optional(),
});
export type AvatarGeneration = z.infer<typeof AvatarGeneration>;

/** `POST /api/agents/avatar/generate`: what the picture should show. */
export const GenerateAvatarBody = z
  .object({
    prompt: z.string().trim().min(1).max(AGENT_LIMITS.avatarPrompt),
    /** The agent's name and tone, to make a picture that suits it. */
    name: name.optional(),
    tone: Tone.optional(),
  })
  .strict();
export type GenerateAvatarBody = z.infer<typeof GenerateAvatarBody>;

/**
 * A picture made for you to look at, kept nowhere: the page frames and
 * shrinks it, then keeps it with `PUT /api/agents/:id/avatar` if you like it.
 */
export const GeneratedAvatar = z.object({
  data: z.string().max(Math.ceil((AGENT_LIMITS.generatedBytes * 4) / 3) + 4),
  type: AgentImageType,
  /** What it cost, when the provider said (USD). */
  costUsd: z.number().nonnegative().optional(),
});
export type GeneratedAvatar = z.infer<typeof GeneratedAvatar>;

// ── Who answers ─────────────────────────────────────────────────────────────

/**
 * The agent a chat is with, by id, whatever its record says: its own, else
 * the first agent (a chat from before agents), else the default. Always one
 * that exists.
 */
export function chatAgentId(
  chat: Pick<ConversationSummary, 'agentId'> | undefined,
  list: { agents: readonly { id: string }[]; defaultId: AgentId },
): AgentId {
  const has = (id: string | undefined): id is AgentId =>
    id !== undefined && list.agents.some((a) => a.id === id);
  if (has(chat?.agentId)) return chat.agentId;
  if (!chat?.agentId && has(FIRST_AGENT_ID)) return FIRST_AGENT_ID;
  return list.defaultId;
}

/** Who spoke one stretch of a chat: the agent's id and its name then (it may be gone since). */
export interface Speaker {
  agentId: AgentId;
  name: string;
}

/**
 * Who answered each part of a chat, from its own log: an `agent` event says
 * who answers from there on, and the first one says who answered before it
 * (`from`). Returns who is speaking after each event, in step with `events`,
 * starting with `initial` (the chat's agent when its log says nothing).
 * The web draws a reply's name and face from this; the gateway reads it too.
 */
export function speakersAlong(events: readonly ConversationEvent[], initial: Speaker): Speaker[] {
  const first = events.find((e) => e.type === 'agent');
  let now: Speaker =
    first?.type === 'agent' && first.from
      ? { agentId: first.from.agentId, name: first.from.name }
      : initial;
  return events.map((event) => {
    if (event.type === 'agent') now = { agentId: event.agentId, name: event.name };
    return now;
  });
}

/** An agent by name or id, for `/agent sage` in a chat app or the web: exact first, then a prefix. */
export function findAgent<T extends Pick<Agent, 'id' | 'name'>>(
  agents: readonly T[],
  query: string,
): T | undefined {
  const typed = query.trim();
  const q = typed.toLowerCase();
  if (!q) return undefined;
  return (
    agents.find((a) => a.id === typed || a.name.toLowerCase() === q) ??
    agents.find((a) => a.name.toLowerCase().startsWith(q))
  );
}
