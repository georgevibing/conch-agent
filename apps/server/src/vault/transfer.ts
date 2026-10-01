/**
 * Moving in (ADR 0025 § Moving in): copying items from a password manager
 * Conch reads into Conch's own vault, and keeping the copies up to date.
 *
 * - Values come through the manager's own program, one item at a time, the
 *   way a fill does (stdin or its environment variable, never argv), and go
 *   straight into the encrypted vault. Nothing is written in between; no
 *   export file ever exists.
 * - A preview first: how many, which look like items already here, which
 *   were copied before.
 * - Sync is one way, from the manager into Conch. An item edited in Conch is
 *   left alone from then on (`origin.detached`), so a sync never overwrites
 *   what you changed. An item gone from the manager goes to Recently deleted
 *   (30 days), and only when the manager's list came back whole.
 */
import { createHash } from 'node:crypto';

import {
  isConcealed,
  siteOf,
  VAULT_LIMITS,
  type VaultPasskey,
  type VaultSourceId,
  type VaultTransferJob,
  type VaultTransferPreview,
} from '@conch/protocol';

import { newId } from '../lib/ids';
import { fingerprint } from './crypto';
import { toPasskey } from './passkeys';
import type { ExternalItem, FullItem, PasswordSource } from './sources';
import type { ItemRecord } from './store';
import { isValidTotp } from './totp';

export interface SyncState {
  enabled: boolean;
  at?: number;
  problem?: string;
}

/** What `Transfers` needs from the vault. */
export interface TransferHost {
  /** Conch's items (the vault must be open). */
  records(): Promise<ItemRecord[]>;
  /** Save under the vault's lock, re-reading anything that changed meanwhile. */
  save(records: ItemRecord[]): Promise<void>;
  vaultKey(): Promise<Buffer>;
  changed(): void;
  sync(): Promise<Partial<Record<VaultSourceId, SyncState>>>;
  saveSync(id: VaultSourceId, state: SyncState): Promise<void>;
}

const KEEP_JOBS = 10;
const SAVE_EVERY = 25;

/** The same login: site, account and password. */
function sameKey(site: string, user: string, pass: string): string {
  return createHash('sha256').update(`${site}\0${user}\0${pass}`).digest('base64url');
}

/** The same account on the same site, before passwords are known (the preview). */
function looseKey(site: string, user: string): string {
  return createHash('sha256').update(`${site}\0${user}`).digest('base64url');
}

function siteOfItem(urls: string[], title: string): string {
  return siteOf(urls[0] ?? '') ?? title.toLowerCase();
}

function recordKeys(r: ItemRecord) {
  const user = r.fields.find((f) => f.role === 'username')?.value ?? '';
  const pass = r.fields.find((f) => f.role === 'password')?.value ?? '';
  const site = siteOfItem(r.urls, r.title);
  return { exact: sameKey(site, user, pass), loose: looseKey(site, user) };
}

export class Transfers {
  #jobs = new Map<string, VaultTransferJob & { abort: AbortController }>();
  #finished = new Map<string, Promise<void>>();
  #running = new Set<VaultSourceId>();

  constructor(private readonly host: TransferHost) {}

  /** Every value of one item, from the manager's own program. */
  async full(source: PasswordSource, ref: string, signal?: AbortSignal): Promise<FullItem> {
    if (source.full) return source.full(ref, signal);
    const { fields, notes } = await source.fields(ref, signal);
    const out: FullItem['fields'] = [];
    for (const f of fields) {
      if (f.value !== undefined) {
        if (f.value) out.push({ ...f, value: f.value });
        continue;
      }
      const value = await source.value(ref, f.id, signal).catch((error: Error) => {
        // A code's setup some managers don't hand out: the rest of the item still comes.
        if (f.kind === 'totp') return '';
        throw error;
      });
      if (value) out.push({ ...f, value });
    }
    return { fields: out, notes };
  }

  /** What a copy would bring in, without reading a single password. */
  async preview(source: PasswordSource, ids?: string[]): Promise<VaultTransferPreview> {
    const items = this.#chosen(await source.list({ force: true }), ids);
    const records = (await this.host.records()).filter((r) => !r.deletedAt);
    const loose = new Set(records.filter((r) => !r.origin).map((r) => recordKeys(r).loose));
    const copied = new Set(
      records.filter((r) => r.origin?.source === source.id).map((r) => r.origin?.ref),
    );
    let duplicates = 0;
    let copiedBefore = 0;
    for (const item of items) {
      if (copied.has(item.ref)) copiedBefore++;
      else if (loose.has(looseKey(siteOfItem(item.urls, item.title), item.subtitle))) duplicates++;
    }
    return {
      source: source.id,
      sourceName: source.name,
      found: items.length,
      duplicates,
      copiedBefore,
      sample: items
        .filter((i) => !copied.has(i.ref))
        .slice(0, 5)
        .map((i) => ({ title: i.title, subtitle: i.subtitle, type: i.type })),
    };
  }

  #chosen(items: ExternalItem[], ids?: string[]): ExternalItem[] {
    if (!ids) return items;
    const wanted = new Set(ids);
    return items.filter((i) => wanted.has(i.ref));
  }

  /** Start copying; the job is followed with `job(id)`. One copy per manager at a time. */
  start(
    source: PasswordSource,
    options: { ids?: string[]; skipDuplicates: boolean; removeGone?: boolean },
  ): VaultTransferJob {
    if (this.#running.has(source.id)) {
      const running = [...this.#jobs.values()].find(
        (j) => j.source === source.id && j.state === 'running',
      );
      if (running) return this.#public(running);
    }
    const job: VaultTransferJob & { abort: AbortController } = {
      jobId: newId('vjob'),
      source: source.id,
      sourceName: source.name,
      state: 'running',
      total: 0,
      done: 0,
      copied: 0,
      updated: 0,
      skipped: 0,
      failed: [],
      startedAt: Date.now(),
      abort: new AbortController(),
    };
    this.#jobs.set(job.jobId, job);
    for (const id of [...this.#jobs.keys()].slice(0, -KEEP_JOBS)) this.#jobs.delete(id);
    this.#running.add(source.id);
    const finished = this.#run(source, job, options)
      .catch((error: Error) => {
        job.state = job.abort.signal.aborted ? 'cancelled' : 'failed';
        job.message = error.message;
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.#running.delete(source.id);
        this.host.changed();
      });
    this.#finished.set(job.jobId, finished);
    for (const id of [...this.#finished.keys()].slice(0, -KEEP_JOBS)) this.#finished.delete(id);
    return this.#public(job);
  }

  /** Resolves once the copy ended, however it ended. */
  async finished(jobId: string): Promise<VaultTransferJob | undefined> {
    await this.#finished.get(jobId);
    return this.job(jobId);
  }

  job(jobId: string): VaultTransferJob | undefined {
    const job = this.#jobs.get(jobId);
    return job && this.#public(job);
  }

  /** The latest copy from a manager, for the Sources dialog. */
  latest(source: VaultSourceId): VaultTransferJob | undefined {
    const jobs = [...this.#jobs.values()].filter((j) => j.source === source);
    const job = jobs.at(-1);
    return job && this.#public(job);
  }

  cancel(jobId: string): void {
    this.#jobs.get(jobId)?.abort.abort();
  }

  isRunning(source: VaultSourceId): boolean {
    return this.#running.has(source);
  }

  #public(job: VaultTransferJob & { abort: AbortController }): VaultTransferJob {
    const { abort: _, ...rest } = job;
    return { ...rest, failed: [...rest.failed] };
  }

  async #run(
    source: PasswordSource,
    job: VaultTransferJob & { abort: AbortController },
    options: { ids?: string[]; skipDuplicates: boolean; removeGone?: boolean },
  ): Promise<void> {
    const signal = job.abort.signal;
    const listed = await source.list({ force: true, signal });
    const items = this.#chosen(listed, options.ids);
    job.total = items.length;
    const vk = await this.host.vaultKey();
    const records = (await this.host.records()).filter((r) => !r.deletedAt);
    if (records.length + items.length > VAULT_LIMITS.maxItems)
      throw new Error(
        'That’s more than Passwords can hold. Empty Recently deleted, or copy fewer.',
      );
    const byRef = new Map(
      records.filter((r) => r.origin?.source === source.id).map((r) => [r.origin?.ref, r]),
    );
    const exact = new Set(records.filter((r) => !r.origin).map((r) => recordKeys(r).exact));
    let pending: ItemRecord[] = [];
    const flush = async () => {
      if (!pending.length) return;
      await this.host.save(pending);
      pending = [];
      this.host.changed();
    };
    for (const item of items) {
      if (signal.aborted) break;
      const before = byRef.get(item.ref);
      // Nothing changed since the last copy (by the manager's own date): no need to read it.
      if (before?.origin && item.updatedAt && item.updatedAt <= before.origin.syncedAt) {
        job.done++;
        job.skipped++;
        continue;
      }
      if (before?.origin?.detached) {
        job.done++;
        job.skipped++;
        continue;
      }
      let full: FullItem;
      try {
        full = await this.full(source, item.ref, signal);
      } catch (error) {
        if (signal.aborted) break;
        if (job.failed.length < 50)
          job.failed.push({ title: item.title, message: (error as Error).message.slice(0, 200) });
        job.done++;
        continue;
      }
      const next = this.#record(source.id, item, full, vk, before);
      if (before) {
        if (before.origin?.fp === next.origin?.fp) job.skipped++;
        else {
          pending.push(next);
          job.updated++;
        }
      } else {
        const { exact: key } = recordKeys(next);
        if (options.skipDuplicates && exact.has(key)) job.skipped++;
        else {
          exact.add(key);
          pending.push(next);
          job.copied++;
        }
      }
      job.done++;
      if (pending.length >= SAVE_EVERY) await flush();
    }
    await flush();
    if (signal.aborted) {
      job.state = 'cancelled';
      return;
    }
    // Gone from the manager: to Recently deleted, only when its whole list came back.
    if (options.removeGone && listed.length > 0) {
      const present = new Set(listed.map((i) => i.ref));
      const gone = [...byRef.values()].filter(
        (r) => r.origin && !r.origin.detached && !present.has(r.origin.ref),
      );
      if (gone.length && gone.length <= Math.max(5, listed.length)) {
        const now = Date.now();
        await this.host.save(gone.map((r) => ({ ...r, deletedAt: now })));
      }
    }
    job.state = 'done';
  }

  /** The item as Conch keeps it. A copy made before keeps its id, tags, uses and settings. */
  #record(
    source: VaultSourceId,
    item: ExternalItem,
    full: FullItem,
    vk: Buffer,
    before?: ItemRecord,
  ): ItemRecord {
    const now = Date.now();
    const fields = full.fields
      .filter((f) => f.value && (f.kind !== 'totp' || isValidTotp(f.value)))
      .slice(0, VAULT_LIMITS.maxFields)
      .map((f) => ({
        id: before?.fields.find((b) => b.label === f.label && b.kind === f.kind)?.id ?? newId('f'),
        label: f.label.slice(0, VAULT_LIMITS.maxLabel) || 'Field',
        kind: f.kind,
        ...(f.role && { role: f.role }),
        value: f.value.slice(0, VAULT_LIMITS.maxValue),
      }));
    const passkeys: VaultPasskey[] = (full.passkeys ?? [])
      .map((p) => {
        const kept = before?.passkeys.find((b) => b.credentialId === p.credentialId);
        const made = toPasskey(p, kept?.createdAt ?? now);
        // The higher counter wins: a sign-in through Conch may have moved it on.
        return made && kept
          ? { ...made, id: kept.id, signCount: Math.max(made.signCount, kept.signCount) }
          : made;
      })
      .filter((p): p is VaultPasskey => Boolean(p))
      .slice(0, 20);
    const urls = [...new Set(item.urls.filter((u) => siteOf(u)).map((u) => u.trim()))].slice(
      0,
      VAULT_LIMITS.maxUrls,
    );
    const content = {
      type: item.type,
      title: item.title,
      fields: fields.map((f) => [f.label, f.kind, f.role ?? '', f.value]),
      urls,
      notes: full.notes,
      passkeys: passkeys.map((p) => p.credentialId),
    };
    const fp = fingerprint(vk, JSON.stringify(content));
    const history = [...(before?.history ?? [])];
    for (const old of before?.fields ?? []) {
      if (!isConcealed(old.kind) || old.kind === 'totp' || !old.value) continue;
      const now2 = fields.find((f) => f.id === old.id);
      if (now2 && now2.value !== old.value)
        history.unshift({ fieldId: old.id, value: old.value, changedAt: now });
    }
    return {
      id: before?.id ?? newId('pw'),
      type: item.type,
      title: item.title.slice(0, VAULT_LIMITS.maxTitle) || 'Untitled',
      fields,
      urls,
      tags: before?.tags ?? item.tags.map((t) => t.slice(0, VAULT_LIMITS.maxTag)).slice(0, 20),
      notes: full.notes.slice(0, VAULT_LIMITS.maxNotes),
      favorite: before?.favorite ?? item.favorite,
      agentAccess: before?.agentAccess ?? 'ask',
      agentRead: before?.agentRead ?? 'ask',
      allowedSites: before?.allowedSites ?? [],
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
      ...(before?.usedAt && { usedAt: before.usedAt }),
      history: history.slice(0, VAULT_LIMITS.maxHistory),
      uses: before?.uses ?? [],
      breach: before?.breach ?? {},
      passkeys,
      origin: { source, ref: item.ref, fp, syncedAt: now, detached: false },
    };
  }
}
