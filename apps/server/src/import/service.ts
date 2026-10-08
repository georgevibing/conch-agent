/**
 * Come home (ADR 0035): bring your things from OpenClaw or Hermes into Conch.
 *
 * Three steps, each the person's:
 *
 * 1. **Look.** `plan()` reads the other agent's folder (read-only, no links
 *    followed) and lists every thing that could come over, with its words
 *    and a tick. Skills are read through first (ADR 0028). What could hurt
 *    or surprise — a worrying skill, a bot, a key — starts unticked.
 * 2. **Bring.** `run()` backs Conch up first, then brings the ticked things
 *    over: memories, your persona and about-you, skills (Off, to turn on
 *    when you're ready), routines (drafts: nothing runs by itself), chat
 *    bots (checked with the app, then waiting for your hello, ADR 0018) and
 *    keys (into Conch's encrypted key file).
 * 3. **Undo.** Everything it added is recorded, and goes again with one
 *    press; what it replaced (your persona, about you, the model new chats
 *    start with) comes back.
 *
 * ADR 0042 adds the model the other app answered with (matched to what's
 * connected here, or a sentence saying why not), OpenClaw's other agents
 * (each one's persona as a skill, with its memories, skills and routines),
 * and a Slack bot that came with only one of its two keys.
 *
 * The other app's folder is never written to, and secrets never leave this
 * process except into Conch's own key stores.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  Agent,
  AgentDefaults,
  AgentImported,
  AgentList,
  CreateAgentBody,
  UpdateAgentBody,
  ChannelBot,
  ChannelCheck,
  EngineId,
  FinishSlackImportBody,
  ImportGroup,
  ImportItem,
  ImportOutcome,
  ImportPlan,
  ImportResult,
  ImportSlackHalf,
  ImportSlackStatus,
  ImportSource,
  ImportSourceId,
  ImportStatus,
  MemoryHold,
  MemoryProvenance,
  Persona,
  Profile,
  Routine,
} from '@conch/protocol';
import {
  AGENT_LIMITS,
  OLDER_INSTRUCTIONS,
  AgentDefaults as AgentDefaultsSchema,
  AgentPersona,
  AgentPresetAvatar,
  EngineId as EngineIdSchema,
} from '@conch/protocol';
import { z } from 'zod';

import { joinInstructions, splitInstructions, uniqueName } from '../agents/store';
import { Mutex, readJson, writeJson } from '../lib/fs';
import { type AgentDraft, draftAgent } from './agents';
import { checkMemory } from '../memory/guard';
import { describe } from '../routines/schedule';
import { scanSkill, scanText, unsmuggle } from '../skills/scan';
import {
  type Found,
  type FoundAgent,
  type FoundChannel,
  type FoundIdentity,
  type FoundKey,
  type FoundRoutine,
  type KeyProvider,
  slackHalf,
} from './found';
import { PROVIDER_COPY } from '../providers/catalog';
import { readHermes } from './hermes';
import { type CatalogEntry, choiceTitle, mapModel, modelWords } from './model';
import { readOpenClaw } from './openclaw';

const CHANNEL_NAMES = { telegram: 'Telegram', discord: 'Discord', slack: 'Slack' } as const;
const KEY_WORDS = { botToken: 'bot token', appToken: 'app-level token' } as const;
/** The app's id inside an app-level token: `xapp-1-A0123ABCD-…`. */
const APP_IN_TOKEN = /^xapp-\d+-(A[A-Z0-9]{6,20})-/;
/** A provider's name, as its card says it. */
const keyName = (provider: KeyProvider) => PROVIDER_COPY.get(provider)?.name ?? provider;
/** The keys an older Conch's ledger knows; the rest are kept apart so it still reads (ADR 0051). */
const FIRST_KEYS = new Set<string>(['anthropic-api', 'openrouter']);

/** An agent as it was before an import brought it up to date: what Undo puts back. */
const AgentBefore = z.object({
  id: z.string().max(60),
  name: z.string().max(AGENT_LIMITS.name),
  role: z.string().max(AGENT_LIMITS.role),
  persona: AgentPersona,
  /** The start, as an older Conch reads the ledger (ADR 0051), then the rest (`splitInstructions`). */
  instructions: z.string().max(AGENT_LIMITS.instructions),
  instructionsRest: z.string().max(AGENT_LIMITS.instructions).optional(),
  /** Its preset face, when it had one (a picture of its own is never replaced). */
  avatar: AgentPresetAvatar.optional(),
  defaults: AgentDefaultsSchema.nullable(),
});
type AgentBefore = z.infer<typeof AgentBefore>;

/** What an import added and replaced, so Undo can put things back. */
const Ledger = z.object({
  last: z
    .object({
      at: z.number(),
      source: z.enum(['openclaw', 'hermes']),
      count: z.number(),
      created: z.object({
        memories: z.array(z.string()).default([]),
        skills: z.array(z.string()).default([]),
        routines: z.array(z.string()).default([]),
        channels: z.array(z.string()).default([]),
        keys: z.array(z.enum(['anthropic-api', 'openrouter'])).default([]),
        /** Keys for the providers ADR 0053 added, apart from `keys` so an older Conch reads the ledger. */
        moreKeys: z.array(z.string().max(40)).default([]),
        /** Agents it made (ADR 0101). */
        agents: z.array(z.string().max(60)).default([]),
      }),
      before: z
        .object({
          /** Agents an earlier import made, as they were before this one brought them up to date. */
          agents: z.array(AgentBefore).default([]),
          /** The default agent before this import chose another. */
          defaultAgent: z.string().max(60).optional(),
          persona: z.object({ name: z.string(), instructions: z.string() }).partial().optional(),
          about: z.string().optional(),
          /** The model new chats started with (`null`: the provider's own choice). */
          preferences: z
            .object({ engine: EngineIdSchema, model: z.string().nullable() })
            .optional(),
        })
        .default({ agents: [] }),
    })
    .optional(),
  history: z
    .array(z.object({ source: z.enum(['openclaw', 'hermes']), at: z.number(), count: z.number() }))
    .default([]),
});
type Ledger = z.infer<typeof Ledger>;

export const LEDGER = 'import.json';
/** Undo is offered for a week; after that, what came over is simply yours. */
const UNDO_MS = 7 * 24 * 60 * 60_000;

/** What Conch already has, to tell duplicates apart. */
export interface ImportTargets {
  settings: {
    get(): Promise<{
      persona: Persona;
      profile: Profile;
      preferences: { engine: EngineId; model?: string };
    }>;
    update(body: { persona?: Partial<Persona>; profile?: Partial<Profile> }): Promise<unknown>;
  };
  memory: {
    list(): Promise<{ id: string; content: string }[]>;
    add(
      input: {
        content: string;
        kind?: 'fact' | 'preference' | 'project' | 'person';
        source: 'user';
        provenance?: MemoryProvenance;
      },
      how?: { via: 'import'; cameFrom: string },
    ): Promise<{ id: string; held?: MemoryHold }>;
    remove(id: string): Promise<unknown>;
  };
  /** Settings → Safety → Check what it remembers (ADR 0087). */
  checkMemories?: () => Promise<boolean>;
  skills: {
    names(): Promise<string[]>;
    adopt(folder: string, base: string): Promise<{ id: string }>;
    remove(id: string): Promise<unknown>;
  };
  routines: {
    create(input: {
      title: string;
      summary: string;
      prompt: string;
      schedule: FoundRoutine['schedule'];
      timezone: string;
      status: 'draft';
      trust: 'ask';
      /** The agent that does it (ADR 0101): the one it ran as there. */
      agentId?: string;
    }): Promise<Routine>;
    remove(id: string): Promise<unknown>;
  };
  /**
   * Conch's agents (ADR 0101): each agent the other app ran comes over as
   * one. Without them, its agents stay behind (and the plan says so).
   */
  agents?: {
    list(): Promise<AgentList>;
    create(body: CreateAgentBody, extra: { imported: AgentImported }): Promise<Agent>;
    update(id: string, change: UpdateAgentBody): Promise<Agent>;
    /** A picture of its own (base64), read from its bytes and kept without metadata. */
    setImage(id: string, base64: string): Promise<Agent>;
    setDefault(id: string): Promise<unknown>;
    remove(id: string): Promise<unknown>;
    /** The default agent's name and instructions, as an import before agents changed them. */
    adoptPersona?(patch: Partial<Persona>): Promise<unknown>;
  };
  channels: {
    connect(channel: FoundChannel): Promise<{ id: string; name: string; view?: unknown }>;
    /** Which agent answers there (ADR 0101): the one that answered its bot in the other app. */
    setAgent?(id: string, agentId: string): Promise<unknown>;
    /** Is this key good, and whose bot is it? Nothing is saved (ADR 0042's Slack step). */
    check?(parts: { botToken?: string; appToken?: string }): Promise<ChannelCheck>;
    remove(id: string): Promise<unknown>;
  };
  keys: {
    has(provider: FoundKey['provider']): Promise<boolean>;
    set(provider: FoundKey['provider'], value: string): Promise<unknown>;
    clear(provider: FoundKey['provider']): Promise<unknown>;
  };
  /**
   * What each connected provider offers, and choosing the model new chats
   * start with (ADR 0042). Without it (the terminal), the model stays behind.
   */
  models?: {
    catalog(fresh?: boolean): Promise<CatalogEntry[]>;
    choose(choice: { engine: EngineId; model: string | null }): Promise<unknown>;
  };
  /** A backup to go back to, made before anything changes. */
  backup?: () => Promise<{ id: string }>;
  progress?: (done: number, total: number, current: string) => void;
}

export class ImportError extends Error {
  constructor(
    readonly code: 'not-found' | 'busy' | 'nothing',
    message: string,
  ) {
    super(message);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** `weekly-review` → “Weekly review”. */
const words = (name: string) => {
  const text = name.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
/**
 * Words that will reach the assistant, read like a skill first (ADR 0028):
 * one that reads like orders to it rather than something about you starts
 * unticked, with what Conch saw.
 */
function steering(text: string, file: string): Pick<ImportItem, 'review' | 'warning'> | undefined {
  const review = scanText(text, file);
  if (review.verdict === 'clean') return undefined;
  return {
    review,
    warning: 'Left unticked: it reads like orders to the assistant. Read it before bringing it.',
  };
}

/**
 * A memory from another assistant, looked at by the memory check too (ADR
 * 0087): one that would change where money goes, claims authority or hides
 * something starts unticked, saying why.
 */
function memorySteering(
  text: string,
  file: string,
  on: boolean,
): Pick<ImportItem, 'review' | 'warning'> | undefined {
  const odd = steering(text, file);
  if (odd) return odd;
  const verdict = checkMemory({ content: text, via: 'import', on });
  const why = verdict.reasons[0]?.words;
  if (verdict.verdict === 'ok' || !why) return undefined;
  return {
    warning: `Left unticked: ${why.charAt(0).toLowerCase()}${why.slice(1)} Read it before bringing it.`,
  };
}

const norm = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

function summarize(found: Found): string {
  const parts = [
    found.identities.length && plural(found.identities.length, 'agent'),
    found.memories.filter((m) => !m.daily).length &&
      plural(found.memories.filter((m) => !m.daily).length, 'memory', 'memories'),
    found.skills.length && plural(found.skills.length, 'skill'),
    found.routines.length && plural(found.routines.length, 'routine'),
    found.channels.length && plural(found.channels.length, 'chat app'),
    found.about && 'your profile',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nothing to bring over yet';
}

/** “Telegram”, “Telegram and Slack”. */
const listed = (words: string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** The keys and bot tokens the other app had: never part of an agent's words. */
const secretsOf = (found: Found): string[] => [
  ...found.keys.map((k) => k.value),
  ...found.channels.flatMap((c) => [c.token, c.appToken].filter((v): v is string => Boolean(v))),
];

/** The fields an import sets on an agent, compared to tell “already here” apart. */
const agentKey = (a: {
  name: string;
  role: string;
  persona: { tone: string; personality: string };
  instructions: string;
  defaults?: AgentDefaults | null;
}) =>
  JSON.stringify([
    a.name,
    a.role,
    a.persona.tone,
    a.persona.personality,
    a.instructions,
    a.defaults ?? null,
  ]);

/** Instructions the size an older Conch cut them to: worth a look in the app they came from. */
const cutShortLength = (text: string) => {
  const n = text.trim().length;
  return n >= OLDER_INSTRUCTIONS * 0.6 && n <= OLDER_INSTRUCTIONS;
};

/**
 * Whether an agent here is one an older Conch brought with the end of its
 * instructions cut off (at 8,000 characters): what it has is the start of
 * what the other app has now, to a paragraph or a sentence, and nothing of
 * its own was added since.
 */
export function cutShort(here: string, there: string): boolean {
  const kept = here.trim();
  return cutShortLength(kept) && there.length > kept.length && there.startsWith(kept);
}

/**
 * What in the rest of someone's own instructions holds it back for a look
 * (ADR 0101). Instructions are orders to the assistant by nature, and these
 * are the person's own, from their own computer, so "always", "never" or
 * "don't tell the user" are theirs to give. Only what reaches beyond words
 * waits: keys and passwords, sending things away, running downloads,
 * turning safety checks off.
 */
const REACHES = new Set(['secrets', 'exfiltration', 'download-run', 'binary']);
export const reachesFurther = (text: string) =>
  scanText(text, 'its instructions').findings.some(
    (f) => REACHES.has(f.kind) || (f.kind === 'deception' && f.severity === 'warning'),
  );

/** An agent that came over cut short, and what of it is still in the app it came from. */
export interface RestOfInstructions {
  agentId: string;
  name: string;
  source: ImportSourceId;
  /** “OpenClaw”. */
  label: string;
  /** Characters still to come. */
  chars: number;
  /**
   * The rest reaches further than words can: for keys or passwords, to send
   * things away, to run what it downloads, or to turn safety checks off. A
   * person reads it in Come home first.
   */
  review: boolean;
  /** Its files there changed since it came over: brought with one press, not by itself. */
  changed: boolean;
  /** The whole of its instructions now, ready to keep. */
  instructions: string;
}

export class ImportService {
  readonly #mutex = new Mutex();
  /** The last look at each source, so `run` imports exactly what was shown. */
  readonly #looked = new Map<ImportSourceId, Found>();

  constructor(
    private readonly deps: {
      home: string;
      /** Whose home folder to look in (tests point it at a fixture). */
      sourceHome?: string;
      targets: ImportTargets;
      now?: () => number;
    },
  ) {}

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  async #ledger(): Promise<Ledger> {
    const raw = await readJson<unknown>(join(this.deps.home, LEDGER)).catch(() => undefined);
    const parsed = Ledger.safeParse(raw ?? {});
    return parsed.success ? parsed.data : Ledger.parse({});
  }

  get #home() {
    return this.deps.sourceHome ?? homedir();
  }

  async #read(source: ImportSourceId): Promise<Found | undefined> {
    return source === 'openclaw' ? readOpenClaw(this.#home) : readHermes(this.#home);
  }

  #source(found: Found, ledger: Ledger): ImportSource {
    const before = [...ledger.history].reverse().find((h) => h.source === found.source);
    return {
      id: found.source,
      label: found.label,
      // `~/.openclaw`, as people know it.
      path: found.path.startsWith(`${this.#home}/`)
        ? `~${found.path.slice(this.#home.length)}`
        : found.path,
      summary: summarize(found),
      ...(before && { imported: { at: before.at, count: before.count } }),
    };
  }

  /** The agents found on this computer. Cheap enough to ask on every Settings open. */
  async status(): Promise<ImportStatus> {
    const ledger = await this.#ledger();
    const sources: ImportSource[] = [];
    for (const id of ['openclaw', 'hermes'] as const) {
      const found = await this.#read(id).catch(() => undefined);
      if (found) sources.push(this.#source(found, ledger));
    }
    const last = ledger.last && this.#now - ledger.last.at < UNDO_MS ? ledger.last : undefined;
    return {
      sources,
      ...(last && { last: { at: last.at, source: last.source, count: last.count } }),
    };
  }

  /** Everything that could come over from `source`, ticked or not, with its words. */
  async plan(source: ImportSourceId): Promise<ImportPlan> {
    const found = await this.#read(source);
    if (!found)
      throw new ImportError(
        'not-found',
        `${source === 'openclaw' ? 'OpenClaw' : 'Hermes'} isn’t on this computer.`,
      );
    this.#looked.set(source, found);
    const t = this.deps.targets;
    const { profile, preferences } = await t.settings.get();
    const known = new Set((await t.memory.list()).map((m) => norm(m.content)));
    const problems = [...found.problems];
    const skillNames = new Set((await t.skills.names()).map((n) => n.toLowerCase()));
    const items: ImportItem[] = [];

    // Its agents first: each as one of Conch's, with its face and voice (ADR 0101).
    const cast = await this.#agentPlan(found, problems);
    items.push(...cast.items);
    if (found.model) {
      const item = await this.#modelItem(found, preferences);
      if (typeof item === 'string') problems.push(item);
      else items.push(item);
    }

    if (found.about) {
      const odd = steering(found.about.text, found.about.from);
      const duplicate = profile.about.includes(found.about.text.slice(0, 80));
      items.push({
        id: 'about',
        group: 'about',
        title: 'What it knows about you',
        detail: `From ${found.label}’s ${found.about.from}, added to About you.`,
        preview: found.about.text,
        checked: !duplicate && !odd,
        duplicate,
        ...odd,
      });
    }

    const checkOn = (await this.deps.targets.checkMemories?.().catch(() => true)) ?? true;
    found.memories.forEach((m, i) => {
      const duplicate = known.has(norm(m.text));
      const odd = memorySteering(m.text, m.from, checkOn);
      items.push({
        id: `memory:${i}`,
        group: 'memories',
        title: m.text.length > 140 ? `${m.text.slice(0, 139)}…` : m.text,
        ...(m.text.length > 140 && { preview: m.text }),
        detail: m.daily
          ? `A note from ${m.from.replace(/^memory\/|\.md$/g, '')}`
          : `From ${m.from}`,
        checked: !m.daily && !duplicate && !odd,
        ...(duplicate && { duplicate }),
        ...odd,
      });
    });

    for (const skill of found.skills) {
      const review = await scanSkill(skill.path).catch(() => undefined);
      const duplicate = skillNames.has(skill.name.toLowerCase());
      items.push({
        id: `skill:${skill.name}`,
        group: 'skills',
        title: words(skill.name),
        detail: duplicate
          ? 'Conch already has a skill by this name; this one comes over as a copy.'
          : 'Comes over off: turn it on in Skills when you’re ready.',
        ...(review && { review }),
        checked: review?.verdict !== 'danger',
        ...(review?.verdict === 'danger' && {
          warning: 'Left unticked: read what Conch found before bringing it.',
        }),
      });
    }

    found.routines.forEach((r, i) => {
      const odd = steering(r.prompt, 'cron/jobs.json');
      items.push({
        id: `routine:${i}`,
        group: 'routines',
        title: r.title,
        detail: `${describe(r.schedule, r.timezone)} in ${found.label}${r.enabled ? '' : ' (paused there)'}. Comes over as a draft: nothing runs until you turn it on.`,
        preview: r.prompt,
        checked: !odd,
        ...odd,
      });
    });

    for (const c of found.channels) {
      const half = slackHalf(c);
      items.push({
        id: `channel:${c.kind}`,
        group: 'channels',
        title: `Your ${CHANNEL_NAMES[c.kind]} bot`,
        detail: half
          ? `Its ${KEY_WORDS[half]}, from ${found.label}’s ${c.from}. Slack needs one more key: Conch shows you where to get it, then waits for your hello.`
          : `Its key, from ${found.label}’s ${c.from}. Conch checks it with ${CHANNEL_NAMES[c.kind]}, then waits for your hello: nobody else gets in.`,
        checked: false,
        warning: `A bot answers in one app at a time. Stop ${found.label} first, or both will try to answer.`,
      });
    }

    for (const agent of found.agents) items.push(...(await this.#agentItems(agent, found, known)));

    for (const k of found.keys) {
      const has = await t.keys.has(k.provider).catch(() => false);
      items.push({
        id: `key:${k.provider}`,
        group: 'keys',
        title: `Your ${keyName(k.provider)} key`,
        detail: has
          ? `Conch already has a key for ${keyName(k.provider)}; it stays as it is.`
          : `Saved in Conch’s encrypted key file, so ${keyName(k.provider)} works here too. It’s never shown.`,
        checked: false,
        ...(has && { duplicate: true }),
      });
    }

    return {
      source: this.#source(found, await this.#ledger()),
      items,
      problems,
      ...(cast.defaultAgent && { defaultAgent: cast.defaultAgent }),
      ...(cast.current && { currentDefault: { name: cast.current } }),
    };
  }

  /** The agents it ran, as they'd be here, read once per look. */
  readonly #drafts = new Map<ImportSourceId, Map<string, AgentDraft>>();

  /**
   * Its own model and effort, as an agent's defaults (ADR 0101): the model
   * matched to what's connected here the way the app's own is (ADR 0042),
   * never a permission mode. A model that can't be placed stays behind, said.
   */
  #defaultsFor(
    who: FoundIdentity,
    name: string,
    found: Found,
    catalog: CatalogEntry[] | undefined,
  ): { defaults?: AgentDefaults; words?: string; note?: string; key?: KeyProvider } {
    const effort = who.effort;
    const base: AgentDefaults | undefined = effort ? { effort } : undefined;
    if (!who.model) return { ...(base && { defaults: base }) };
    if (!catalog)
      return {
        ...(base && { defaults: base }),
        note: `${name}’s model, ${modelWords(who.model.model)}, comes over in Conch itself: until then it uses your default.`,
      };
    const mapped = mapModel(
      who.model,
      name,
      catalog,
      found.keys.map((k) => k.provider),
    );
    if (!mapped.ok)
      return {
        ...(base && { defaults: base }),
        note: mapped.reason.replace('new chats start with it', 'its chats start with it'),
        ...(mapped.key && { key: mapped.key }),
      };
    return {
      defaults: { ...base, engine: mapped.choice.engine, model: mapped.choice.model },
      words: `${mapped.choice.modelLabel} on ${mapped.choice.engineLabel}`,
    };
  }

  /**
   * Each agent it ran, as one of Conch's (ADR 0101): its face, name (made
   * unique here), tone, personality and instructions, read first like any
   * words that will reach the assistant. One brought before is brought up to
   * date rather than made twice. Ticked, unless its words read like orders,
   * it's already as it would be, or Conch has no room for it.
   */
  async #agentPlan(
    found: Found,
    problems: string[],
  ): Promise<{ items: ImportItem[]; defaultAgent?: string; current?: string }> {
    const t = this.deps.targets;
    const drafts = new Map<string, AgentDraft>();
    this.#drafts.set(found.source, drafts);
    if (!found.identities.length) return { items: [] };
    if (!t.agents) {
      problems.push(`${found.label}’s agents come over in Conch itself: Settings → Memory.`);
      return { items: [] };
    }
    const list = await t.agents.list();
    const mine = (id: string) =>
      list.agents.find((a) => a.imported?.from === found.source && a.imported.id === id);
    const taken = list.agents
      .filter((a) => !found.identities.some((i) => mine(i.id)?.id === a.id))
      .map((a) => a.name);
    const catalog = t.models ? await t.models.catalog().catch(() => undefined) : undefined;
    let room = AGENT_LIMITS.count - list.agents.length;
    const known = secretsOf(found);
    const items: ImportItem[] = [];
    for (const who of found.identities) {
      const draft = await draftAgent(who, found.label, known);
      drafts.set(who.id, draft);
      const existing = mine(who.id);
      const name = uniqueName(draft.name, taken);
      taken.push(name);
      const { defaults, words, note } = this.#defaultsFor(who, name, found, catalog);
      const full = !existing && room <= 0;
      if (!existing) room -= 1;
      const same =
        existing !== undefined &&
        agentKey(existing) ===
          agentKey({ ...draft, name, defaults: defaults ?? existing.defaults ?? null });
      const odd = draft.review && {
        review: { verdict: draft.review.verdict, findings: draft.review.findings },
      };
      const apps = who.channels.map((c) => CHANNEL_NAMES[c]);
      const detail = [
        draft.role || `Your “${who.id}” agent in ${found.label}.`,
        words && `Its chats start with ${words}.`,
        apps.length && `It answered your ${listed(apps)} bot.`,
      ]
        .filter(Boolean)
        .map((s) => (/[.!?]$/.test(String(s)) ? s : `${s}.`))
        .join(' ');
      const warnings = [
        full &&
          `Conch keeps at most ${AGENT_LIMITS.count} agents: remove one in Agents to bring this one.`,
        odd &&
          'Left unticked: its words read like orders to the assistant. Read them before bringing it.',
        existing &&
          !same &&
          (cutShort(existing.instructions, draft.instructions)
            ? `Brought over before, when the end of its instructions stayed in ${found.label}: ticked, the rest comes in.`
            : 'Brought over before: ticked, it’s brought up to date.'),
        ...draft.notes,
        note,
      ].filter((w): w is string => Boolean(w));
      const image =
        draft.picture?.ok &&
        `/api/import/${found.source}/agents/${encodeURIComponent(who.id)}/face`;
      items.push({
        id: `agent:${who.id}`,
        group: 'agents',
        title: name,
        name,
        detail,
        ...(draft.instructions && { preview: draft.instructions }),
        face: {
          avatar: draft.avatar,
          ...(image && { image }),
          ...(draft.emoji && { emoji: draft.emoji }),
        },
        checked: !full && !odd && !same,
        ...(same && { duplicate: true }),
        ...(warnings.length && { warning: warnings.join(' ') }),
        ...odd,
      });
    }
    const current = list.agents.find((a) => a.id === list.defaultId)?.name;
    const theirs = found.defaultAgent && `agent:${found.defaultAgent}`;
    return {
      items,
      ...(theirs && items.some((i) => i.id === theirs) && { defaultAgent: theirs }),
      ...(current && { current }),
    };
  }

  /**
   * Agents an older Conch brought cut short (at 8,000 characters), whose app
   * still has the rest of their instructions: each with the whole of them now.
   * An agent changed here since, or gone there, isn't one.
   */
  async rest(): Promise<RestOfInstructions[]> {
    const agents = this.deps.targets.agents;
    if (!agents) return [];
    const list = await agents.list();
    const out: RestOfInstructions[] = [];
    for (const source of ['openclaw', 'hermes'] as const) {
      const theirs = list.agents.filter(
        (a) => a.imported?.from === source && a.imported.id && cutShortLength(a.instructions),
      );
      if (!theirs.length) continue;
      const found = await this.#read(source).catch(() => undefined);
      if (!found) continue;
      const known = secretsOf(found);
      for (const agent of theirs) {
        const who = found.identities.find((i) => i.id === agent.imported?.id);
        if (!who) continue;
        const draft = await draftAgent(who, found.label, known);
        if (!cutShort(agent.instructions, draft.instructions)) continue;
        const more = draft.instructions.slice(agent.instructions.trim().length);
        out.push({
          agentId: agent.id,
          name: agent.name,
          source,
          label: found.label,
          chars: more.trim().length,
          review: reachesFurther(more),
          // Unchanged since it came over: the same file the start was read from.
          changed: !who.wordsAt || who.wordsAt > (agent.imported?.at ?? 0),
          instructions: draft.instructions,
        });
      }
    }
    return out;
  }

  /**
   * The rest of one agent's instructions, brought in: only its instructions
   * change, to the whole of what it has there. A rest that reaches further
   * than words (`reachesFurther`) is read in Come home first, unless `reviewed`.
   */
  bringRest(agentId: string, options: { reviewed?: boolean } = {}): Promise<Agent | undefined> {
    return this.#mutex.run(async () => {
      const agents = this.deps.targets.agents;
      const one = (await this.rest()).find((r) => r.agentId === agentId);
      if (!agents || !one) return undefined;
      if (one.review && !options.reviewed)
        throw new ImportError(
          'nothing',
          'Some of the rest asks for keys, to send things away or to turn safety checks off. Read it in Come home before bringing it.',
        );
      return agents.update(agentId, { instructions: one.instructions });
    });
  }

  /**
   * At start, by itself (working agreement 11): the rest of every agent that
   * came over cut short, when its files there haven't changed since (the
   * same words the start came from). `changed` brings those too (Repair
   * everything, a person's press). Returns the ones brought in; the others
   * are offered on their page.
   */
  async finishCutShort(options: { changed?: boolean } = {}): Promise<RestOfInstructions[]> {
    const done: RestOfInstructions[] = [];
    for (const one of await this.rest()) {
      if (one.review || (one.changed && !options.changed)) continue;
      const agent = await this.bringRest(one.agentId).catch(() => undefined);
      if (agent) done.push(one);
    }
    return done;
  }

  /** An agent's own picture from the last look, for the plan to show (never kept until brought). */
  face(source: ImportSourceId, id: string): { bytes: Buffer; type: string } | undefined {
    const picture = this.#drafts.get(source)?.get(id)?.picture;
    return picture?.ok ? { bytes: picture.bytes, type: picture.type } : undefined;
  }

  /**
   * The model it answered with, matched to what's connected here (ADR
   * 0042): an item to tick, or a sentence saying why it stays behind.
   */
  async #modelItem(
    found: Found,
    current: { engine: EngineId; model?: string },
  ): Promise<ImportItem | string> {
    const model = found.model;
    if (!model) return '';
    const t = this.deps.targets;
    if (!t.models)
      return `${found.label}’s model choice comes over in Conch itself: Settings → Memory.`;
    const catalog = await t.models.catalog().catch(() => undefined);
    if (!catalog)
      return `Conch couldn’t ask its providers what they offer, so ${found.label}’s model stays behind for now. Look again in a moment.`;
    const mapped = mapModel(
      model,
      found.label,
      catalog,
      found.keys.map((k) => k.provider),
    );
    if (!mapped.ok) {
      if (!mapped.key) return mapped.reason;
      // It runs here once the app's own key comes over: offered, unticked, saying so.
      return {
        id: 'model',
        group: 'model',
        title: `Use ${modelWords(model.model)}, as in ${found.label}`,
        detail: `From ${found.label}’s ${model.from}, for new chats.`,
        checked: false,
        warning: mapped.reason,
      };
    }
    const { choice } = mapped;
    const now = catalog.find((c) => c.engine === current.engine);
    const nowLabel = current.model
      ? `${now?.models.find((m) => m.id === current.model)?.label ?? current.model} on ${now?.label ?? current.engine}`
      : `${now?.label ?? 'your default provider'}’s own choice`;
    const duplicate = current.engine === choice.engine && current.model === choice.model;
    return {
      id: 'model',
      group: 'model',
      title: `Use ${choiceTitle(model, choice)}, as in ${found.label}`,
      detail: `New chats start with ${choice.modelLabel} on ${choice.engineLabel}${
        choice.exact ? '' : `, the nearest here to ${modelWords(model.model)}`
      }. Now it’s ${nowLabel}.`,
      // Only when you haven't chosen one yourself, like the name.
      checked: !current.model && !duplicate,
      ...(duplicate && { duplicate }),
    };
  }

  /**
   * Another agent's things (ADR 0042): its about-you, memories, skills and
   * routines, all read first like the main agent's, and shown together
   * under its name. The agent itself is one of the `agents` items.
   */
  async #agentItems(agent: FoundAgent, found: Found, known: Set<string>): Promise<ImportItem[]> {
    const tag = { agent: { id: agent.id, name: agent.name } };
    const prefix = `agent:${agent.id}`;
    const items: ImportItem[] = [];
    const main = new Set(found.memories.map((m) => norm(m.text)));
    const checkOn = (await this.deps.targets.checkMemories?.().catch(() => true)) ?? true;
    const skillNames = new Set(
      (await this.deps.targets.skills.names()).map((n) => n.toLowerCase()),
    );

    if (agent.about && agent.about.text !== found.about?.text) {
      const odd = steering(agent.about.text, agent.about.from);
      items.push({
        id: `${prefix}:about`,
        group: 'about',
        title: `What ${agent.name} knows about you`,
        detail: `From ${agent.name}’s ${agent.about.from}, added to About you.`,
        preview: agent.about.text,
        checked: !odd,
        ...odd,
        ...tag,
      });
    }
    agent.memories.forEach((m, i) => {
      // The main agent has it too: it comes over once, from there.
      if (main.has(norm(m.text))) return;
      const duplicate = known.has(norm(m.text));
      const odd = memorySteering(m.text, m.from, checkOn);
      items.push({
        id: `${prefix}:memory:${i}`,
        group: 'memories',
        title: m.text.length > 140 ? `${m.text.slice(0, 139)}…` : m.text,
        ...(m.text.length > 140 && { preview: m.text }),
        detail: m.daily
          ? `A note from ${m.from.replace(/^memory\/|\.md$/g, '')}, in ${agent.name}’s workspace`
          : `From ${agent.name}’s ${m.from}`,
        checked: !m.daily && !duplicate && !odd,
        ...(duplicate && { duplicate }),
        ...odd,
        ...tag,
      });
    });
    for (const skill of agent.skills) {
      const review = await scanSkill(skill.path).catch(() => undefined);
      const duplicate = skillNames.has(skill.name.toLowerCase());
      items.push({
        id: `${prefix}:skill:${skill.name}`,
        group: 'skills',
        title: words(skill.name),
        detail: duplicate
          ? 'Conch already has a skill by this name; this one comes over as a copy.'
          : 'Comes over off: turn it on in Skills when you’re ready.',
        ...(review && { review }),
        checked: review?.verdict !== 'danger',
        ...(review?.verdict === 'danger' && {
          warning: 'Left unticked: read what Conch found before bringing it.',
        }),
        ...tag,
      });
    }
    agent.routines.forEach((r, i) => {
      const odd = steering(r.prompt, 'cron/jobs.json');
      items.push({
        id: `${prefix}:routine:${i}`,
        group: 'routines',
        title: r.title,
        detail: `${describe(r.schedule, r.timezone)}, as ${agent.name}${r.enabled ? '' : ' (paused there)'}. Comes over as a draft: nothing runs until you turn it on.`,
        preview: r.prompt,
        checked: !odd,
        ...odd,
        ...tag,
      });
    });
    return items;
  }

  /**
   * Bring the ticked things over. A backup is made first; then each item, one
   * at a time: agents first, so the routines and bots that were theirs go
   * with them. `defaultAgent` (a ticked `agent:` item) starts new chats.
   */
  run(
    source: ImportSourceId,
    ids: string[],
    options: { defaultAgent?: string } = {},
  ): Promise<ImportResult> {
    return this.#mutex.run(async () => {
      const found = this.#looked.get(source) ?? (await this.#read(source));
      if (!found) throw new ImportError('not-found', 'That app isn’t on this computer any more.');
      const wanted = new Set(ids);
      if (!wanted.size) throw new ImportError('nothing', 'Tick something to bring over.');
      const t = this.deps.targets;
      const total = wanted.size;
      let done = 0;
      const tick = (current: string) => t.progress?.(done, total, current);

      tick('Backing up first');
      const backup = await t.backup?.().catch(() => undefined);

      const outcomes: ImportOutcome[] = [];
      const counts: Partial<Record<ImportGroup, number>> = {};
      const ok = (id: string, group: ImportGroup, title: string, message?: string) => {
        outcomes.push({ id, group, title, ok: true, ...(message && { message }) });
        counts[group] = (counts[group] ?? 0) + 1;
      };
      const failed = (id: string, group: ImportGroup, title: string, message: string) =>
        outcomes.push({ id, group, title, ok: false, message });
      const created: NonNullable<Ledger['last']>['created'] = {
        memories: [],
        skills: [],
        routines: [],
        channels: [],
        keys: [],
        moreKeys: [],
        agents: [],
      };
      const before: NonNullable<Ledger['last']>['before'] = { agents: [] };
      const settings = await t.settings.get();

      const step = async (
        id: string,
        group: ImportGroup,
        title: string,
        work: () => Promise<string | undefined>,
      ) => {
        if (!wanted.has(id)) return;
        tick(title);
        try {
          const message = await work();
          ok(id, group, title, message || undefined);
        } catch (error) {
          failed(id, group, title, (error as Error).message || 'It didn’t come over.');
        }
        done += 1;
      };

      // What you ticked comes, noting where from (ADR 0087); the plan already
      // left anything that looks planted unticked, with why.
      const bringIn = async (text: string, from: string) => {
        // Ticked by you, and still checked where it's written (ADR 0087): one
        // that looks planted comes in waiting for your OK, saying why.
        const memory = await t.memory.add(
          {
            content: text,
            source: 'user',
            provenance: { via: 'import', read: [from.slice(0, 120)] },
          },
          { via: 'import', cameFrom: `the memories you brought in from ${from}` },
        );
        created.memories.push(memory.id);
        return memory.held
          ? `Waiting for your OK: ${memory.held.reasons[0]?.words ?? ''}`.trim()
          : undefined;
      };

      // Its agents (ADR 0101), each as one of Conch's. `here` maps the app's id to
      // Conch's, for the routines and bots that were theirs; one brought before counts.
      const here = new Map<string, string>();
      const names = new Map<string, string>();
      /** Agents whose model needs a key that comes over below: set once it has. */
      const later: { id: string; who: FoundIdentity; name: string; key: KeyProvider }[] = [];
      if (t.agents && found.identities.length) {
        const agents = t.agents;
        const list = await agents.list();
        const mine = (id: string) =>
          list.agents.find((a) => a.imported?.from === source && a.imported.id === id);
        for (const who of found.identities) {
          const existing = mine(who.id);
          if (existing) {
            here.set(who.id, existing.id);
            names.set(who.id, existing.name);
          }
        }
        const taken = list.agents
          .filter((a) => !found.identities.some((i) => mine(i.id)?.id === a.id))
          .map((a) => a.name);
        const catalog = found.identities.some((i) => i.model)
          ? await t.models?.catalog(true).catch(() => undefined)
          : undefined;
        const drafts = this.#drafts.get(source) ?? new Map<string, AgentDraft>();
        const known = secretsOf(found);
        for (const who of found.identities) {
          const draft = drafts.get(who.id) ?? (await draftAgent(who, found.label, known));
          const name = uniqueName(draft.name, taken);
          taken.push(name);
          await step(`agent:${who.id}`, 'agents', name, async () => {
            const existing = mine(who.id);
            const { defaults, note, key } = this.#defaultsFor(who, name, found, catalog);
            const notes = [...draft.notes];
            let agent: Agent;
            if (existing) {
              before.agents.push({
                id: existing.id,
                name: existing.name,
                role: existing.role,
                persona: existing.persona,
                ...splitInstructions(existing.instructions),
                ...(existing.avatar.kind === 'preset' && { avatar: existing.avatar }),
                defaults: existing.defaults ?? null,
              });
              agent = await agents.update(existing.id, {
                name,
                role: draft.role,
                persona: draft.persona,
                instructions: draft.instructions,
                defaults: defaults ?? null,
                // A picture of its own, made here or kept from before, stays.
                ...(existing.avatar.kind === 'preset' && { avatar: draft.avatar }),
              });
            } else {
              agent = await agents.create(
                {
                  name,
                  role: draft.role,
                  avatar: draft.avatar,
                  persona: draft.persona,
                  instructions: draft.instructions,
                  ...(defaults && { defaults }),
                },
                { imported: { from: source, id: who.id, at: this.#now } },
              );
              created.agents.push(agent.id);
            }
            here.set(who.id, agent.id);
            names.set(who.id, agent.name);
            if (draft.picture?.ok && agent.avatar.kind === 'preset')
              await agents.setImage(agent.id, draft.picture.bytes.toString('base64')).catch(() => {
                notes.push('Its picture couldn’t be kept: it has one of Conch’s faces for now.');
              });
            if (key && wanted.has(`key:${key}`)) later.push({ id: agent.id, who, name, key });
            else if (note) notes.push(note);
            return notes.join(' ') || undefined;
          });
        }
        // Theirs (or the one you chose) starts new chats: only one that came over now.
        const chosen = options.defaultAgent?.startsWith('agent:')
          ? options.defaultAgent.slice('agent:'.length)
          : undefined;
        const id = chosen && wanted.has(`agent:${chosen}`) ? here.get(chosen) : undefined;
        const brought = outcomes.find((o) => o.id === `agent:${chosen}` && o.ok);
        if (id && brought) {
          const now = (await agents.list()).defaultId;
          if (now !== id) {
            before.defaultAgent = now;
            await agents.setDefault(id);
            brought.message = [`New chats start with ${brought.title}.`, brought.message]
              .filter(Boolean)
              .join(' ');
          }
        }
      }
      const agentOf = (appId: string | undefined) => (appId ? here.get(appId) : undefined);

      if (found.about)
        await step('about', 'about', 'About you', async () => {
          before.about = settings.profile.about;
          const about = [settings.profile.about.trim(), unsmuggle(found.about?.text ?? '')]
            .filter(Boolean)
            .join('\n\n');
          await t.settings.update({ profile: { about: about.slice(0, 4000) } });
          return undefined;
        });

      for (const [i, m] of found.memories.entries())
        await step(`memory:${i}`, 'memories', m.text.slice(0, 80), async () => {
          const known = new Set((await t.memory.list()).map((x) => norm(x.content)));
          if (known.has(norm(m.text))) return 'Already remembered.';
          return bringIn(m.text, found.label);
        });

      for (const s of found.skills)
        await step(`skill:${s.name}`, 'skills', s.name, async () => {
          const skill = await t.skills.adopt(s.path, s.name);
          created.skills.push(skill.id);
          return 'Off for now: turn it on in Skills.';
        });

      const routine = async (r: FoundRoutine, owner: string | undefined) => {
        const agentId = agentOf(owner);
        const made = await t.routines.create({
          title: r.title,
          summary: '',
          prompt: unsmuggle(r.prompt),
          schedule: r.schedule,
          timezone: r.timezone,
          status: 'draft',
          trust: 'ask',
          ...(agentId && { agentId }),
        });
        created.routines.push(made.id);
        return 'A draft: turn it on in Routines when you’re ready.';
      };
      for (const [i, r] of found.routines.entries())
        await step(`routine:${i}`, 'routines', r.title, () => routine(r, found.mainAgent));

      // Another agent's things come as the main one's do; its routines go with it.
      for (const agent of found.agents) {
        const prefix = `agent:${agent.id}`;
        if (agent.about)
          await step(`${prefix}:about`, 'about', `About you, from ${agent.name}`, async () => {
            const now = (await t.settings.get()).profile.about;
            before.about ??= settings.profile.about;
            const text = unsmuggle(agent.about?.text ?? '');
            if (now.includes(text.slice(0, 80))) return 'Already in About you.';
            await t.settings.update({
              profile: { about: [now.trim(), text].filter(Boolean).join('\n\n').slice(0, 4000) },
            });
            return undefined;
          });
        for (const [i, m] of agent.memories.entries())
          await step(`${prefix}:memory:${i}`, 'memories', m.text.slice(0, 80), async () => {
            const known = new Set((await t.memory.list()).map((x) => norm(x.content)));
            if (known.has(norm(m.text))) return 'Already remembered.';
            return bringIn(m.text, `${agent.name} in ${found.label}`);
          });
        for (const s of agent.skills)
          await step(`${prefix}:skill:${s.name}`, 'skills', s.name, async () => {
            const skill = await t.skills.adopt(s.path, s.name);
            created.skills.push(skill.id);
            return 'Off for now: turn it on in Skills.';
          });
        for (const [i, r] of agent.routines.entries())
          await step(`${prefix}:routine:${i}`, 'routines', r.title, () => routine(r, agent.id));
      }

      for (const c of found.channels) {
        const half = slackHalf(c);
        if (half) {
          // Nothing to connect yet: the summary sends the person to Slack for the other key.
          if (!wanted.has(`channel:${c.kind}`)) continue;
          outcomes.push({
            id: `channel:${c.kind}`,
            group: 'channels',
            title: 'Slack bot',
            ok: true,
            message: `Slack needs one more key, the ${KEY_WORDS[half === 'botToken' ? 'appToken' : 'botToken']}: Conch shows you where to get it.`,
            finish: 'slack-key',
          });
          done += 1;
          continue;
        }
        await step(`channel:${c.kind}`, 'channels', `${CHANNEL_NAMES[c.kind]} bot`, async () => {
          const channel = await t.channels.connect(c);
          created.channels.push(channel.id);
          const as = await this.#answerAs(found, c.kind, channel.id, agentOf, names);
          return [
            `Say hello to ${channel.name} in ${CHANNEL_NAMES[c.kind]} to finish: nobody else gets in.`,
            as,
          ]
            .filter(Boolean)
            .join(' ');
        });
      }

      for (const k of found.keys)
        await step(`key:${k.provider}`, 'keys', `${keyName(k.provider)} key`, async () => {
          if (await t.keys.has(k.provider))
            return `Conch already had a ${keyName(k.provider)} key; it kept it.`;
          await t.keys.set(k.provider, k.value);
          if (FIRST_KEYS.has(k.provider))
            created.keys.push(k.provider as 'anthropic-api' | 'openrouter');
          else created.moreKeys.push(k.provider);
          return undefined;
        });

      // Last, so a key that just came over can bring the provider the model runs on.
      const model = found.model;
      if (model)
        await step('model', 'model', `Model: ${modelWords(model.model)}`, async () => {
          if (!t.models) throw new Error('Your model choice comes over in Conch itself.');
          const mapped = mapModel(model, found.label, await t.models.catalog(true));
          if (!mapped.ok) throw new Error(mapped.reason);
          const { choice } = mapped;
          before.preferences = {
            engine: settings.preferences.engine,
            model: settings.preferences.model ?? null,
          };
          await t.models.choose({ engine: choice.engine, model: choice.model });
          return `New chats start with ${choice.modelLabel} on ${choice.engineLabel}.`;
        });

      // An agent's own model, now that the key it needed may be here.
      if (later.length && t.agents) {
        const catalog = await t.models?.catalog(true).catch(() => undefined);
        for (const l of later) {
          const outcome = outcomes.find((o) => o.id === `agent:${l.who.id}`);
          const { defaults, words, note } = this.#defaultsFor(l.who, l.name, found, catalog);
          if (defaults?.model) await t.agents.update(l.id, { defaults }).catch(() => undefined);
          const said = defaults?.model ? `Its chats start with ${words}.` : note;
          if (outcome && said) outcome.message = [outcome.message, said].filter(Boolean).join(' ');
        }
      }

      const count = outcomes.filter((o) => o.ok).length;
      const ledger = await this.#ledger();
      await writeJson(join(this.deps.home, LEDGER), {
        last: { at: this.#now, source, count, created, before },
        history: [...ledger.history, { source, at: this.#now, count }].slice(-20),
      } satisfies Ledger);
      t.progress?.(total, total, 'Done');
      return {
        source,
        counts: Object.fromEntries(
          (
            [
              'agents',
              'persona',
              'model',
              'about',
              'memories',
              'skills',
              'routines',
              'channels',
              'keys',
            ] as const
          ).map((g) => [g, counts[g] ?? 0]),
        ) as ImportResult['counts'],
        outcomes,
        ...(backup && { backupId: backup.id }),
        undoable: count > 0,
      };
    });
  }

  /**
   * The agent that answered this bot in the other app answers it here too
   * (`Channel.agentId`), when it's one of Conch's now. A sentence saying so.
   */
  async #answerAs(
    found: Found,
    kind: FoundChannel['kind'],
    channelId: string,
    agentOf: (appId: string | undefined) => string | undefined,
    names: Map<string, string>,
  ): Promise<string | undefined> {
    const who = found.identities.find((i) => i.channels.includes(kind));
    const agentId = agentOf(who?.id);
    const setAgent = this.deps.targets.channels.setAgent;
    if (!who || !agentId || !setAgent) return undefined;
    try {
      await setAgent(channelId, agentId);
      return `${names.get(who.id) ?? who.name} answers there, as in ${found.label}.`;
    } catch {
      return undefined;
    }
  }

  /** Take the last import back: what it added goes, what it replaced comes back. */
  undo(): Promise<{ removed: number; restored: number }> {
    return this.#mutex.run(async () => {
      const ledger = await this.#ledger();
      const last = ledger.last;
      if (!last || this.#now - last.at > UNDO_MS)
        throw new ImportError('nothing', 'There’s no import to undo.');
      const t = this.deps.targets;
      let removed = 0;
      let restored = 0;
      const quietly = async (work: () => Promise<unknown>) => {
        try {
          await work();
          removed += 1;
        } catch {
          // Already gone (removed by hand since): nothing to take back.
        }
      };
      for (const id of last.created.memories) await quietly(() => t.memory.remove(id));
      for (const id of last.created.skills) await quietly(() => t.skills.remove(id));
      for (const id of last.created.routines) await quietly(() => t.routines.remove(id));
      for (const id of last.created.channels) await quietly(() => t.channels.remove(id));
      for (const p of [...last.created.keys, ...last.created.moreKeys] as KeyProvider[])
        await quietly(() => t.keys.clear(p));
      // Agents (ADR 0101): the default as it was first, then what it changed, then what it made.
      const agents = t.agents;
      if (agents) {
        if (last.before.defaultAgent) {
          const to = last.before.defaultAgent;
          if ((await agents.list()).agents.some((a) => a.id === to)) {
            await agents.setDefault(to).catch(() => undefined);
            restored += 1;
          }
        }
        for (const a of last.before.agents)
          try {
            await agents.update(a.id, {
              name: a.name,
              role: a.role,
              persona: a.persona,
              instructions: joinInstructions(a),
              defaults: a.defaults,
              ...(a.avatar && { avatar: a.avatar }),
            });
            restored += 1;
          } catch {
            // Gone since, or renamed to a name another agent has now: it stays as it is.
          }
        for (const id of last.created.agents) await quietly(() => agents.remove(id));
      }
      // From an import before agents: the default agent's name and instructions.
      if (last.before.persona && Object.keys(last.before.persona).length) {
        if (agents?.adoptPersona) await agents.adoptPersona(last.before.persona);
        else await t.settings.update({ persona: last.before.persona });
        restored += 1;
      }
      if (last.before.about !== undefined) {
        await t.settings.update({ profile: { about: last.before.about } });
        restored += 1;
      }
      if (last.before.preferences && t.models) {
        try {
          await t.models.choose(last.before.preferences);
          restored += 1;
        } catch {
          // That provider is gone since: new chats keep what they start with now.
        }
      }
      await writeJson(join(this.deps.home, LEDGER), {
        history: ledger.history,
      } satisfies Ledger);
      return { removed, restored };
    });
  }

  /**
   * A Slack bot another app had only one key for (ADR 0042), for the Slack
   * setup to pick up from: which key, whose bot, and the app's id for a
   * link straight to the page with the other key. Never the key itself.
   */
  async slack(only?: ImportSourceId): Promise<ImportSlackStatus> {
    for (const source of only ? [only] : (['openclaw', 'hermes'] as const)) {
      const found = await this.#read(source).catch(() => undefined);
      const channel = found?.channels.find((c) => slackHalf(c));
      const has = channel && slackHalf(channel);
      if (!found || !channel || !has) continue;
      const half: ImportSlackHalf = { source, label: found.label, has };
      const inToken = channel.appToken && APP_IN_TOKEN.exec(channel.appToken)?.[1];
      if (inToken) half.appId = inToken;
      const check = this.deps.targets.channels.check;
      if (check) {
        const result = await check(
          has === 'botToken' ? { botToken: channel.token } : { appToken: channel.appToken },
        ).catch(() => undefined);
        if (result?.ok) {
          if (has === 'botToken') half.bot = result.bot as ChannelBot;
          if (result.appId) half.appId ??= result.appId;
        } else if (result)
          half.problem = `Slack doesn’t accept the ${KEY_WORDS[has]} ${found.label} had any more, so set this bot up fresh below.`;
      }
      return { half };
    }
    return {};
  }

  /**
   * Connect that Slack bot with the key that was missing (ADR 0042). Like
   * any import, it's in the ledger, so Undo takes it back.
   */
  finishSlack(
    source: ImportSourceId,
    body: FinishSlackImportBody,
  ): Promise<{ id: string; view?: unknown }> {
    return this.#mutex.run(async () => {
      const found = await this.#read(source);
      const channel = found?.channels.find((c) => slackHalf(c));
      if (!found || !channel)
        throw new ImportError('not-found', 'There’s no Slack bot waiting for its other key.');
      const token = channel.token ?? body.botToken;
      const appToken = channel.appToken ?? body.appToken;
      if (!token || !appToken)
        throw new ImportError(
          'nothing',
          `Paste the ${KEY_WORDS[channel.token ? 'appToken' : 'botToken']} first.`,
        );
      const made = await this.deps.targets.channels.connect({ ...channel, token, appToken });
      // The agent that answered it there answers it here, once it's one of Conch's (ADR 0101).
      const list = await this.deps.targets.agents?.list().catch(() => undefined);
      const ofApp = (appId: string | undefined) =>
        list?.agents.find((a) => a.imported?.from === source && a.imported.id === appId)?.id;
      await this.#answerAs(found, 'slack', made.id, ofApp, new Map());
      const ledger = await this.#ledger();
      const last =
        ledger.last && ledger.last.source === source && this.#now - ledger.last.at < UNDO_MS
          ? ledger.last
          : undefined;
      await writeJson(join(this.deps.home, LEDGER), {
        last: last
          ? {
              ...last,
              count: last.count + 1,
              created: { ...last.created, channels: [...last.created.channels, made.id] },
            }
          : {
              at: this.#now,
              source,
              count: 1,
              created: {
                memories: [],
                skills: [],
                routines: [],
                channels: [made.id],
                keys: [],
                moreKeys: [],
                agents: [],
              },
              before: { agents: [] },
            },
        history: last
          ? ledger.history
          : [...ledger.history, { source, at: this.#now, count: 1 }].slice(-20),
      } satisfies Ledger);
      return made;
    });
  }
}
