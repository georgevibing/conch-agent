/**
 * Passwords (ADR 0025): Conch's own encrypted vault, and the password
 * managers it reads alongside, as one list.
 *
 * Values leave this class in exactly three ways, each recorded as a use:
 * `reveal` (a person asked to see or copy one), `fill` (the agent asked
 * Conch to type one into a page, on a site the item belongs to, after the
 * person said yes), and the export, which a person asks for in so many words.
 */
import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AnswerVaultRequestBody,
  type ImportFormat,
  type ImportPreview,
  isConcealed,
  passwordScore,
  sameAccountKey,
  SaveVaultItemBody,
  siteMatches,
  siteOf,
  VAULT_LIMITS,
  type VaultField,
  type VaultFieldView,
  type VaultItemDetail,
  type VaultItemSummary,
  type VaultList,
  type VaultProblem,
  type VaultSource,
  type VaultSourceId,
  type VaultStatus,
  type VaultItemType,
  type VaultRequest,
  type VaultCopyOutResult,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, readJson, writeJson } from '../lib/fs';
import { deviceSealer } from '../lib/sealed';
import { newId } from '../lib/ids';
import { Emitter } from '../lib/emitter';
import { fingerprint } from './crypto';
import { formatName, ImportError, parseImport, toCsv, type Imported } from './importers';
import { chooseKeystore, type Keystore } from './keystore';
import { type CdpCredential, cdpIdToVault, fromCdp, toCdp, toPasskey } from './passkeys';
import {
  BitwardenSource,
  DashlaneSource,
  type Exec,
  type ExternalItem,
  KeePassXcSource,
  KeeperSource,
  KeychainSource,
  OnePasswordSource,
  type OutgoingItem,
  type PasswordSource,
  ProtonPassSource,
  realExec,
  SourceError,
} from './sources';
import { type ItemRecord, VaultStore, WrongPassword } from './store';
import { type SyncState, Transfers } from './transfer';
import { isValidTotp, parseTotp, totpNow, TotpError } from './totp';

export class VaultError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'read-only' | 'unavailable' | 'refused',
    message: string,
  ) {
    super(message);
  }
}

const Settings = z.object({
  enabled: z.record(z.string(), z.boolean()).default({}),
  keepassxc: z
    .object({
      database: z.string().max(4096).optional(),
      /** A key file the database also needs, if it does. A path, not a secret. */
      keyFile: z.string().max(4096).optional(),
    })
    .default({}),
  breachCheckedAt: z.number().optional(),
  /** When items from other managers were last used here (shown, copied, filled, read), by id. */
  used: z.record(z.string(), z.number()).default({}),
  /** Managers whose items are copied into Conch's vault and kept up to date (§ Moving in). */
  sync: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean(),
        at: z.number().optional(),
        problem: z.string().max(300).optional(),
      }),
    )
    .default({}),
  /** Minutes without use before a locked vault closes again; 0 = only when Conch stops. */
  autoLockMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(30),
});
type Settings = z.infer<typeof Settings>;

const DAY = 24 * 60 * 60 * 1000;
/** How often copies from a manager are brought up to date while its sync is on. */
const SYNC_EVERY_MS = 30 * 60_000;

/** Item ids from each manager start with its prefix. */
/**
 * Managers that ask you something when read (1Password's approval, Touch ID,
 * the keychain's dialog): read and synced only while you look at Passwords.
 * Anything else that wants the list — the sidebar's count, Apps, ⌘K — gets
 * what was last read, so a prompt from another app only ever appears when you
 * opened Passwords yourself. It matters most where the approval doesn't last:
 * 1Password on Windows ties it to the process that asked, so it's asked again
 * after every restart of Conch, and after ten minutes without a read.
 */
const PROMPTS = new Set<VaultSourceId>(['1password', 'keychain']);

const PREFIXES: [string, Exclude<VaultSourceId, 'conch' | 'system'>][] = [
  ['op_', '1password'],
  ['bw_', 'bitwarden'],
  ['kp_', 'keepassxc'],
  ['pp_', 'protonpass'],
  ['dl_', 'dashlane'],
  ['kr_', 'keeper'],
  ['kc_', 'keychain'],
];
const HIBP = 'https://api.pwnedpasswords.com/range/';

export interface VaultDeps {
  home: string;
  /** `file` in tests and where no keychain should be touched. */
  keystore?: 'auto' | 'file';
  emit?: () => void;
  exec?: Exec;
  fetch?: typeof fetch;
  /** What uses an item ("OpenRouter key"), for the detail page. */
  usedBy?: (id: string) => Promise<string[]>;
  /** The keys Conch itself uses (providers, integrations, channels), shown read-only. */
  systemKeys?: () => Promise<SystemKey[]>;
  /** For tests: which operating system to act as (the macOS Keychain is Mac-only). */
  platform?: NodeJS.Platform;
}

/** A key Conch uses itself, kept where it's used and shown in Passwords (`system`). */
export interface SystemKey {
  /** `sys_…`, id-safe. */
  id: string;
  title: string;
  /** "OpenRouter", "GitHub integration". */
  usedBy: string;
  /** A hint that's safe to show: `…4f2c`, or the `op://` reference. */
  hint: string;
  savedAt?: number;
  /** Where to change it. */
  manage: { label: string; place: string; focus?: string };
  /** The value, for a person who asked to see it. */
  reveal(): Promise<string>;
}

/** Failed unlocks before Conch makes you wait, and the longest wait (NIST SP 800-63B-4 §3.2.2). */
const FREE_TRIES = 5;
const MAX_WAIT_MS = 15 * 60_000;

/** Where a password is going, for the agent's fill. */
export interface FillRequest {
  itemId: string;
  /** The page's hostname. */
  host: string;
  /** The field's role on the page. */
  want: 'password' | 'username' | 'totp' | 'cardNumber' | 'cvv' | 'expiry' | 'cardholder';
}

function lastFour(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '';
}

function insecureUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed.startsWith('http://')) return false;
  const host = siteOf(trimmed) ?? '';
  return !/^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(host) && !host.endsWith('.local');
}

function expired(field: VaultField, now: number): boolean {
  if (!field.value) return false;
  if (field.kind === 'monthYear') {
    const m = /^(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(field.value.trim());
    if (!m) return false;
    const year = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]);
    return new Date(year, Number(m[1]), 1).getTime() <= now;
  }
  if (field.kind === 'date' && (field.role === 'expiresOn' || field.role === 'expiry')) {
    const at = Date.parse(field.value);
    return Number.isFinite(at) && at < now;
  }
  return false;
}

export class VaultService {
  readonly store: VaultStore;
  readonly sources: PasswordSource[];
  readonly #settingsPath: string;
  readonly #mutex = new Mutex();
  #keystore?: Promise<Keystore>;
  #settings?: Settings;
  /** Every secret value this process has handled, for redaction. */
  readonly #known = new Set<string>();
  #reveals = new Map<string, number[]>();
  /** Fires when Passwords is unlocked, for anything waiting on it (a fill in a chat). */
  readonly unlocked = new Emitter<void>();
  #failures = 0;
  #waitUntil = 0;
  #lastUse = Date.now();
  #lockTimer?: NodeJS.Timeout;
  #requests = new Map<
    string,
    {
      resolve: (outcome: { itemId?: string; declined?: boolean }) => void;
      request: VaultRequest;
    }
  >();

  constructor(private readonly deps: VaultDeps) {
    const dir = join(deps.home, 'vault');
    this.#settingsPath = join(dir, 'sources.json');
    this.store = new VaultStore(dir, () => this.keystore());
    const exec = deps.exec ?? realExec;
    this.sources = [
      new OnePasswordSource(exec),
      new BitwardenSource(exec),
      new KeePassXcSource(
        async () => (await this.settings()).keepassxc.database,
        exec,
        async () => (await this.settings()).keepassxc.keyFile,
      ),
      new ProtonPassSource(exec),
      new DashlaneSource(exec),
      new KeeperSource(exec),
      new KeychainSource(exec, deps.platform ?? process.platform),
    ];
    this.transfers = new Transfers({
      records: () => this.#records(),
      save: (records) =>
        this.#mutex.run(async () => {
          await this.store.putMany(records);
        }),
      vaultKey: () => this.store.key(),
      changed: () => this.#changed(),
      sync: async () => (await this.settings()).sync,
      saveSync: async (id, state) =>
        this.#saveSettings({ sync: { ...(await this.settings()).sync, [id]: state } }),
    });
  }

  readonly transfers: Transfers;
  #syncTimer?: NodeJS.Timeout;
  /** What each manager in `PROMPTS` listed when last looked at: names only, in memory only. */
  #listed = new Map<VaultSourceId, ExternalItem[]>();

  #deviceKey?: Promise<Buffer>;

  /** This computer's device key, read once (a keychain read is a process start). */
  deviceKey(): Promise<Buffer> {
    this.#deviceKey ??= this.keystore()
      .then((k) => k.deviceKey())
      .catch((error: unknown) => {
        this.#deviceKey = undefined;
        throw error;
      });
    return this.#deviceKey;
  }

  keystore(): Promise<Keystore> {
    this.#keystore ??= chooseKeystore(
      join(this.deps.home, 'vault'),
      this.deps.home,
      this.deps.keystore ?? 'auto',
    );
    return this.#keystore;
  }

  async settings(): Promise<Settings> {
    this.#settings ??= Settings.parse(
      (await readJson<unknown>(this.#settingsPath).catch(() => undefined)) ?? {},
    );
    return this.#settings;
  }

  async #saveSettings(patch: Partial<Settings>) {
    const next = Settings.parse({ ...(await this.settings()), ...patch });
    this.#settings = next;
    await writeJson(this.#settingsPath, next);
  }

  #changed() {
    this.deps.emit?.();
  }

  /** Remember values for redaction (only ones long enough to be meaningful). */
  #remember(value: string, min = 6) {
    if (value.length >= min) this.#known.add(value);
  }

  /** Every secret value Conch knows of right now: never to appear in a chat or a log. */
  async secretValues(): Promise<string[]> {
    const { items } = await this.store
      .open()
      .catch(() => ({ items: new Map<string, ItemRecord>() }));
    for (const record of items.values())
      for (const field of record.fields) if (isConcealed(field.kind)) this.#remember(field.value);
    return [...this.#known];
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  async #records(): Promise<ItemRecord[]> {
    this.#lastUse = Date.now();
    const { items } = await this.store.open();
    // Recently deleted empties itself after 30 days.
    const cutoff = Date.now() - VAULT_LIMITS.trashDays * DAY;
    const stale = [...items.values()].filter((r) => r.deletedAt && r.deletedAt < cutoff);
    if (stale.length) await this.store.remove(stale.map((r) => r.id));
    return [...items.values()];
  }

  async #problems(records: ItemRecord[]): Promise<Map<string, VaultProblem[]>> {
    const vk = await this.store.key();
    const now = Date.now();
    const seen = new Map<string, number>();
    const prints = new Map<string, string[]>();
    for (const r of records) {
      if (r.deletedAt) continue;
      const fps: string[] = [];
      for (const f of r.fields) {
        if (f.role !== 'password' || !f.value) continue;
        const fp = fingerprint(vk, f.value);
        fps.push(fp);
        seen.set(fp, (seen.get(fp) ?? 0) + 1);
      }
      prints.set(r.id, fps);
    }
    const out = new Map<string, VaultProblem[]>();
    for (const r of records) {
      const problems = new Set<VaultProblem>();
      if (!r.deletedAt) {
        for (const f of r.fields) {
          if (f.role === 'password' && f.value) {
            if (passwordScore(f.value) < 2) problems.add('weak');
            const b = r.breach[f.id];
            if (b && b.count > 0 && b.fp === fingerprint(vk, f.value)) problems.add('compromised');
          }
          if (expired(f, now)) problems.add('expired');
        }
        if ((prints.get(r.id) ?? []).some((fp) => (seen.get(fp) ?? 0) > 1)) problems.add('reused');
        if (r.type === 'login' && r.urls.some(insecureUrl)) problems.add('insecure');
      }
      out.set(r.id, [...problems]);
    }
    return out;
  }

  #summary(r: ItemRecord, problems: VaultProblem[]): VaultItemSummary {
    const byRole = (role: string) => r.fields.find((f) => f.role === role)?.value ?? '';
    let subtitle = '';
    switch (r.type) {
      case 'login':
      case 'server':
      case 'database':
        subtitle = byRole('username') || byRole('host');
        break;
      case 'card':
        subtitle = lastFour(byRole('cardNumber'));
        break;
      case 'identity':
        subtitle =
          [byRole('firstName'), byRole('lastName')].filter(Boolean).join(' ') || byRole('email');
        break;
      case 'wifi':
        subtitle = byRole('networkName');
        break;
      case 'bank':
        subtitle = byRole('fullName') || lastFour(byRole('accountNumber'));
        break;
      case 'document':
      case 'license':
        subtitle = byRole('fullName');
        break;
      default:
        subtitle = siteOf(r.urls[0] ?? '') ?? '';
    }
    return {
      id: r.id,
      source: 'conch',
      type: r.type,
      title: r.title,
      subtitle,
      domains: [...new Set(r.urls.map((u) => siteOf(u)).filter((d): d is string => Boolean(d)))],
      tags: r.tags,
      favorite: r.favorite,
      totp: r.fields.some((f) => f.kind === 'totp' && f.value),
      passkey: r.passkeys.length > 0,
      problems,
      readOnly: false,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ...(r.usedAt && { usedAt: r.usedAt }),
      ...(r.deletedAt && { deletedAt: r.deletedAt }),
    };
  }

  /** An item from another manager was used here: remembered so "Recently used" means something. */
  async #useExternal(id: string) {
    const used = { ...(await this.settings()).used, [id]: Date.now() };
    // The most recent few thousand are plenty.
    const kept = Object.fromEntries(
      Object.entries(used)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2000),
    );
    await this.#saveSettings({ used: kept });
    this.#changed();
  }

  #external(source: PasswordSource, item: ExternalItem): VaultItemSummary {
    const usedAt = this.#settings?.used[item.ref];
    return {
      id: item.ref,
      source: source.id,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      domains: [...new Set(item.urls.map((u) => siteOf(u)).filter((d): d is string => Boolean(d)))],
      tags: item.tags,
      favorite: item.favorite,
      totp: item.totp,
      passkey: false,
      problems: [],
      readOnly: true,
      ...(item.container && { container: item.container }),
      ...(item.updatedAt && { updatedAt: item.updatedAt }),
      ...(usedAt && { usedAt }),
    };
  }

  async #enabled(id: VaultSourceId): Promise<boolean> {
    return (await this.settings()).enabled[id] ?? false;
  }

  /** Each source's state. Never prompts anybody: `state()` is a cheap check. */
  async sourceStatus(): Promise<VaultSource[]> {
    await this.#reopen().catch(() => undefined);
    const { items, damaged } = await this.store
      .open()
      .catch(() => ({ items: new Map(), damaged: [] }));
    const out: VaultSource[] = [
      {
        id: 'conch',
        name: 'Conch',
        state: 'ready',
        count: [...items.values()].filter((r: ItemRecord) => !r.deletedAt).length,
        writable: true,
        unlock: 'none',
        ...(damaged.length && {
          state: 'error',
          message: `${damaged.length} item${damaged.length === 1 ? '' : 's'} couldn’t be opened. They’re kept as they are; restoring a backup brings them back.`,
        }),
      },
    ];
    const sync = (await this.settings()).sync;
    const kept = await this.#keptPasswords();
    const copies = new Map<string, number>();
    for (const r of items.values() as Iterable<ItemRecord>)
      if (r.origin && !r.deletedAt)
        copies.set(r.origin.source, (copies.get(r.origin.source) ?? 0) + 1);
    for (const source of this.sources) {
      const enabled = await this.#enabled(source.id);
      const state = enabled
        ? await source
            .state()
            .catch((e: Error) => ({ state: 'error' as const, message: e.message }))
        : { state: 'off' as const };
      const s = sync[source.id];
      out.push({
        id: source.id,
        name: source.name,
        ...state,
        writable: false,
        ...(source.add && { accepts: true }),
        ...(source.add && source.places && { places: source.places() }),
        ...(source.need && { need: source.need }),
        unlock: source.unlock,
        ...(source.available === false && { available: false }),
        ...(kept[source.id] !== undefined && { keptUnlocked: true }),
        ...(state.state === 'locked' &&
          this.#reopenFailed.has(source.id) && { message: this.#reopenFailed.get(source.id) }),
        ...(source.id === 'keepassxc' &&
          (await this.settings()).keepassxc.database && {
            database: (await this.settings()).keepassxc.database,
          }),
        ...(source.id === 'keepassxc' &&
          (await this.settings()).keepassxc.keyFile && {
            keyFile: (await this.settings()).keepassxc.keyFile,
          }),
        ...((s || copies.get(source.id)) && {
          sync: {
            enabled: s?.enabled ?? false,
            ...(s?.at && { at: s.at }),
            copies: copies.get(source.id) ?? 0,
            ...(s?.problem && { problem: s.problem }),
          },
        }),
      });
    }
    return out;
  }

  async status(problemsBy?: Map<string, VaultProblem[]>): Promise<VaultStatus> {
    const keystore = await this.keystore();
    const locked = (await this.store.lockState()).locked;
    const records = locked ? [] : await this.#records();
    const problems =
      problemsBy ?? (locked ? new Map<string, VaultProblem[]>() : await this.#problems(records));
    const count = (p: VaultProblem) =>
      [...problems.values()].filter((list) => list.includes(p)).length;
    const settings = await this.settings();
    return {
      lock: { ...(await this.store.lockState()), autoLockMinutes: settings.autoLockMinutes },
      protection: await this.store.protection(),
      ...(keystore.kind === 'file' && keystore.note && { protectionNote: keystore.note }),
      sources: await this.sourceStatus(),
      health: {
        weak: count('weak'),
        reused: count('reused'),
        compromised: count('compromised'),
        expired: count('expired'),
        insecure: count('insecure'),
        ...(settings.breachCheckedAt && { breachCheckedAt: settings.breachCheckedAt }),
      },
      trash: records.filter((r) => r.deletedAt).length,
    };
  }

  /**
   * Everything in Passwords. `looking`: the person has Passwords open, so a
   * manager that asks them something (`PROMPTS`) may be read; without it such
   * a manager shows what it showed last time, and is asked nothing.
   */
  async list(options: { looking?: boolean } = {}): Promise<VaultList> {
    // Locked, Conch's own items stay hidden; other managers and Conch's keys still show.
    const locked = (await this.store.lockState()).locked;
    const records = locked ? [] : await this.#records();
    const problems = locked ? new Map<string, VaultProblem[]>() : await this.#problems(records);
    const items = records.map((r) => this.#summary(r, problems.get(r.id) ?? []));
    const status = await this.status(problems);
    await this.settings();
    for (const key of await this.#systemKeys()) items.push(this.#systemSummary(key));
    for (const source of this.sources) {
      const state = status.sources.find((s) => s.id === source.id);
      if (state?.state !== 'ready') continue;
      if (!options.looking && PROMPTS.has(source.id)) {
        // Not looking: what it showed last, if anything, and no question asked.
        const last = this.#listed.get(source.id);
        if (last) {
          items.push(...last.map((item) => this.#external(source, item)));
          state.count = last.length;
          if (source.add && source.places) state.places = source.places();
        }
        continue;
      }
      try {
        const external = await source.list();
        this.#listed.set(source.id, external);
        items.push(...external.map((item) => this.#external(source, item)));
        state.count = external.length;
        state.syncedAt = Date.now();
        // Where Copy to can put an item, from the list just read (the status was made before it).
        if (source.add && source.places) state.places = source.places();
      } catch (error) {
        this.#listed.delete(source.id);
        state.state = 'error';
        state.message = (error as Error).message;
      }
    }
    items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    // You're looking at Passwords: a good moment to bring copies up to date.
    if (!locked)
      void this.syncDue(undefined, { interactive: Boolean(options.looking) }).catch(
        () => undefined,
      );
    return { items, status };
  }

  async #systemKeys(): Promise<SystemKey[]> {
    return (await this.deps.systemKeys?.().catch(() => [])) ?? [];
  }

  #systemSummary(key: SystemKey): VaultItemSummary {
    return {
      id: key.id,
      source: 'system',
      type: 'apiKey',
      title: key.title,
      subtitle: key.usedBy,
      domains: [],
      tags: [],
      favorite: false,
      totp: false,
      passkey: false,
      problems: [],
      readOnly: true,
      ...(key.savedAt && { updatedAt: key.savedAt }),
    };
  }

  async #systemKey(id: string): Promise<SystemKey | undefined> {
    if (!id.startsWith('sys_')) return undefined;
    return (await this.#systemKeys()).find((k) => k.id === id);
  }

  #sourceOf(id: string): PasswordSource | undefined {
    const match = PREFIXES.find(([prefix]) => id.startsWith(prefix));
    return match && this.sources.find((s) => s.id === match[1]);
  }

  async #record(id: string): Promise<ItemRecord> {
    const { items } = await this.store.open();
    const record = items.get(id);
    if (!record) throw new VaultError('not-found', 'That item isn’t in your passwords.');
    return record;
  }

  #view(field: VaultField): VaultFieldView {
    const concealed = isConcealed(field.kind);
    return {
      id: field.id,
      label: field.label,
      kind: field.kind,
      ...(field.role && { role: field.role }),
      ...(!concealed && { value: field.value }),
      filled: field.value.length > 0,
      ...(field.role === 'password' && field.value && { strength: passwordScore(field.value) }),
    };
  }

  async detail(id: string): Promise<VaultItemDetail> {
    const system = await this.#systemKey(id);
    if (system)
      return {
        ...this.#systemSummary(system),
        fields: [{ id: 'key', label: 'Key', kind: 'secret', filled: true }],
        urls: [],
        notes: `Used by ${system.usedBy}. Change it there; Conch keeps it sealed with this computer’s key, so it works even while Passwords is locked.`,
        history: 0,
        usedBy: [system.usedBy],
        allowedSites: [],
        agentAccess: 'never',
        agentRead: 'ask',
        passkeys: [],
        manage: system.manage,
      };
    const source = this.#sourceOf(id);
    if (source) {
      const item = (await source.list()).find((i) => i.ref === id);
      if (!item) throw new VaultError('not-found', `That item isn’t in ${source.name} any more.`);
      const { fields, notes } = await source.fields(id).catch((e: Error) => {
        throw new VaultError('unavailable', e.message);
      });
      return {
        ...this.#external(source, item),
        fields: fields.map((f) => ({
          id: f.id,
          label: f.label,
          kind: f.kind,
          ...(f.role && { role: f.role }),
          ...(f.value !== undefined && { value: f.value }),
          filled: true,
        })),
        urls: item.urls,
        notes,
        history: 0,
        usedBy: [],
        allowedSites: [],
        agentAccess: 'ask',
        agentRead: 'ask',
        passkeys: [],
      };
    }
    const records = await this.#records();
    const record = records.find((r) => r.id === id);
    if (!record) throw new VaultError('not-found', 'That item isn’t in your passwords.');
    const problems = (await this.#problems(records)).get(id) ?? [];
    return {
      ...this.#summary(record, problems),
      fields: record.fields.map((f) => this.#view(f)),
      urls: record.urls,
      notes: record.notes,
      history: record.history.length,
      usedBy: (await this.deps.usedBy?.(id).catch(() => [])) ?? [],
      allowedSites: record.allowedSites,
      agentAccess: record.agentAccess,
      agentRead: record.agentRead,
      passkeys: record.passkeys.map((p) => ({
        id: p.id,
        rpId: p.rpId,
        ...(p.userName && { userName: p.userName }),
        createdAt: p.createdAt,
        ...(p.usedAt && { usedAt: p.usedAt }),
      })),
      ...(record.origin && {
        origin: {
          source: record.origin.source,
          syncing:
            !record.origin.detached &&
            ((await this.settings()).sync[record.origin.source]?.enabled ?? false),
          syncedAt: record.origin.syncedAt,
        },
      }),
    };
  }

  // ── Values ──────────────────────────────────────────────────────────────

  /**
   * From another device, thirty values an hour (ADR 0025): plenty for anyone
   * looking up their own passwords, far too few to page through a whole vault
   * with a stolen session. On this computer there's no limit (`who` unset).
   */
  #rateLimit(who: string | undefined) {
    if (!who) return;
    const now = Date.now();
    const recent = (this.#reveals.get(who) ?? []).filter((t) => now - t < 60 * 60_000);
    if (recent.length >= 30)
      throw new VaultError(
        'refused',
        'That’s a lot of passwords shown in a short time, so Conch is pausing for a while. Try again in an hour.',
      );
    recent.push(now);
    this.#reveals.set(who, recent);
  }

  async #use(id: string, use: ItemRecord['uses'][number]) {
    await this.#mutex.run(async () => {
      const record = await this.#record(id).catch(() => undefined);
      if (!record) return;
      await this.store.put({
        ...record,
        usedAt: use.at,
        uses: [use, ...record.uses].slice(0, 50),
      });
    });
  }

  /** One field's value, for a person who asked to see or copy it. */
  async reveal(
    id: string,
    fieldId: string,
    who: string | undefined,
    how: 'revealed' | 'copied' = 'revealed',
  ) {
    this.#rateLimit(who);
    const system = await this.#systemKey(id);
    if (system) {
      const value = await system.reveal().catch((e: Error) => {
        throw new VaultError('unavailable', e.message);
      });
      this.#remember(value);
      return value;
    }
    const source = this.#sourceOf(id);
    if (source) {
      const value = await source.value(id, fieldId).catch((e: Error) => {
        throw new VaultError('unavailable', e.message);
      });
      this.#remember(value);
      await this.#useExternal(id);
      return value;
    }
    const record = await this.#record(id);
    const field = record.fields.find((f) => f.id === fieldId);
    if (!field) throw new VaultError('not-found', 'That field isn’t there.');
    if (field.kind === 'totp') throw new VaultError('invalid', 'Ask for the code, not its key.');
    this.#remember(field.value);
    await this.#use(id, { at: Date.now(), how });
    return field.value;
  }

  async totp(id: string, fieldId: string | undefined, who: string | undefined) {
    this.#rateLimit(who);
    const source = this.#sourceOf(id);
    if (source) {
      const code = await source.totp(id).catch((e: Error) => {
        throw new VaultError('unavailable', e.message);
      });
      await this.#useExternal(id);
      // External managers only hand out the code, not when it ends: assume the standard 30 s.
      const period = 30;
      return {
        code,
        period,
        expiresAt: (Math.floor(Date.now() / 1000 / period) + 1) * period * 1000,
      };
    }
    const record = await this.#record(id);
    const field = record.fields.find((f) => f.kind === 'totp' && (!fieldId || f.id === fieldId));
    if (!field?.value) throw new VaultError('not-found', 'That item has no one-time code.');
    try {
      const now = totpNow(parseTotp(field.value));
      await this.#use(id, { at: Date.now(), how: 'code' });
      return now;
    } catch (error) {
      throw new VaultError('invalid', (error as Error).message);
    }
  }

  async history(id: string) {
    const record = await this.#record(id);
    for (const h of record.history) this.#remember(h.value);
    return { entries: record.history.map((h) => ({ value: h.value, changedAt: h.changedAt })) };
  }

  // ── Writing ─────────────────────────────────────────────────────────────

  #fieldsFrom(body: SaveVaultItemBody, before?: ItemRecord): VaultField[] {
    const fields: VaultField[] = [];
    for (const input of body.fields) {
      const previous = input.id ? before?.fields.find((f) => f.id === input.id) : undefined;
      // A concealed value the browser never had stays as it is unless a new one came.
      const value = (input.value ?? previous?.value ?? '').replace(/\r\n/g, '\n');
      if (!value && !previous) continue;
      if (input.kind === 'totp' && value && !isValidTotp(value)) {
        try {
          parseTotp(value);
        } catch (error) {
          throw new VaultError(
            'invalid',
            error instanceof TotpError ? error.message : 'That one-time code setup isn’t valid.',
          );
        }
      }
      fields.push({
        id: previous?.id ?? newId('f'),
        label: input.label,
        kind: input.kind,
        ...(input.role && { role: input.role }),
        value,
      });
    }
    return fields.filter((f) => f.value);
  }

  #urlsFrom(urls: string[]): string[] {
    const out: string[] = [];
    for (const url of urls) {
      if (!siteOf(url)) throw new VaultError('invalid', `“${url}” isn’t a web address.`);
      if (!out.includes(url.trim())) out.push(url.trim());
    }
    return out;
  }

  async create(input: z.input<typeof SaveVaultItemBody>): Promise<VaultItemDetail> {
    const body = SaveVaultItemBody.parse(input);
    const { items } = await this.store.open();
    if (items.size >= VAULT_LIMITS.maxItems)
      throw new VaultError(
        'invalid',
        'Your passwords are full. Empty Recently deleted to make room.',
      );
    const now = Date.now();
    const record: ItemRecord = {
      id: newId('pw'),
      type: body.type,
      title: body.title,
      fields: this.#fieldsFrom(body),
      urls: this.#urlsFrom(body.urls),
      tags: [...new Set(body.tags)],
      notes: body.notes,
      favorite: body.favorite,
      agentAccess: body.agentAccess,
      agentRead: body.agentRead,
      allowedSites: body.allowedSites.map((s) => siteOf(s) ?? s.toLowerCase()),
      createdAt: now,
      updatedAt: now,
      history: [],
      uses: [],
      breach: {},
      passkeys: [],
    };
    await this.store.put(record);
    this.#changed();
    return this.detail(record.id);
  }

  async update(id: string, input: z.input<typeof SaveVaultItemBody>): Promise<VaultItemDetail> {
    const body = SaveVaultItemBody.parse(input);
    if (this.#sourceOf(id)) throw new VaultError('read-only', 'Edit this one in its own app.');
    await this.#mutex.run(async () => {
      const before = await this.#record(id);
      const fields = this.#fieldsFrom(body, before);
      const now = Date.now();
      const history = [...before.history];
      for (const old of before.fields) {
        if (!isConcealed(old.kind) || old.kind === 'totp') continue;
        const next = fields.find((f) => f.id === old.id);
        if (old.value && next?.value !== old.value)
          history.unshift({ fieldId: old.id, value: old.value, changedAt: now });
      }
      await this.store.put({
        ...before,
        type: body.type,
        title: body.title,
        fields,
        urls: this.#urlsFrom(body.urls),
        tags: [...new Set(body.tags)],
        notes: body.notes,
        favorite: body.favorite,
        agentAccess: body.agentAccess,
        agentRead: body.agentRead,
        allowedSites: body.allowedSites.map((s) => siteOf(s) ?? s.toLowerCase()),
        updatedAt: now,
        history: history.slice(0, VAULT_LIMITS.maxHistory),
        // Edited here: a sync from the manager it came from leaves it alone now.
        ...(before.origin && { origin: { ...before.origin, detached: true } }),
      });
    });
    this.#changed();
    return this.detail(id);
  }

  async patch(id: string, patch: { favorite?: boolean; tags?: string[] }) {
    if (this.#sourceOf(id)) throw new VaultError('read-only', 'Change this one in its own app.');
    await this.#mutex.run(async () => {
      const record = await this.#record(id);
      await this.store.put({
        ...record,
        ...(patch.favorite !== undefined && { favorite: patch.favorite }),
        ...(patch.tags && { tags: [...new Set(patch.tags)] }),
      });
    });
    this.#changed();
  }

  /** To Recently deleted; it can come back for 30 days. */
  async trash(ids: string[]) {
    await this.#mutex.run(async () => {
      const now = Date.now();
      const records = [];
      for (const id of ids) {
        if (this.#sourceOf(id))
          throw new VaultError('read-only', 'Delete this one in its own app.');
        records.push({ ...(await this.#record(id)), deletedAt: now });
      }
      await this.store.putMany(records);
    });
    this.#changed();
  }

  async restore(ids: string[]) {
    await this.#mutex.run(async () => {
      const records = [];
      for (const id of ids) {
        const { deletedAt: _, ...rest } = await this.#record(id);
        records.push(rest);
      }
      await this.store.putMany(records);
    });
    this.#changed();
  }

  /** Gone for good: only from Recently deleted. */
  async purge(ids?: string[]) {
    const records = await this.#records();
    const drop = records
      .filter((r) => r.deletedAt && (!ids || ids.includes(r.id)))
      .map((r) => r.id);
    await this.store.remove(drop);
    this.#changed();
    return drop.length;
  }

  // ── Import & export ─────────────────────────────────────────────────────

  #key(i: { title: string; fields: { role?: string; value: string }[]; urls: string[] }) {
    const user = i.fields.find((f) => f.role === 'username')?.value ?? '';
    const pass = i.fields.find((f) => f.role === 'password')?.value ?? '';
    const site = siteOf(i.urls[0] ?? '') ?? i.title.toLowerCase();
    return createHash('sha256').update(`${site}\0${user}\0${pass}`).digest('base64url');
  }

  async import(input: {
    format: ImportFormat;
    text: string;
    commit: boolean;
    skipDuplicates: boolean;
  }): Promise<ImportPreview> {
    let parsed: ReturnType<typeof parseImport>;
    try {
      parsed = parseImport(input.text, input.format);
    } catch (error) {
      throw new VaultError(
        'invalid',
        error instanceof ImportError ? error.message : 'That file couldn’t be read.',
      );
    }
    const existing = new Set(
      (await this.#records()).filter((r) => !r.deletedAt).map((r) => this.#key(r)),
    );
    const fresh: Imported[] = [];
    let duplicates = 0;
    const inFile = new Set<string>();
    for (const item of parsed.items) {
      const key = this.#key(item);
      if (existing.has(key) || inFile.has(key)) {
        duplicates++;
        if (input.skipDuplicates) continue;
      }
      inFile.add(key);
      fresh.push(item);
    }
    const preview: ImportPreview = {
      format: parsed.format,
      formatName: formatName(parsed.format),
      found: parsed.items.length,
      duplicates,
      skipped: parsed.skipped,
      sample: fresh.slice(0, 5).map((i) => ({
        title: i.title,
        subtitle: i.fields.find((f) => f.role === 'username')?.value ?? '',
        type: i.type,
      })),
    };
    if (!input.commit) return preview;
    const now = Date.now();
    const records: ItemRecord[] = fresh.map((i) => ({
      id: newId('pw'),
      type: i.type,
      title: i.title,
      fields: i.fields
        .filter((f) => f.value)
        .filter((f) => f.kind !== 'totp' || isValidTotp(f.value))
        .map((f) => ({
          id: newId('f'),
          label: f.label.slice(0, VAULT_LIMITS.maxLabel),
          kind: f.kind,
          ...(f.role && { role: f.role }),
          value: f.value.slice(0, VAULT_LIMITS.maxValue),
        })),
      urls: i.urls,
      tags: i.tags.map((t) => t.slice(0, VAULT_LIMITS.maxTag)),
      notes: i.notes.slice(0, VAULT_LIMITS.maxNotes),
      favorite: i.favorite,
      agentAccess: 'ask',
      agentRead: 'ask',
      allowedSites: [],
      createdAt: now,
      updatedAt: now,
      history: [],
      uses: [],
      breach: {},
      passkeys: (i.passkeys ?? [])
        .map((p) => toPasskey(p, now))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .slice(0, 20),
    }));
    await this.store.putMany(records);
    this.#changed();
    return { ...preview, imported: records.length };
  }

  /** Everything, in Bitwarden-style CSV that every password manager imports. */
  async exportCsv(): Promise<string> {
    const rows = [
      [
        'folder',
        'favorite',
        'type',
        'name',
        'notes',
        'fields',
        'login_uri',
        'login_username',
        'login_password',
        'login_totp',
      ],
    ];
    for (const r of await this.#records()) {
      if (r.deletedAt) continue;
      const role = (name: string) => r.fields.find((f) => f.role === name)?.value ?? '';
      const used = new Set(r.type === 'login' ? ['username', 'password', 'totp'] : []);
      const other = r.fields
        .filter((f) => !f.role || !used.has(f.role))
        .map((f) => `${f.label}: ${f.value}`)
        .join('\n');
      rows.push([
        r.tags[0] ?? '',
        r.favorite ? '1' : '',
        r.type === 'login' ? 'login' : 'note',
        r.title,
        r.notes,
        other,
        r.urls.join(','),
        r.type === 'login' ? role('username') : '',
        r.type === 'login' ? role('password') : '',
        r.type === 'login' ? role('totp') : '',
      ]);
    }
    return toCsv(rows);
  }

  // ── Health ──────────────────────────────────────────────────────────────

  /**
   * Check every password against Have I Been Pwned's Pwned Passwords range
   * API (k-anonymity): only the first five characters of each SHA-1 leave
   * this computer, with `Add-Padding` so the answer's size says nothing.
   */
  async checkBreaches(): Promise<{ checked: number; compromised: number }> {
    const doFetch = this.deps.fetch ?? fetch;
    const vk = await this.store.key();
    const records = (await this.#records()).filter((r) => !r.deletedAt);
    const byPrefix = new Map<string, { record: string; field: string; suffix: string }[]>();
    for (const r of records)
      for (const f of r.fields) {
        if (f.role !== 'password' || !f.value) continue;
        const sha1 = createHash('sha1').update(f.value, 'utf8').digest('hex').toUpperCase();
        const list = byPrefix.get(sha1.slice(0, 5)) ?? [];
        list.push({ record: r.id, field: f.id, suffix: sha1.slice(5) });
        byPrefix.set(sha1.slice(0, 5), list);
      }
    const counts = new Map<string, number>();
    for (const [prefix, entries] of byPrefix) {
      const response = await doFetch(`${HIBP}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'Conch-password-check' },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
      if (!response?.ok)
        throw new VaultError(
          'unavailable',
          'Couldn’t reach the breach check. Check the connection and try again.',
        );
      const found = new Map<string, number>();
      for (const line of (await response.text()).split('\n')) {
        const [suffix, count] = line.trim().split(':');
        // Padding rows have a count of 0.
        if (suffix && Number(count) > 0) found.set(suffix.toUpperCase(), Number(count));
      }
      for (const e of entries) counts.set(`${e.record}\0${e.field}`, found.get(e.suffix) ?? 0);
    }
    const now = Date.now();
    let compromised = 0;
    await this.#mutex.run(async () => {
      const changed: ItemRecord[] = [];
      for (const r of records) {
        const breach = { ...r.breach };
        let touched = false;
        for (const f of r.fields) {
          const count = counts.get(`${r.id}\0${f.id}`);
          if (count === undefined) continue;
          breach[f.id] = { fp: fingerprint(vk, f.value), count, checkedAt: now };
          if (count > 0) compromised++;
          touched = true;
        }
        if (touched) changed.push({ ...(await this.#record(r.id)), breach });
      }
      if (changed.length) await this.store.putMany(changed);
    });
    await this.#saveSettings({ breachCheckedAt: now });
    this.#changed();
    return { checked: counts.size, compromised };
  }

  // ── Sources ─────────────────────────────────────────────────────────────

  #source(id: VaultSourceId): PasswordSource {
    const source = this.sources.find((s) => s.id === id);
    if (!source) throw new VaultError('not-found', 'There’s no password manager by that name.');
    return source;
  }

  async setSource(
    id: VaultSourceId,
    change: { enabled?: boolean; database?: string; keyFile?: string },
  ) {
    const source = this.#source(id);
    const settings = await this.settings();
    if (change.database !== undefined) {
      if (id !== 'keepassxc')
        throw new VaultError('invalid', 'Only KeePassXC takes a database file.');
      const database = change.database.trim();
      if (database && !/\.kdbx$/i.test(database))
        throw new VaultError('invalid', 'Choose a KeePassXC database (a .kdbx file).');
      if (
        database &&
        !(await stat(database).then(
          (s) => s.isFile(),
          () => false,
        ))
      )
        throw new VaultError('invalid', 'That database isn’t there. Choose it again.');
      source.lock?.();
      await this.#saveSettings({
        keepassxc: { ...settings.keepassxc, database: database || undefined },
      });
    }
    if (change.keyFile !== undefined) {
      if (id !== 'keepassxc') throw new VaultError('invalid', 'Only KeePassXC takes a key file.');
      const keyFile = change.keyFile.trim();
      if (
        keyFile &&
        !(await stat(keyFile).then(
          (s) => s.isFile(),
          () => false,
        ))
      )
        throw new VaultError('invalid', 'That key file isn’t there. Choose it again.');
      source.lock?.();
      await this.#saveSettings({
        keepassxc: { ...(await this.settings()).keepassxc, keyFile: keyFile || undefined },
      });
    }
    if (change.enabled !== undefined) {
      if (!change.enabled) {
        source.lock?.();
        await this.#keep(id, undefined);
      }
      await this.#saveSettings({ enabled: { ...settings.enabled, [id]: change.enabled } });
    }
    this.#changed();
    return this.sourceStatus();
  }

  async unlockSource(id: VaultSourceId, password: string, remember = false) {
    const source = this.#source(id);
    if (!source.unlockWith)
      throw new VaultError('invalid', `${source.name} unlocks in its own app.`);
    try {
      await source.unlockWith(password);
    } catch (error) {
      throw new VaultError(
        'refused',
        error instanceof SourceError ? error.message : `${source.name} wouldn’t unlock.`,
      );
    }
    await this.#keep(id, remember ? password : undefined);
    this.#changed();
    void this.syncDue(id).catch(() => undefined);
    return this.sourceStatus();
  }

  /** Lock it now. A manager kept unlocked is forgotten too: locking means locked. */
  async lockSource(id: VaultSourceId) {
    this.#source(id).lock?.();
    await this.#keep(id, undefined);
    this.#changed();
  }

  // ── Kept unlocked (ADR 0025 § Kept unlocked) ───────────────────────────
  //
  // A person can choose to keep a password manager unlocked on this computer.
  // Its password is sealed with this computer's device key (`deviceSealer`) in
  // `vault/remembered.json`: never in a backup, never readable on another
  // computer, but open to anyone who can use this one as you, which the
  // switch says in so many words.

  #remembered?: Promise<Record<string, string>>;
  #reopened = new Set<string>();
  #reopenFailed = new Map<string, string>();

  get #rememberedPath() {
    return join(this.deps.home, 'vault', 'remembered.json');
  }

  #sealer() {
    return deviceSealer(() => this.deviceKey());
  }

  async #keptPasswords(): Promise<Record<string, string>> {
    this.#remembered ??= readFile(this.#rememberedPath, 'utf8')
      .then(async (text) => {
        const plain = await this.#sealer().open('remembered.json', text);
        return z.record(z.string(), z.string()).parse(JSON.parse(plain.toString('utf8')));
      })
      .catch(() => ({}));
    return this.#remembered;
  }

  async #keep(id: VaultSourceId, password: string | undefined) {
    const before = await this.#keptPasswords();
    if (password === undefined && !(id in before)) return;
    const kept = Object.fromEntries(Object.entries(before).filter(([k]) => k !== id));
    if (password !== undefined) kept[id] = password;
    this.#remembered = Promise.resolve(kept);
    this.#reopenFailed.delete(id);
    if (!Object.keys(kept).length) {
      await rm(this.#rememberedPath, { force: true });
      return;
    }
    const sealed = await this.#sealer().seal('remembered.json', Buffer.from(JSON.stringify(kept)));
    await writeJson(this.#rememberedPath, JSON.parse(sealed) as unknown);
  }

  #reopening?: Promise<void>;

  /**
   * Managers kept unlocked open by themselves, once each time Conch starts.
   * Everyone asking meanwhile (Repair everything, the list) waits for the
   * same opening, so nobody sees a kept manager as locked while it opens.
   */
  #reopen(): Promise<void> {
    this.#reopening ??= this.#reopenAll().finally(() => {
      this.#reopening = undefined;
    });
    return this.#reopening;
  }

  async #reopenAll() {
    const kept = await this.#keptPasswords();
    let opened = false;
    for (const [id, password] of Object.entries(kept)) {
      if (this.#reopened.has(id)) continue;
      this.#reopened.add(id);
      const source = this.sources.find((s) => s.id === id);
      if (!source?.unlockWith || !(await this.#enabled(source.id))) continue;
      try {
        await source.unlockWith(password);
        opened = true;
      } catch {
        // The password changed in the manager: stop trying it, and say so.
        await this.#keep(source.id, undefined).catch(() => undefined);
        this.#reopenFailed.set(
          id,
          `Conch couldn’t open ${source.name} with the password it kept. Unlock it again.`,
        );
      }
    }
    // Open now: everything showing it (Repair everything, Passwords) looks again.
    if (opened) this.#changed();
  }

  // ── Moving in (ADR 0025 § Moving in) ────────────────────────────────────

  /** A manager that's on and ready to read, or a sentence saying what it needs. */
  async #readySource(id: VaultSourceId): Promise<PasswordSource> {
    const source = this.#source(id);
    if (!(await this.#enabled(id)))
      throw new VaultError('invalid', `Turn on ${source.name} in Passwords › Sources first.`);
    const state = await source
      .state()
      .catch((e: Error) => ({ state: 'error', message: e.message }));
    if (state.state !== 'ready')
      throw new VaultError('unavailable', state.message ?? `${source.name} isn’t ready.`);
    return source;
  }

  /** What copying from a manager would bring in. Reads names only. */
  async transferPreview(id: VaultSourceId, ids?: string[]) {
    await this.store.open();
    const source = await this.#readySource(id);
    return this.transfers.preview(source, ids).catch((error: Error) => {
      throw new VaultError('unavailable', error.message);
    });
  }

  /** Copy items from a manager into Conch's vault; follow it with `transferJob`. */
  async transfer(
    id: VaultSourceId,
    options: { ids?: string[]; skipDuplicates: boolean; keepSynced: boolean },
  ) {
    await this.store.open();
    const source = await this.#readySource(id);
    if (options.keepSynced) {
      await this.#saveSync(id, { ...(await this.settings()).sync[id], enabled: true });
      this.#armSync();
    }
    const job = this.transfers.start(source, {
      ...(options.ids && { ids: options.ids }),
      skipDuplicates: options.skipDuplicates,
    });
    void this.#recordSync(id, job.jobId);
    this.#changed();
    return job;
  }

  transferJob(jobId: string) {
    const job = this.transfers.job(jobId);
    if (!job) throw new VaultError('not-found', 'That copy isn’t known any more.');
    return job;
  }

  cancelTransfer(jobId: string) {
    this.transfers.cancel(jobId);
  }

  /**
   * Copy to (ADR 0062): some of Conch's own items, made as new items in
   * another password manager through its own program. Their values go on
   * the program's stdin, one item at a time; nothing is written in between.
   * Only a person asks for this (a route behind a recent sign-in); the
   * assistant has no tool for it.
   */
  async copyOut(
    id: VaultSourceId,
    options: { ids: string[]; place?: string; skipDuplicates: boolean; who?: string },
  ): Promise<VaultCopyOutResult> {
    this.#rateLimit(options.who);
    const records = await this.#records();
    const source = await this.#readySource(id);
    if (!source.add)
      throw new VaultError(
        'invalid',
        `Conch can’t add items to ${source.name}. Export them from Conch and import them there.`,
      );
    const wanted = new Set(options.ids);
    const chosen = records.filter((r) => wanted.has(r.id) && !r.deletedAt);
    if (!chosen.length) throw new VaultError('not-found', 'Those items aren’t in Conch any more.');
    // What it already holds, by site and account: names only, from its list.
    const listed = options.skipDuplicates
      ? await source.list().catch((error: Error) => {
          throw new VaultError('unavailable', error.message);
        })
      : [];
    const held = new Set(
      listed.map((i) =>
        sameAccountKey({ type: i.type, title: i.title, site: i.urls[0], account: i.subtitle }),
      ),
    );
    const result: VaultCopyOutResult = { copied: 0, skipped: 0, failed: [] };
    for (const r of chosen) {
      const account =
        r.fields.find((f) => f.role === 'username' && f.value)?.value ??
        r.fields.find((f) => (f.role === 'email' || f.kind === 'email') && f.value)?.value;
      const key = sameAccountKey({ type: r.type, title: r.title, site: r.urls[0], account });
      if (options.skipDuplicates && (r.origin?.source === id || held.has(key))) {
        result.skipped++;
        continue;
      }
      const item: OutgoingItem = {
        type: r.type,
        title: r.title,
        fields: r.fields.map((f) => ({
          label: f.label,
          kind: f.kind,
          ...(f.role && { role: f.role }),
          value: f.value,
        })),
        urls: r.urls,
        tags: r.tags,
        notes: r.notes,
      };
      try {
        await source.add(item, { ...(options.place && { place: options.place }) });
        result.copied++;
      } catch (error) {
        // The manager's own words may quote what it was given: none of it goes back.
        let message = (error as Error).message;
        for (const value of [...r.fields.map((f) => f.value), r.notes])
          if (value.length >= 3) message = message.split(value).join('•••');
        result.failed.push({ title: r.title, message: message.slice(0, 200) });
        // Locked part way: the rest would fail the same way.
        if (/locked|unlock/i.test(message)) break;
      }
    }
    if (result.copied) this.#changed();
    return result;
  }

  async #saveSync(id: VaultSourceId, state: SyncState) {
    await this.#saveSettings({ sync: { ...(await this.settings()).sync, [id]: state } });
  }

  /** When a copy ends, remember it for the sync's "Up to date 5 min ago". */
  async #recordSync(id: VaultSourceId, jobId: string) {
    const job = await this.transfers.finished(jobId);
    const previous = (await this.settings()).sync[id];
    if (!job || !previous) return;
    await this.#saveSync(id, {
      enabled: previous.enabled,
      at: job.state === 'done' ? (job.finishedAt ?? Date.now()) : previous.at,
      ...(job.state === 'failed' && job.message && { problem: job.message.slice(0, 300) }),
    });
    this.#changed();
  }

  /** Turn keeping copies up to date on or off. Turning it off keeps the copies. */
  async setSync(id: VaultSourceId, enabled: boolean) {
    this.#source(id);
    const previous = (await this.settings()).sync[id];
    await this.#saveSync(id, { ...previous, enabled });
    if (enabled) {
      this.#armSync();
      void this.syncDue(id, { force: true }).catch(() => undefined);
    }
    this.#changed();
    return this.sourceStatus();
  }

  /**
   * Bring copies up to date from every manager whose sync is on and is due.
   * Managers that would ask you something (Touch ID for 1Password, the
   * keychain's own dialog) only sync while you're looking at Passwords.
   */
  async syncDue(
    only?: VaultSourceId,
    options: { force?: boolean; interactive?: boolean } = {},
  ): Promise<void> {
    if (await this.isLocked()) return;
    const sync = (await this.settings()).sync;
    for (const source of this.sources) {
      if (only && source.id !== only) continue;
      const state = sync[source.id];
      if (!state?.enabled || !(await this.#enabled(source.id))) continue;
      if (this.transfers.isRunning(source.id)) continue;
      if (!options.force && state.at && Date.now() - state.at < SYNC_EVERY_MS) continue;
      if (!options.interactive && !options.force && PROMPTS.has(source.id)) continue;
      const ready = await source.state().catch(() => ({ state: 'error' as const }));
      if (ready.state !== 'ready') continue;
      const job = this.transfers.start(source, { skipDuplicates: true, removeGone: true });
      await this.#recordSync(source.id, job.jobId);
    }
  }

  #armSync() {
    if (this.#syncTimer) return;
    this.#syncTimer = setInterval(() => {
      void this.syncDue(undefined, { interactive: false }).catch(() => undefined);
    }, 5 * 60_000);
    this.#syncTimer.unref?.();
  }

  // ── Passkeys (ADR 0025 § Passkeys) ──────────────────────────────────────

  /** Saved passkeys for a page: its own site or a parent of it, never a lookalike. */
  async passkeysFor(
    host: string,
  ): Promise<{ itemId: string; passkeyId: string; title: string; userName?: string }[]> {
    if (await this.isLocked()) return [];
    return (await this.#records())
      .filter((r) => !r.deletedAt && r.agentAccess !== 'never')
      .flatMap((r) =>
        r.passkeys
          .filter((p) => siteMatches(p.rpId, host))
          .map((p) => ({
            itemId: r.id,
            passkeyId: p.id,
            title: r.title,
            ...(p.userName && { userName: p.userName }),
          })),
      );
  }

  async #passkey(itemId: string, passkeyId: string, host: string) {
    const record = await this.#record(itemId);
    if (record.deletedAt) throw new VaultError('not-found', 'That item was deleted.');
    if (record.agentAccess === 'never')
      throw new VaultError(
        'refused',
        'The user said this item is never to be used by the assistant.',
      );
    const passkey = record.passkeys.find((p) => p.id === passkeyId);
    if (!passkey) throw new VaultError('not-found', 'That passkey isn’t saved any more.');
    if (!siteMatches(passkey.rpId, host))
      throw new VaultError(
        'refused',
        `That passkey is for ${passkey.rpId}, not ${host}. Conch only uses a passkey on its own site.`,
      );
    return { record, passkey };
  }

  /** Whether the agent may sign in with this passkey here, and whether to ask first. */
  async passkeyPolicy(itemId: string, passkeyId: string, host: string) {
    const { record, passkey } = await this.#passkey(itemId, passkeyId, host);
    return { ask: record.agentAccess !== 'allow', title: record.title, site: passkey.rpId };
  }

  /** The passkey for Conch's browser, for one sign-in the person agreed to. Recorded as a use. */
  async passkeyCredential(itemId: string, passkeyId: string, host: string): Promise<CdpCredential> {
    const { passkey } = await this.#passkey(itemId, passkeyId, host);
    this.#remember(passkey.privateKey);
    this.#remember(toCdp(passkey).privateKey);
    await this.#use(itemId, { at: Date.now(), how: 'filled', where: host });
    return toCdp(passkey);
  }

  /** The site accepted it: keep its counter, so the next sign-in isn't taken for a copy. */
  async passkeyUsed(itemId: string, credentialId: string, signCount: number) {
    const id = cdpIdToVault(credentialId);
    await this.#mutex.run(async () => {
      const record = await this.#record(itemId).catch(() => undefined);
      if (!record) return;
      const now = Date.now();
      await this.store.put({
        ...record,
        passkeys: record.passkeys.map((p) =>
          p.credentialId === id
            ? { ...p, signCount: Math.max(p.signCount, signCount), usedAt: now }
            : p,
        ),
      });
    });
    this.#changed();
  }

  /**
   * A site made a passkey in Conch's browser: keep it with the login for that
   * site and account, or as a new login. Only for the page's own site.
   */
  async savePasskey(
    credential: CdpCredential,
    host: string,
  ): Promise<{ itemId: string; title: string; created: boolean }> {
    const input = fromCdp(credential);
    if (!input || !siteMatches(input.rpId, host))
      throw new VaultError('refused', 'That passkey isn’t for this site.');
    const passkey = toPasskey(input);
    if (!passkey) throw new VaultError('invalid', 'That isn’t a passkey Conch can keep.');
    this.#remember(passkey.privateKey);
    let result: { itemId: string; title: string; created: boolean } | undefined;
    await this.#mutex.run(async () => {
      const records = (await this.#records()).filter((r) => !r.deletedAt && r.type === 'login');
      const forSite = records.filter((r) =>
        r.urls.some((u) => {
          const site = siteOf(u);
          return site ? siteMatches(passkey.rpId, site) || siteMatches(site, passkey.rpId) : false;
        }),
      );
      const user = passkey.userName?.toLowerCase();
      const match =
        forSite.find((r) =>
          r.fields.some((f) => f.role === 'username' && user && f.value.toLowerCase() === user),
        ) ?? (forSite.length === 1 && !user ? forSite[0] : undefined);
      if (match) {
        const passkeys = [
          passkey,
          ...match.passkeys.filter((p) => p.credentialId !== passkey.credentialId),
        ].slice(0, 20);
        await this.store.put({ ...match, passkeys, updatedAt: Date.now() });
        result = { itemId: match.id, title: match.title, created: false };
        return;
      }
      const now = Date.now();
      const record: ItemRecord = {
        id: newId('pw'),
        type: 'login',
        title: passkey.rpId,
        fields: passkey.userName
          ? [
              {
                id: newId('f'),
                label: 'Username',
                kind: 'text',
                role: 'username',
                value: passkey.userName,
              },
            ]
          : [],
        urls: [`https://${passkey.rpId}`],
        tags: [],
        notes: '',
        favorite: false,
        agentAccess: 'ask',
        agentRead: 'ask',
        allowedSites: [],
        createdAt: now,
        updatedAt: now,
        history: [],
        uses: [],
        breach: {},
        passkeys: [passkey],
      };
      await this.store.put(record);
      result = { itemId: record.id, title: record.title, created: true };
    });
    this.#changed();
    if (!result) throw new VaultError('invalid', 'That passkey couldn’t be saved.');
    return result;
  }

  async removePasskey(itemId: string, passkeyId: string) {
    if (this.#sourceOf(itemId))
      throw new VaultError('read-only', 'Change this one in its own app.');
    await this.#mutex.run(async () => {
      const record = await this.#record(itemId);
      if (!record.passkeys.some((p) => p.id === passkeyId))
        throw new VaultError('not-found', 'That passkey isn’t saved any more.');
      await this.store.put({
        ...record,
        passkeys: record.passkeys.filter((p) => p.id !== passkeyId),
        updatedAt: Date.now(),
      });
    });
    this.#changed();
  }

  // ── The agent ───────────────────────────────────────────────────────────

  /**
   * What the agent may know: names, kinds and sites. Never a value, a hint
   * or a last four (ADR 0025 § The agent).
   */
  async forAgent(
    query?: string,
  ): Promise<
    { id: string; title: string; type: string; sites: string[]; source: string; passkey: boolean }[]
  > {
    const { items } = await this.list();
    const q = query?.trim().toLowerCase();
    const records = new Map((await this.#records()).map((r) => [r.id, r]));
    return items
      .filter(
        (i) => !i.deletedAt && i.source !== 'system' && records.get(i.id)?.agentAccess !== 'never',
      )
      .filter(
        (i) => !q || i.title.toLowerCase().includes(q) || i.domains.some((d) => d.includes(q)),
      )
      .slice(0, 50)
      .map((i) => ({
        id: i.id,
        title: i.title,
        type: i.type,
        sites: i.domains,
        source: i.source,
        passkey: i.passkey,
      }));
  }

  async cards(): Promise<VaultItemSummary[]> {
    if (await this.isLocked()) return [];
    const { items } = await this.list();
    const records = new Map((await this.#records()).map((r) => [r.id, r]));
    return items.filter(
      (i) => !i.deletedAt && i.type === 'card' && records.get(i.id)?.agentAccess !== 'never',
    );
  }

  /**
   * Passwords must be open for what the agent asked: if it's locked, show the
   * person the card that unlocks it and wait. False if it stayed locked.
   */
  async ensureOpen(show: (request: VaultRequest) => void, signal: AbortSignal): Promise<boolean> {
    if (!(await this.isLocked())) return true;
    const requestId = newId('vreq');
    show({ requestId, kind: 'unlock', state: 'waiting' });
    const open = await this.waitForUnlock(signal);
    show({ requestId, kind: 'unlock', state: open ? 'done' : 'expired' });
    return open;
  }

  /** Items that belong on a page, best match first (for the browser's sign-in fields). */
  async matching(host: string): Promise<VaultItemSummary[]> {
    const { items } = await this.list();
    const records = new Map((await this.#records()).map((r) => [r.id, r]));
    return items.filter(
      (i) =>
        !i.deletedAt &&
        i.source !== 'system' &&
        records.get(i.id)?.agentAccess !== 'never' &&
        [...i.domains, ...(records.get(i.id)?.allowedSites ?? [])].some((d) =>
          siteMatches(d, host),
        ),
    );
  }

  /**
   * Whether the agent may fill this item here, and if so whether to ask first.
   * Refuses outright on a site the item doesn't belong to: a password for
   * netflix.com is never typed into netflix.com.evil.example.
   */
  async fillPolicy(request: FillRequest): Promise<{ ask: boolean; title: string; site: string }> {
    const source = this.#sourceOf(request.itemId);
    const summary = source
      ? (await source.list())
          .map((i) => this.#external(source, i))
          .find((i) => i.id === request.itemId)
      : undefined;
    const record = source ? undefined : await this.#record(request.itemId).catch(() => undefined);
    if (!summary && !record)
      throw new VaultError('not-found', 'There’s no saved item with that id.');
    if (record?.deletedAt) throw new VaultError('not-found', 'That item was deleted.');
    if (record?.agentAccess === 'never')
      throw new VaultError(
        'refused',
        'The user said this item is never to be used by the assistant.',
      );
    // A card isn't for one site: it may go into any secure checkout, and always with your OK.
    if ((record?.type ?? summary?.type) === 'card') {
      if (!/\./.test(request.host) && request.host !== 'localhost')
        throw new VaultError('refused', 'Cards are only filled on a real website.');
      return {
        ask: true,
        title: record?.title ?? summary?.title ?? 'that card',
        site: request.host,
      };
    }
    const sites = record
      ? [...record.urls.map((u) => siteOf(u) ?? ''), ...record.allowedSites]
      : (summary?.domains ?? []);
    const site = sites.find((s) => s && siteMatches(s, request.host));
    if (!site)
      throw new VaultError(
        'refused',
        `That item is for ${sites.filter(Boolean).join(', ') || 'no website'}, not ${request.host}. Conch only fills a password on the site it belongs to.`,
      );
    return {
      ask: record?.agentAccess !== 'allow',
      title: record?.title ?? summary?.title ?? 'that item',
      site,
    };
  }

  /** The value for a fill the person approved. Recorded as a use. */
  async fillValue(request: FillRequest): Promise<string> {
    await this.fillPolicy(request);
    const source = this.#sourceOf(request.itemId);
    let value: string | undefined;
    if (source) {
      if (request.want === 'totp') value = await source.totp(request.itemId);
      else {
        const { fields } = await source.fields(request.itemId);
        const field =
          fields.find((f) => f.role === request.want) ?? fields.find((f) => f.kind === 'secret');
        if (field) value = field.value ?? (await source.value(request.itemId, field.id));
      }
      if (value) await this.#useExternal(request.itemId);
    } else {
      const record = await this.#record(request.itemId);
      if (request.want === 'totp') {
        const field = record.fields.find((f) => f.kind === 'totp');
        if (field) value = totpNow(parseTotp(field.value)).code;
      } else value = record.fields.find((f) => f.role === request.want)?.value;
      if (value) await this.#use(record.id, { at: Date.now(), how: 'filled', where: request.host });
    }
    if (!value)
      throw new VaultError(
        'not-found',
        `That item has no ${request.want === 'totp' ? 'one-time code' : request.want}.`,
      );
    this.#remember(value);
    return value;
  }

  /** The person chose "Always" on a fill: the agent may use this item on its own sites without asking. */
  async allowAgent(id: string) {
    if (this.#sourceOf(id)) return;
    await this.#mutex.run(async () => {
      const record = await this.#record(id);
      await this.store.put({ ...record, agentAccess: 'allow' });
    });
    this.#changed();
  }

  /**
   * Text with every secret Conch knows replaced by •••, in the forms a value
   * travels in: as is, base64, URL-encoded, JSON-escaped (ADR 0025 § Redaction).
   */
  redactor(): (text: string) => string {
    return (text: string) => {
      if (!text || !this.#known.size) return text;
      let out = text;
      for (const value of this.#known) {
        const forms = new Set([
          value,
          Buffer.from(value).toString('base64'),
          Buffer.from(value).toString('base64url'),
          encodeURIComponent(value),
          JSON.stringify(value).slice(1, -1),
          Buffer.from(value).toString('hex'),
        ]);
        for (const form of forms)
          if (form.length >= (form === value ? 4 : 6) && out.includes(form))
            out = out.split(form).join('•••');
      }
      return out;
    };
  }

  /** A line for the agent's system prompt. */
  promptSection(): string {
    return [
      '## Passwords',
      'The user keeps passwords, cards, notes and keys in Conch’s Passwords. You never see a password unless the user agrees, and must never ask them to type or paste a secret into the chat.',
      '- Signing in or paying on a website: use browser_type on the password, code or card field with an empty text. Conch fills it from Passwords after the user agrees (the username too); you never see it. passwords_find lists what’s saved (names and sites only); pass `item` when there’s more than one.',
      '- Missing a credential you need: call passwords_request with a short reason. The user types it into a secure card in the chat and it’s saved; you get its id, never the value.',
      '- Needing a value yourself (a PIN for a phone menu, a note, a key for a command): passwords_read, with a reason; the user is asked first. Use it for that and never repeat it in a reply.',
      '- Passkeys: when a site offers “Sign in with a passkey” and passwords_find shows one saved for it, call browser_passkey with sign_in, then click that button. When a site offers to create a passkey and the user wants one, call browser_passkey with save first.',
      '- If Passwords is locked, the user sees an Unlock card and you carry on once they unlock it.',
    ].join('\n');
  }

  /**
   * For a passphrase-locked backup: the vault's own key, so the passwords open
   * on any computer the backup is restored to (ADR 0025 § Backups). Only ever
   * written inside the backup's encrypted part.
   */
  async backupFiles(): Promise<{ path: string; data: Buffer }[]> {
    if (await this.isLocked())
      throw new VaultError(
        'refused',
        'Unlock Passwords first, so your passwords can go in the backup with the key that opens them.',
      );
    const exists = await this.store.rawFile().catch(() => undefined);
    if (!exists) return [];
    const vk = await this.store.key();
    return [
      {
        path: 'vault/key.json',
        data: Buffer.from(JSON.stringify({ format: 1, key: vk.toString('base64url') })),
      },
    ];
  }

  // ── The lock (ADR 0025 § The lock) ──────────────────────────────────────

  /**
   * Open Passwords with its password. Wrong guesses are free five times, then
   * each waits twice as long as the last (up to 15 minutes): enough for a
   * person, far too slow to guess.
   */
  async unlock(password: string): Promise<void> {
    const wait = this.#waitUntil - Date.now();
    if (wait > 0)
      throw new VaultError(
        'refused',
        `Too many wrong passwords. Try again in ${Math.ceil(wait / 60_000)} min.`,
      );
    try {
      await this.store.unlock(password);
    } catch (error) {
      if (!(error instanceof WrongPassword)) throw error;
      this.#failures++;
      if (this.#failures >= FREE_TRIES)
        this.#waitUntil =
          Date.now() + Math.min(MAX_WAIT_MS, 1000 * 2 ** (this.#failures - FREE_TRIES + 3));
      throw new VaultError('refused', error.message);
    }
    this.#failures = 0;
    this.#waitUntil = 0;
    this.#lastUse = Date.now();
    this.#armAutoLock();
    this.unlocked.emit();
    this.#changed();
  }

  /** Close it now. */
  async lock(): Promise<void> {
    await this.store.lock();
    this.#changed();
  }

  /** Turn the lock on or off, or change how soon it closes by itself. */
  async setLock(change: { enabled?: boolean; password?: string; autoLockMinutes?: number }) {
    if (change.autoLockMinutes !== undefined)
      await this.#saveSettings({ autoLockMinutes: change.autoLockMinutes });
    if (change.enabled === true) {
      if (!change.password) throw new VaultError('invalid', 'Choose a password for Passwords.');
      if ((await this.store.lockState()).locked)
        throw new VaultError('refused', 'Unlock Passwords first.');
      await this.store.enableLock(change.password);
      this.#armAutoLock();
    } else if (change.enabled === false) {
      if ((await this.store.lockState()).locked)
        throw new VaultError('refused', 'Unlock Passwords first.');
      await this.store.disableLock();
    }
    this.#changed();
    return this.store.lockState();
  }

  /** Locks itself after the chosen idle time (only when the lock is on). */
  #armAutoLock() {
    clearInterval(this.#lockTimer);
    this.#lockTimer = setInterval(() => {
      void (async () => {
        const minutes = (await this.settings()).autoLockMinutes;
        const state = await this.store.lockState();
        if (!state.enabled || state.locked || !minutes) return;
        if (Date.now() - this.#lastUse > minutes * 60_000) await this.lock();
      })().catch(() => undefined);
    }, 30_000);
    this.#lockTimer.unref?.();
  }

  stop() {
    clearInterval(this.#lockTimer);
    clearInterval(this.#syncTimer);
  }

  /**
   * Wait for the person to unlock (they're shown a card in the chat), up to
   * ten minutes or until the turn ends. Resolves true once it's open.
   */
  async waitForUnlock(signal: AbortSignal, ms = 10 * 60_000): Promise<boolean> {
    if (!(await this.store.lockState()).locked) return true;
    return new Promise<boolean>((resolve) => {
      const done = (open: boolean) => {
        off();
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        resolve(open);
      };
      const off = this.unlocked.on(() => done(true));
      const abort = () => done(false);
      const timer = setTimeout(() => done(false), ms);
      timer.unref?.();
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  async isLocked(): Promise<boolean> {
    return (await this.store.lockState()).locked;
  }

  // ── Asking in the chat (ADR 0025 § Asking) ──────────────────────────────

  /**
   * The agent asks the person for a credential. The card shows the site by its
   * real host and the reason in the agent's words; what's typed goes straight
   * into the vault. The agent only ever learns that it was saved, and its id.
   */
  async request(
    request: Omit<VaultRequest, 'requestId' | 'state'>,
    show: (request: VaultRequest) => void,
    signal: AbortSignal,
  ): Promise<{ itemId?: string; declined?: boolean; expired?: boolean }> {
    const requestId = newId('vreq');
    const waiting = { ...request, requestId, state: 'waiting' as const };
    show(waiting);
    const outcome = await new Promise<{ itemId?: string; declined?: boolean; expired?: boolean }>(
      (resolve) => {
        const expire = () => {
          if (this.#requests.delete(requestId)) resolve({ expired: true });
        };
        const timer = setTimeout(expire, 15 * 60_000);
        timer.unref?.();
        signal.addEventListener('abort', expire, { once: true });
        this.#requests.set(requestId, {
          request: waiting,
          resolve: (o) => {
            clearTimeout(timer);
            signal.removeEventListener('abort', expire);
            resolve(o);
          },
        });
      },
    );
    show({
      ...waiting,
      state: outcome.itemId ? 'done' : outcome.declined ? 'declined' : 'expired',
      ...(outcome.itemId && { itemId: outcome.itemId }),
    });
    return outcome;
  }

  /** The person filled in the card. */
  async answer(requestId: string, body: z.input<typeof AnswerVaultRequestBody>): Promise<string> {
    const pending = this.#requests.get(requestId);
    if (!pending) throw new VaultError('not-found', 'That request isn’t waiting any more.');
    const answer = AnswerVaultRequestBody.parse(body);
    const site = pending.request.site;
    const created = await this.create({
      type: pending.request.itemType ?? 'login',
      title: answer.title,
      fields: answer.fields.map((f) => ({
        label: f.label,
        kind: f.kind,
        ...(f.role && { role: f.role }),
        value: f.value,
      })),
      urls: answer.urls.length ? answer.urls : site ? [`https://${site}`] : [],
      agentAccess: answer.agentAccess,
    });
    this.#requests.delete(requestId);
    pending.resolve({ itemId: created.id });
    return created.id;
  }

  decline(requestId: string): void {
    const pending = this.#requests.get(requestId);
    if (!pending) return;
    this.#requests.delete(requestId);
    pending.resolve({ declined: true });
  }

  /**
   * Whether the agent may read a value itself, and if so whether to ask. A
   * read puts the value in the model's context, so it's never silent for a
   * password, a card or a recovery phrase unless the item says so.
   */
  async readPolicy(
    itemId: string,
    field?: string,
  ): Promise<{
    ask: boolean;
    title: string;
    type: VaultItemType;
    field: { id: string; label: string };
    sensitive: boolean;
  }> {
    const record = await this.#record(itemId).catch(() => undefined);
    if (!record || record.deletedAt) {
      const source = this.#sourceOf(itemId);
      if (!source) throw new VaultError('not-found', 'There’s no saved item with that id.');
      const item = (await source.list()).find((i) => i.ref === itemId);
      if (!item) throw new VaultError('not-found', 'There’s no saved item with that id.');
      const { fields } = await source.fields(itemId);
      const f = this.#pickField(fields, field);
      return { ask: true, title: item.title, type: item.type, field: f, sensitive: true };
    }
    if (record.agentAccess === 'never')
      throw new VaultError(
        'refused',
        'The user said this item is never to be used by the assistant.',
      );
    const f = this.#pickField(record.fields, field);
    const kind = record.fields.find((x) => x.id === f.id)?.kind;
    const role = record.fields.find((x) => x.id === f.id)?.role;
    const sensitive =
      kind === 'secret' ||
      kind === 'pin' ||
      kind === 'totp' ||
      role === 'recoveryPhrase' ||
      role === 'privateKey';
    return {
      ask: record.agentRead !== 'allow',
      title: record.title,
      type: record.type,
      field: f,
      sensitive,
    };
  }

  #pickField(fields: { id: string; label: string; role?: string }[], wanted?: string) {
    if (!fields.length) throw new VaultError('not-found', 'That item has nothing saved in it.');
    if (!wanted) return fields[0] as { id: string; label: string };
    const w = wanted.trim().toLowerCase();
    const found =
      fields.find((f) => f.id === wanted) ??
      fields.find((f) => f.label.toLowerCase() === w) ??
      fields.find((f) => f.role?.toLowerCase() === w) ??
      fields.find((f) => f.label.toLowerCase().includes(w));
    if (!found)
      throw new VaultError(
        'not-found',
        `That item has no “${wanted}”. It has: ${fields.map((f) => f.label).join(', ')}.`,
      );
    return found;
  }

  /** The value the person agreed the agent may read. Recorded, and redacted from logs. */
  async readValue(itemId: string, fieldId: string): Promise<string> {
    const source = this.#sourceOf(itemId);
    let value: string;
    if (source) {
      const { fields } = await source.fields(itemId);
      const f = fields.find((x) => x.id === fieldId);
      value =
        f?.kind === 'totp'
          ? await source.totp(itemId)
          : (f?.value ?? (await source.value(itemId, fieldId)));
      await this.#useExternal(itemId);
    } else {
      const record = await this.#record(itemId);
      const f = record.fields.find((x) => x.id === fieldId);
      if (!f) throw new VaultError('not-found', 'That field isn’t there.');
      value = f.kind === 'totp' ? totpNow(parseTotp(f.value)).code : f.value;
      await this.#use(itemId, { at: Date.now(), how: 'agent' });
    }
    // A value the agent read is blanked from everything logged, short PINs included.
    this.#remember(value, 4);
    return value;
  }

  /** "Always" on a read: this item may be read without asking. */
  async allowRead(itemId: string) {
    if (this.#sourceOf(itemId)) return;
    await this.#mutex.run(async () => {
      const record = await this.#record(itemId);
      await this.store.put({ ...record, agentRead: 'allow' });
    });
    this.#changed();
  }

  /** Forget memory after a restore replaced the vault file. */
  reset() {
    this.store.reset();
    this.#settings = undefined;
  }
}
