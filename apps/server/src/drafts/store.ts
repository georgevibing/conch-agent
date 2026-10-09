import { join } from 'node:path';

import {
  type Attachment,
  type ChatDraft,
  DRAFT_LIMITS,
  DraftKey,
  type DraftList,
  type DraftReply,
  draftIsEmpty,
  Id,
  NEW_CHAT_DRAFT,
  PutDraftBody,
  TurnOptions,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

/** Lenient on purpose: a draft with an odd field keeps its words. */
const StoredDraft = z.object({
  text: z.string().max(DRAFT_LIMITS.maxText).catch(''),
  attachments: z
    .array(z.unknown())
    .catch([])
    .transform((ids) => ids.flatMap((id) => (Id.safeParse(id).success ? [id as string] : []))),
  options: TurnOptions.optional().catch(undefined),
  updatedAt: z.number().catch(0),
});
type StoredDraft = z.infer<typeof StoredDraft>;

const DraftsFile = z.object({
  drafts: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((all) => {
      const kept = new Map<string, StoredDraft>();
      for (const [key, raw] of Object.entries(all)) {
        const read = StoredDraft.safeParse(raw);
        if (DraftKey.safeParse(key).success && read.success) kept.set(key, read.data);
      }
      return kept;
    }),
});

export class DraftError extends Error {
  constructor(
    readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export interface DraftStoreDeps {
  /** An attachment by id, or undefined once it's gone (`AttachmentStore.get`). */
  attachment: (id: string) => Promise<Attachment | undefined>;
  /** Whether a conversation still exists: a deleted chat's draft can't come back. */
  exists: (conversationId: string) => Promise<boolean>;
  heal?: Heal;
}

/**
 * `~/.conch/conversations/drafts.json`: what you were writing in each chat,
 * and on the new chat page, before you sent it (ADR 0124). The words, the
 * ids of what's attached, and a new chat's choices.
 *
 * While a draft holds an attachment, the attachment sweep leaves it alone
 * (`held`); a draft untouched for 30 days is let go at the next sweep, and
 * its files go with it as any unsent upload does.
 */
export class DraftStore {
  readonly #mutex = new Mutex();
  #drafts?: Promise<Map<string, StoredDraft>>;

  constructor(
    private readonly dir: string,
    private readonly deps: DraftStoreDeps,
  ) {}

  get path() {
    return join(this.dir, 'drafts.json');
  }

  #load(): Promise<Map<string, StoredDraft>> {
    this.#drafts ??= readStore(this.path, DraftsFile, {
      onRepair: () =>
        this.deps.heal?.(
          'conversations',
          'Put right the list of messages you hadn’t sent. Your chats are all still there.',
        ),
    }).then(
      (read) => read.value.drafts,
      () => new Map(),
    );
    return this.#drafts;
  }

  /** A draft as the browser shows it: each attachment looked up, the lost ones named. */
  async #reply(stored: StoredDraft | undefined, lost: string[] = []): Promise<DraftReply> {
    if (!stored) return { draft: null, missing: lost };
    const attachments: Attachment[] = [];
    const missing = [...lost];
    for (const id of stored.attachments) {
      const found = await this.deps.attachment(id).catch(() => undefined);
      if (found) attachments.push(found);
      else missing.push(id);
    }
    const draft: ChatDraft = {
      text: stored.text,
      attachments,
      ...(stored.options && { options: stored.options }),
      updatedAt: stored.updatedAt,
    };
    return { draft, missing };
  }

  async get(key: string): Promise<DraftReply> {
    if (!DraftKey.safeParse(key).success) return { draft: null, missing: [] };
    return this.#reply((await this.#load()).get(key));
  }

  /** The chats with something unsent, newest first. */
  async list(): Promise<DraftList> {
    const all = await this.#load();
    return {
      drafts: [...all]
        .map(([key, d]) => ({ key, updatedAt: d.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }

  /**
   * Keep the draft as it is now. Empty words and nothing attached clears it.
   * An attachment that's no longer here isn't kept, and is named in `missing`.
   */
  async put(key: string, body: PutDraftBody, now = Date.now()): Promise<DraftReply> {
    if (!DraftKey.safeParse(key).success)
      throw new DraftError('not-found', 'That chat isn’t here any more.');
    if (key !== NEW_CHAT_DRAFT && !(await this.deps.exists(key)))
      throw new DraftError('not-found', 'That chat isn’t here any more.');
    const input = PutDraftBody.parse(body);
    const kept: string[] = [];
    const lost: string[] = [];
    for (const id of new Set(input.attachments)) {
      if (await this.deps.attachment(id).catch(() => undefined)) kept.push(id);
      else lost.push(id);
    }
    const draft: StoredDraft = {
      text: input.text,
      attachments: kept,
      // Only a new chat's choices are a draft's: a chat keeps its own.
      ...(key === NEW_CHAT_DRAFT && input.options && { options: input.options }),
      updatedAt: now,
    };
    const empty = draftIsEmpty(draft);
    await this.#write((all) => {
      if (empty) all.delete(key);
      else all.set(key, draft);
    });
    return empty ? { draft: null, missing: lost } : this.#reply(draft, lost);
  }

  /** A chat went (or its draft was cleared): forget it. Returns the attachment ids it held. */
  async remove(key: string): Promise<string[]> {
    let held: string[] = [];
    await this.#write((all) => {
      held = all.get(key)?.attachments ?? [];
      all.delete(key);
    });
    // Another draft may still hold one of them (a message moved between chats).
    const still = await this.held();
    return held.filter((id) => !still.has(id));
  }

  /**
   * The attachment ids drafts still hold, for the attachment sweep. A draft
   * untouched for 30 days is let go first, so its files are swept like any
   * upload that was never sent.
   */
  async held(now = Date.now()): Promise<Set<string>> {
    const all = await this.#load();
    const stale = [...all]
      .filter(([, d]) => now - d.updatedAt > DRAFT_LIMITS.maxAgeMs)
      .map(([key]) => key);
    if (stale.length)
      await this.#write((drafts) => {
        for (const key of stale) drafts.delete(key);
      });
    const ids = new Set<string>();
    for (const draft of (await this.#load()).values())
      for (const id of draft.attachments) ids.add(id);
    return ids;
  }

  #write(change: (drafts: Map<string, StoredDraft>) => void): Promise<void> {
    return this.#mutex.run(async () => {
      const drafts = new Map(await this.#load());
      change(drafts);
      this.#drafts = Promise.resolve(drafts);
      await writeJson(this.path, { drafts: Object.fromEntries(drafts) });
    });
  }
}
