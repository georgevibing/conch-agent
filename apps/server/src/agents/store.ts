/**
 * `~/.conch/agents/` (ADR 0101): `agents.json`, every agent and which is the
 * default, and `avatars/`, the pictures of your own (one file each, named by
 * the picture's id). Pictures are kept without their metadata (`picture.ts`).
 *
 * There is always one agent at least. The first is made from the personality
 * chosen at setup (`settings.json` `persona`), and the default agent is
 * written back there too, so a Conch from before agents still reads the right
 * name, tone and instructions if you go back to it (ADR 0051).
 *
 * Lenient on purpose: an agent with an odd field is put right, not lost; a
 * file that won't read at all is kept aside and the first agent is made again
 * from your settings.
 *
 * Instructions are kept in two parts (ADR 0051): `instructions` holds the
 * start, at most the 8,000 characters a Conch from before read there (cut
 * where a paragraph ends), and `instructionsRest` holds the rest, exactly, so
 * the two together are the whole. Going back a version reads the start, as it
 * always did, instead of finding the field too long and losing it all.
 */
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AGENT_LIMITS,
  Agent,
  OLDER_INSTRUCTIONS,
  AgentDefaults,
  AgentId,
  AgentImageId,
  AgentImageType,
  AgentImported,
  AgentPersona,
  AgentPresetAvatar,
  CreateAgentBody,
  FIRST_AGENT_ID,
  type Tone,
  UpdateAgentBody,
  agentImageUrl,
  chatAgentId,
  type AgentList,
  type Persona,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, safeJoin, writeFileAtomic, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { readStore, type Heal } from '../lib/recover';
import type { SettingsStore } from '../settings/store';
import { cleanPicture, pictureType } from './picture';

export const AGENTS_DIR = 'agents';
export const AGENTS_FILE = 'agents.json';
export const AVATARS_DIR = 'avatars';

const StoredAvatar = z.discriminatedUnion('kind', [
  AgentPresetAvatar,
  z.object({ kind: z.literal('image'), id: AgentImageId, type: AgentImageType }),
]);
type StoredAvatar = z.infer<typeof StoredAvatar>;

const SHELL: StoredAvatar = { kind: 'preset', id: 'shell' };

/**
 * Instructions as a Conch from before reads them, and the rest beside them:
 * the start (at most `OLDER_INSTRUCTIONS`, cut where a paragraph, else a
 * sentence, else a word ends) and what follows, exactly.
 */
export function splitInstructions(text: string): {
  instructions: string;
  instructionsRest?: string;
} {
  if (text.length <= OLDER_INSTRUCTIONS) return { instructions: text };
  const head = text.slice(0, OLDER_INSTRUCTIONS);
  const end =
    [head.lastIndexOf('\n\n'), head.lastIndexOf('. ') + 1, head.lastIndexOf(' ')].find(
      (at) => at > OLDER_INSTRUCTIONS * 0.6,
    ) ?? OLDER_INSTRUCTIONS;
  return { instructions: text.slice(0, end), instructionsRest: text.slice(end) };
}

/** The whole of an agent's instructions, from its two parts. */
export function joinInstructions(parts: {
  instructions: string;
  instructionsRest?: string;
}): string {
  return `${parts.instructions}${parts.instructionsRest ?? ''}`
    .trim()
    .slice(0, AGENT_LIMITS.instructions);
}

/** One agent as kept: what's derived (`isDefault`, the picture's address) is worked out on reading. */
const DiskAgent = z.object({
  id: AgentId,
  name: Agent.shape.name.catch('Agent'),
  role: z.string().trim().max(AGENT_LIMITS.role).catch(''),
  avatar: StoredAvatar.catch(SHELL),
  persona: AgentPersona.catch({ tone: 'warm', personality: '' }),
  // Either part too long (a hand-edited file) keeps the start, never loses it all.
  instructions: z
    .string()
    .catch('')
    .transform((s) => s.slice(0, AGENT_LIMITS.instructions)),
  instructionsRest: z.string().optional().catch(undefined),
  defaults: AgentDefaults.optional().catch(undefined),
  order: z.number().catch(0),
  imported: AgentImported.optional().catch(undefined),
  createdAt: z.number().catch(0),
  updatedAt: z.number().catch(0),
});
/** In memory, the instructions are one text; they're split again only on the way to disk. */
const StoredAgent = DiskAgent.transform(({ instructionsRest, ...agent }) => ({
  ...agent,
  instructions: joinInstructions({ instructions: agent.instructions, instructionsRest }),
}));
export type StoredAgent = z.infer<typeof StoredAgent>;

const AgentsFile = z.object({
  version: z.literal(1).catch(1),
  defaultId: AgentId.optional().catch(undefined),
  agents: z
    .array(z.unknown())
    .catch([])
    .transform((list) => {
      const seen = new Set<string>();
      return list.flatMap((raw) => {
        const read = StoredAgent.safeParse(raw);
        if (!read.success || seen.has(read.data.id)) return [];
        seen.add(read.data.id);
        return [read.data];
      });
    }),
});
type AgentsFile = z.infer<typeof AgentsFile>;

/** The file as written: every agent's instructions in the two parts an older Conch can read. */
function toDisk(file: AgentsFile) {
  return {
    ...file,
    agents: file.agents.map(({ instructions, ...agent }) => ({
      ...agent,
      ...splitInstructions(instructions),
    })),
  };
}

export class AgentError extends Error {
  constructor(
    readonly code: 'not-found' | 'too-many' | 'name-taken' | 'last' | 'bad-order' | 'bad-picture',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The tones a Conch from before agents knew. The default agent's tone is
 * written back to `settings.json` as the nearest of these, so that Conch can
 * still read the file.
 */
const OLD_TONE: Record<Tone, Persona['tone']> = {
  warm: 'warm',
  concise: 'concise',
  playful: 'playful',
  precise: 'precise',
  calm: 'warm',
  formal: 'precise',
  candid: 'concise',
};
/** What `persona.instructions` held before agents. */
const OLD_INSTRUCTIONS = 4000;

/** A name not yet taken: "Sage", else "Sage 2", "Sage 3"… (for agents brought from elsewhere). */
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = name.trim().slice(0, AGENT_LIMITS.name) || 'Agent';
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const next = `${base.slice(0, AGENT_LIMITS.name - suffix.length).trimEnd()}${suffix}`;
    if (!lower.has(next.toLowerCase())) return next;
  }
  return base;
}

export class AgentStore {
  #mutex = new Mutex();
  #file?: Promise<AgentsFile>;

  constructor(
    private readonly home: string,
    private readonly settings: SettingsStore,
    private readonly heal?: Heal,
    private readonly changed?: (list: AgentList) => void,
  ) {}

  get #dir() {
    return join(this.home, AGENTS_DIR);
  }
  get #path() {
    return join(this.#dir, AGENTS_FILE);
  }
  get #avatars() {
    return join(this.#dir, AVATARS_DIR);
  }

  /** The first agent, made from the personality chosen at setup. */
  async #first(): Promise<StoredAgent> {
    const { persona } = await this.settings.get();
    const now = Date.now();
    return {
      id: FIRST_AGENT_ID,
      name: persona.name,
      role: '',
      avatar: SHELL,
      persona: { tone: persona.tone, personality: '' },
      instructions: persona.instructions.trim().slice(0, AGENT_LIMITS.instructions),
      order: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  #load(): Promise<AgentsFile> {
    this.#file ??= this.#mutex
      .run(async () => {
        let damaged = false;
        const read = await readStore(this.#path, AgentsFile, {
          fallback: () => ({ version: 1 as const, agents: [] }),
          onRepair: () => {
            damaged = true;
          },
        });
        const file = read.value;
        let fixed = read.state !== 'read';
        if (!file.agents.length) {
          file.agents = [await this.#first()];
          fixed = true;
          if (damaged || read.state === 'read')
            this.heal?.(
              'agents',
              'Remade your assistant from your settings. A copy of your agents is kept.',
            );
        } else if (damaged)
          this.heal?.('agents', 'Set aside a damaged part of your agents. A copy is kept.');
        if (!file.agents.some((a) => a.id === file.defaultId)) {
          file.defaultId = sorted(file.agents)[0]?.id;
          fixed = true;
        }
        if (fixed) await writeJson(this.#path, toDisk(file));
        return file;
      })
      .catch((error: unknown) => {
        // Unreadable for a moment (a virus scan on Windows): try again next time.
        this.#file = undefined;
        throw error;
      });
    return this.#file;
  }

  #toAgent(file: AgentsFile, a: StoredAgent): Agent {
    return {
      ...a,
      avatar:
        a.avatar.kind === 'image'
          ? { ...a.avatar, url: agentImageUrl(a.id, a.avatar.id) }
          : a.avatar,
      isDefault: a.id === file.defaultId,
    };
  }

  #list(file: AgentsFile): AgentList {
    const agents = sorted(file.agents).map((a) => this.#toAgent(file, a));
    return { agents, defaultId: file.defaultId ?? (agents[0]?.id as AgentId) };
  }

  async list(): Promise<AgentList> {
    return this.#list(await this.#load());
  }

  async get(id: string): Promise<Agent | undefined> {
    const file = await this.#load();
    const found = file.agents.find((a) => a.id === id);
    return found && this.#toAgent(file, found);
  }

  /** The agent new chats start with. */
  async default(): Promise<Agent> {
    const list = await this.list();
    return list.agents.find((a) => a.id === list.defaultId) ?? (list.agents[0] as Agent);
  }

  /** The agent a chat is with: its own, the first (a chat from before agents), else the default. */
  async forChat(chat: { agentId?: string } | undefined): Promise<Agent> {
    const list = await this.list();
    const id = chatAgentId(chat as { agentId?: AgentId } | undefined, list);
    return list.agents.find((a) => a.id === id) ?? (list.agents[0] as Agent);
  }

  /** The default agent's personality, as Settings knew it before agents (`AppState.persona`). */
  async persona(): Promise<Persona> {
    const agent = await this.default();
    return { name: agent.name, tone: agent.persona.tone, instructions: agent.instructions };
  }

  async create(body: CreateAgentBody, extra?: { imported?: AgentImported }): Promise<Agent> {
    const input = CreateAgentBody.parse(body);
    return this.#write((file) => {
      if (file.agents.length >= AGENT_LIMITS.count)
        throw new AgentError('too-many', `Conch keeps at most ${AGENT_LIMITS.count} agents.`);
      nameFree(file, input.name);
      const now = Date.now();
      const agent: StoredAgent = {
        id: newId('ag') as AgentId,
        name: input.name,
        role: input.role,
        avatar: input.avatar,
        persona: input.persona,
        instructions: input.instructions,
        ...(input.defaults && { defaults: input.defaults }),
        // A new agent goes last, where you'd look for it.
        order: Math.max(0, ...file.agents.map((a) => a.order)) + 1,
        ...(extra?.imported && { imported: extra.imported }),
        createdAt: now,
        updatedAt: now,
      };
      file.agents.push(agent);
      if (input.isDefault) file.defaultId = agent.id;
      return this.#toAgent(file, agent);
    });
  }

  async update(id: string, change: UpdateAgentBody): Promise<Agent> {
    const body = UpdateAgentBody.parse(change);
    let dropped: StoredAvatar | undefined;
    return this.#write((file) => {
      const agent = find(file, id);
      if (body.name !== undefined && body.name.toLowerCase() !== agent.name.toLowerCase())
        nameFree(file, body.name);
      if (body.avatar && agent.avatar.kind === 'image') dropped = agent.avatar;
      const { defaults, persona, ...rest } = body;
      Object.assign(agent, stripUndefined(rest), {
        ...(persona && { persona: { ...agent.persona, ...stripUndefined(persona) } }),
        updatedAt: Date.now(),
      });
      if (defaults === null) delete agent.defaults;
      else if (defaults) agent.defaults = defaults;
      return this.#toAgent(file, agent);
    }).then(async (agent) => {
      if (dropped?.kind === 'image') await this.#removeImage(dropped.id, dropped.type);
      return agent;
    });
  }

  /**
   * An agent goes. Its chats carry on with the default agent; their logs keep
   * its name. The last agent can't go: Conch always has someone to answer.
   */
  remove(id: string): Promise<void> {
    let gone: StoredAgent | undefined;
    return this.#write((file) => {
      gone = find(file, id);
      if (file.agents.length <= 1)
        throw new AgentError('last', 'Conch needs one agent at least. Make another first.');
      file.agents = file.agents.filter((a) => a.id !== id);
      if (file.defaultId === id) file.defaultId = sorted(file.agents)[0]?.id;
    }).then(async () => {
      if (gone?.avatar.kind === 'image') await this.#removeImage(gone.avatar.id, gone.avatar.type);
    });
  }

  /** Every agent's id, in the new order. */
  reorder(ids: readonly string[]): Promise<AgentList> {
    return this.#write((file) => {
      const all = new Set(file.agents.map((a) => a.id));
      if (
        ids.length !== all.size ||
        new Set(ids).size !== ids.length ||
        !ids.every((i) => all.has(i))
      )
        throw new AgentError('bad-order', 'The agents changed meanwhile. Try again.');
      ids.forEach((id, i) => {
        const agent = find(file, id);
        agent.order = i;
      });
      return this.#list(file);
    });
  }

  setDefault(id: string): Promise<AgentList> {
    return this.#write((file) => {
      find(file, id);
      file.defaultId = id as AgentId;
      return this.#list(file);
    });
  }

  /**
   * Setup and the older Settings change the default agent through `persona`
   * (`PATCH /api/settings`, Come home): its name, tone and instructions.
   */
  adoptPersona(patch: Partial<Persona>): Promise<Agent> {
    return this.#write((file) => {
      const agent = find(file, file.defaultId ?? '');
      if (patch.name !== undefined && patch.name.toLowerCase() !== agent.name.toLowerCase())
        nameFree(file, patch.name);
      if (patch.name !== undefined) agent.name = patch.name.trim();
      if (patch.tone !== undefined) agent.persona = { ...agent.persona, tone: patch.tone };
      if (patch.instructions !== undefined)
        agent.instructions = patch.instructions.trim().slice(0, AGENT_LIMITS.instructions);
      agent.updatedAt = Date.now();
      return this.#toAgent(file, agent);
    });
  }

  /** A picture of your own (base64), read from its bytes and kept without its metadata. */
  async setImage(id: string, base64: string): Promise<Agent> {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
      throw new AgentError('bad-picture', 'That picture couldn’t be read. Choose another.');
    const clean = cleanPicture(Buffer.from(base64, 'base64'));
    if (!clean.ok) throw new AgentError('bad-picture', clean.problem);
    // Known before it's kept, so a picture is never written for an agent that isn't there.
    if (!(await this.get(id)))
      throw new AgentError('not-found', 'That agent isn’t there any more.');
    const imageId = newId('im') as AgentImageId;
    await mkdir(this.#avatars, { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.#imagePath(imageId, clean.type), clean.bytes, 0o600);
    let before: StoredAvatar | undefined;
    try {
      const agent = await this.#write((file) => {
        const agent = find(file, id);
        before = agent.avatar;
        agent.avatar = { kind: 'image', id: imageId, type: clean.type };
        agent.updatedAt = Date.now();
        return this.#toAgent(file, agent);
      });
      if (before?.kind === 'image') await this.#removeImage(before.id, before.type);
      return agent;
    } catch (error) {
      await this.#removeImage(imageId, clean.type);
      throw error;
    }
  }

  /**
   * One agent's picture, read back for showing: a plain file (never a link),
   * the one its agent has now, and still the kind it was kept as.
   */
  async image(
    agentId: string,
    imageId: string,
  ): Promise<{ bytes: Buffer; type: AgentImageType } | undefined> {
    const agent = (await this.#load()).agents.find((a) => a.id === agentId);
    if (agent?.avatar.kind !== 'image' || agent.avatar.id !== imageId) return undefined;
    const { type } = agent.avatar;
    const path = this.#imagePath(agent.avatar.id, type);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      () => undefined,
    );
    if (!handle) return undefined;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > AGENT_LIMITS.avatarBytes) return undefined;
      const bytes = Buffer.alloc(info.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const own = bytes.subarray(0, bytesRead);
      return pictureType(own) === type ? { bytes: own, type } : undefined;
    } finally {
      await handle.close();
    }
  }

  /**
   * Repair everything's look at the agents (`doctor.ts`): pictures that are
   * missing (the agent goes back to a preset) and pictures nobody has (let go).
   */
  async check(repair: boolean): Promise<{ missing: string[]; strays: string[] }> {
    const file = await this.#load();
    const missing: string[] = [];
    for (const agent of file.agents) {
      if (agent.avatar.kind !== 'image') continue;
      const info = await lstat(this.#imagePath(agent.avatar.id, agent.avatar.type)).catch(
        () => undefined,
      );
      if (!info?.isFile()) missing.push(agent.id);
    }
    const kept = new Set(
      file.agents.flatMap((a) =>
        a.avatar.kind === 'image' ? [imageName(a.avatar.id, a.avatar.type)] : [],
      ),
    );
    const strays = (await readdir(this.#avatars).catch(() => [] as string[])).filter(
      (name) => !kept.has(name) && !name.endsWith('.tmp'),
    );
    if (repair) {
      if (missing.length)
        await this.#write((f) => {
          for (const agent of f.agents) if (missing.includes(agent.id)) agent.avatar = { ...SHELL };
        });
      for (const name of strays) await rm(safeJoin(this.#avatars, name), { force: true });
    }
    return { missing, strays };
  }

  #imagePath(id: AgentImageId, type: AgentImageType): string {
    return safeJoin(this.#avatars, imageName(id, type));
  }

  async #removeImage(id: AgentImageId, type: AgentImageType): Promise<void> {
    await rm(this.#imagePath(id, type), { force: true }).catch(() => undefined);
  }

  #write<T>(change: (file: AgentsFile) => T): Promise<T> {
    return this.#load().then(() =>
      this.#mutex.run(async () => {
        const current = await this.#load();
        const file: AgentsFile = {
          ...current,
          agents: current.agents.map((a) => structuredClone(a)),
        };
        const result = change(file);
        await writeJson(this.#path, toDisk(file));
        this.#file = Promise.resolve(file);
        await this.#mirror(file);
        this.changed?.(this.#list(file));
        return result;
      }),
    );
  }

  /** The default agent, written back to `settings.json` as a Conch from before agents reads it. */
  async #mirror(file: AgentsFile): Promise<void> {
    const agent = file.agents.find((a) => a.id === file.defaultId);
    if (!agent) return;
    const persona = {
      name: agent.name,
      tone: OLD_TONE[agent.persona.tone],
      instructions: agent.instructions.slice(0, OLD_INSTRUCTIONS),
    };
    const { persona: now } = await this.settings.get();
    if (
      now.name === persona.name &&
      now.tone === persona.tone &&
      now.instructions === persona.instructions
    )
      return;
    await this.settings.update({ persona }).catch(() => undefined);
  }
}

const imageName = (id: AgentImageId, type: AgentImageType) =>
  `${id}.${type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length)}`;

function sorted(agents: readonly StoredAgent[]): StoredAgent[] {
  return [...agents].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

function find(file: AgentsFile, id: string): StoredAgent {
  const agent = file.agents.find((a) => a.id === id);
  if (!agent) throw new AgentError('not-found', 'That agent isn’t there any more.');
  return agent;
}

function nameFree(file: AgentsFile, name: string): void {
  const lower = name.trim().toLowerCase();
  if (file.agents.some((a) => a.name.toLowerCase() === lower))
    throw new AgentError('name-taken', `There’s already an agent called “${name.trim()}”.`);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
