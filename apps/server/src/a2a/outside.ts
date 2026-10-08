/**
 * Outside agents (ADR 0112): agents elsewhere that speak A2A, added by
 * pasting their address (and their key, if they have one) in Settings →
 * Agents. Kept in `~/.conch/agents/outside.json` (backed up with your agents,
 * protected from the assistant's own file tools); their keys in the sealed
 * `~/.conch/a2a.secrets.json` (`secret` in backups), never in the list, a log
 * or a reply.
 *
 * Only a person adds or removes one, behind sign-in. The assistant has no
 * tool for it, and reaches one only when you mention it in a message.
 */
import { join } from 'node:path';

import { OUTSIDE_LIMITS, OutsideAgent, type OutsidePreview } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { readStore } from '../lib/recover';
import { A2aClient, A2aError, KeyNeeded, previewOf, readPaste, type Peer } from './client';

const ListFile = z.object({
  version: z.literal(1).default(1),
  agents: z.array(OutsideAgent).max(OUTSIDE_LIMITS.count).default([]),
});
type ListFile = z.infer<typeof ListFile>;

const KeysFile = z.object({ keys: z.record(z.string(), z.string().max(4000)).default({}) });

export class OutsideError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'needs-key' | 'full',
    message: string,
  ) {
    super(message);
  }
}

export interface OutsideDeps {
  home: string;
  client?: A2aClient;
  /** A quiet note under Health → Fixed on its own (working agreement 11). */
  heal?: (message: string) => void;
}

export class OutsideAgents {
  readonly #mutex = new Mutex();
  readonly #client: A2aClient;
  #list?: Promise<ListFile>;

  constructor(private readonly deps: OutsideDeps) {
    this.#client = deps.client ?? new A2aClient();
  }

  get #listPath() {
    return join(this.deps.home, 'agents', 'outside.json');
  }

  get #keysPath() {
    return join(this.deps.home, 'a2a.secrets.json');
  }

  #load(): Promise<ListFile> {
    this.#list ??= readStore(this.#listPath, ListFile, {
      onRepair: () => this.deps.heal?.('Kept what could be read of your outside agents'),
    }).then(
      (read) => read.value,
      (error: unknown) => {
        this.#list = undefined;
        throw error;
      },
    );
    return this.#list;
  }

  async #keys(): Promise<Record<string, string>> {
    return (await readStore(this.#keysPath, KeysFile)).value.keys;
  }

  /** Forget what was read, so a change from elsewhere (a restore) is seen. */
  invalidate(): void {
    this.#list = undefined;
  }

  async list(): Promise<OutsideAgent[]> {
    return (await this.#load()).agents;
  }

  async get(id: string): Promise<OutsideAgent | undefined> {
    return (await this.list()).find((a) => a.id === id);
  }

  /** What a pasted address is, before anything is kept: read from its card, now. */
  async preview(paste: string): Promise<OutsidePreview> {
    const { url, key } = readPaste(paste);
    if (!url)
      throw new OutsideError('invalid', 'Paste the agent’s address: it starts with https://.');
    try {
      const read = await this.#client.card(url, key);
      const known = (await this.list()).find((a) => a.card === read.at.href);
      return previewOf(read.card, {
        reach: read.reach,
        keyed: Boolean(key),
        needsKey: read.card.wantsKey && !key,
        ...(known && { known: known.id }),
      });
    } catch (error) {
      if (error instanceof KeyNeeded) throw new OutsideError('needs-key', error.message);
      if (error instanceof A2aError) throw new OutsideError('invalid', error.message);
      throw error;
    }
  }

  /**
   * Add what was pasted. The card is read again here, never taken from the
   * page: what's kept is what the agent says now. Adding it again (a new key)
   * replaces the one that was there.
   */
  async add(paste: string): Promise<OutsideAgent> {
    const { url, key } = readPaste(paste);
    if (!url)
      throw new OutsideError('invalid', 'Paste the agent’s address: it starts with https://.');
    let read: Awaited<ReturnType<A2aClient['card']>>;
    try {
      read = await this.#client.card(url, key);
    } catch (error) {
      if (error instanceof KeyNeeded) throw new OutsideError('needs-key', error.message);
      if (error instanceof A2aError) throw new OutsideError('invalid', error.message);
      throw error;
    }
    return this.#mutex.run(async () => {
      const file = await this.#load();
      const before = file.agents.find((a) => a.card === read.at.href);
      if (!before && file.agents.length >= OUTSIDE_LIMITS.count)
        throw new OutsideError('full', `Conch keeps up to ${OUTSIDE_LIMITS.count} outside agents.`);
      const agent: OutsideAgent = OutsideAgent.parse({
        id: before?.id ?? newId('oa'),
        name: read.card.name,
        description: read.card.description,
        card: read.at.href,
        endpoint: read.card.endpoint.href,
        protocol: read.card.protocol,
        skills: read.card.skills,
        ...(read.card.by && { by: read.card.by }),
        keyed: Boolean(key),
        private: read.reach === 'private',
        addedAt: before?.addedAt ?? Date.now(),
      });
      const others = Object.entries(await this.#keys()).filter(([id]) => id !== agent.id);
      await writeJson(this.#keysPath, {
        keys: Object.fromEntries(key ? [...others, [agent.id, key]] : others),
      });
      const next: ListFile = {
        ...file,
        agents: before
          ? file.agents.map((a) => (a.id === agent.id ? agent : a))
          : [...file.agents, agent],
      };
      await writeJson(this.#listPath, next);
      this.#list = Promise.resolve(next);
      return agent;
    });
  }

  /** Remove one: it's forgotten, and so is its key. */
  remove(id: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const file = await this.#load();
      if (!file.agents.some((a) => a.id === id)) return false;
      const next = { ...file, agents: file.agents.filter((a) => a.id !== id) };
      await writeJson(this.#listPath, next);
      this.#list = Promise.resolve(next);
      const keys = await this.#keys();
      if (id in keys)
        await writeJson(this.#keysPath, {
          keys: Object.fromEntries(Object.entries(keys).filter(([k]) => k !== id)),
        });
      return true;
    });
  }

  /**
   * Read its card again (Repair everything): a card that moved its address or
   * changed its name is followed, on the same host, and a problem that's
   * passed is cleared. False when it still can't be read.
   */
  async refresh(id: string): Promise<boolean> {
    const agent = await this.get(id);
    if (!agent) return false;
    const key = (await this.#keys())[agent.id];
    let read: Awaited<ReturnType<A2aClient['card']>>;
    try {
      read = await this.#client.card(new URL(agent.card), key);
    } catch (error) {
      await this.#mark(id, (error as Error).message.slice(0, 200)).catch(() => undefined);
      return false;
    }
    await this.#mutex.run(async () => {
      const file = await this.#load();
      const next = {
        ...file,
        agents: file.agents.map((a) =>
          a.id === id
            ? OutsideAgent.parse({
                ...a,
                name: read.card.name,
                description: read.card.description,
                endpoint: read.card.endpoint.href,
                protocol: read.card.protocol,
                skills: read.card.skills,
                problem: undefined,
              })
            : a,
        ),
      };
      await writeJson(this.#listPath, next);
      this.#list = Promise.resolve(next);
    });
    return true;
  }

  /** What the person's key is for, in Passwords: listed so you know it's here, never shown. */
  async keyed(): Promise<{ agent: OutsideAgent; hint: string }[]> {
    const keys = await this.#keys().catch(() => ({}) as Record<string, string>);
    return (await this.list())
      .filter((a) => keys[a.id])
      .map((agent) => ({ agent, hint: `…${(keys[agent.id] ?? '').slice(-4)}` }));
  }

  /**
   * Send it your words and wait for its answer (a round, ADR 0112). How it
   * went is kept on the agent (`lastUsedAt`, `problem`), so its row in
   * Settings → Agents says when something's wrong.
   */
  async ask(
    id: string,
    input: { text: string; contextId?: string; signal: AbortSignal },
  ): Promise<{ text: string; contextId?: string }> {
    const agent = await this.get(id);
    if (!agent) throw new A2aError('That outside agent isn’t in Conch any more.');
    const key = (await this.#keys())[agent.id];
    const peer: Peer = {
      name: agent.name,
      endpoint: agent.endpoint,
      protocol: agent.protocol,
      reach: agent.private ? 'private' : 'public',
      ...(key && { key }),
    };
    try {
      const answer = await this.#client.send(peer, input);
      await this.#mark(id, undefined);
      return answer;
    } catch (error) {
      if (!input.signal.aborted)
        await this.#mark(id, (error as Error).message.slice(0, 200)).catch(() => undefined);
      throw error;
    }
  }

  #mark(id: string, problem: string | undefined): Promise<void> {
    return this.#mutex.run(async () => {
      const file = await this.#load();
      const next = {
        ...file,
        agents: file.agents.map((a) =>
          a.id === id
            ? { ...a, lastUsedAt: Date.now(), ...(problem ? { problem } : { problem: undefined }) }
            : a,
        ),
      };
      await writeJson(this.#listPath, next);
      this.#list = Promise.resolve(next);
    });
  }
}
