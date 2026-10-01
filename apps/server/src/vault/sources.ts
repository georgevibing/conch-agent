/**
 * Password managers Conch reads alongside its own vault (ADR 0025,
 * AGENTS.md § Adding a password manager).
 *
 * Every source follows the same rules:
 * - **Read through the manager's own program**, with its own unlock (Touch ID
 *   for 1Password; the master password, typed once, for Bitwarden and
 *   KeePassXC). Secrets go to those programs on stdin or in their documented
 *   environment variable, never as arguments.
 * - **Lists carry no secrets.** Item names, accounts and sites are kept in
 *   memory for a few minutes; secret values are fetched for one use, then
 *   dropped (they stay in the redaction set so they can't leak into a chat).
 * - **Nothing is copied into Conch's vault** unless the person imports it.
 * - **Read-only.** Edits happen in the manager's own app.
 */
import { createHash, createPrivateKey, type JsonWebKey } from 'node:crypto';

import type {
  VaultFieldKind,
  VaultFieldRole,
  VaultItemType,
  VaultSource,
  VaultSourceId,
} from '@conch/protocol';
import { siteOf } from '@conch/protocol';

import { agentEnv, findExecutable, run, type RunResult } from '../lib/proc';
import { parseCsv } from './importers';
import { type BitwardenFido2, fromBitwarden, type PasskeyInput } from './passkeys';
import { parseTotp, totpNow } from './totp';

export interface ExternalField {
  id: string;
  label: string;
  kind: VaultFieldKind;
  role?: VaultFieldRole;
  /** Only for fields that aren't concealed. */
  value?: string;
}

export interface ExternalItem {
  /** Stable within the source, made of id-safe characters. */
  ref: string;
  type: VaultItemType;
  title: string;
  subtitle: string;
  urls: string[];
  tags: string[];
  favorite: boolean;
  totp: boolean;
  container?: string;
  updatedAt?: number;
  /** Known when the list carries them (Bitwarden, KeePassXC); fetched on demand otherwise. */
  fields?: ExternalField[];
  notes?: string;
}

/** Everything an item holds, values included: only for copying it into Conch's vault. */
export interface FullItem {
  fields: (Omit<ExternalField, 'value'> & { value: string })[];
  notes: string;
  passkeys?: PasskeyInput[];
}

export class SourceError extends Error {}

export interface Exec {
  find: (name: string) => Promise<string | undefined>;
  run: (
    file: string,
    args: string[],
    options?: {
      env?: Record<string, string>;
      timeout?: number;
      input?: string;
      signal?: AbortSignal;
    },
  ) => Promise<RunResult>;
}

export const realExec: Exec = {
  find: (name) =>
    name === 'keepassxc-cli'
      ? findExecutable(name, {
          extraDirs: ['/Applications/KeePassXC.app/Contents/MacOS', 'C:\\Program Files\\KeePassXC'],
        })
      : findExecutable(name),
  run,
};

/** What every external password manager offers Conch. */
export interface PasswordSource {
  readonly id: Exclude<VaultSourceId, 'conch'>;
  readonly name: string;
  /** How it's unlocked from Conch. */
  readonly unlock: 'app' | 'password';
  /** The need (ADR 0016) that brings its program; none when it's part of the system. */
  readonly need?: string;
  state(options?: { force?: boolean }): Promise<Pick<VaultSource, 'state' | 'message'>>;
  list(options?: { force?: boolean; signal?: AbortSignal }): Promise<ExternalItem[]>;
  fields(ref: string, signal?: AbortSignal): Promise<{ fields: ExternalField[]; notes: string }>;
  /** One secret value, for one use. */
  value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string>;
  /** The current one-time code. */
  totp(ref: string, signal?: AbortSignal): Promise<string>;
  /**
   * Every value of one item in one read, for copying it into Conch's vault.
   * Optional: without it, Conch asks `value` for each concealed field.
   */
  full?(ref: string, signal?: AbortSignal): Promise<FullItem>;
  /** For `password` sources: unlock with what the person typed. */
  unlockWith?(password: string): Promise<void>;
  lock?(): void;
}

const LIST_MS = 5 * 60_000;
const UNLOCK_WAIT_MS = 60_000;

function sha(text: string): string {
  return createHash('sha256').update(text).digest('base64url').slice(0, 24);
}

function firstLine(text: string): string {
  return (text.trim().split('\n').pop() ?? '').replace(/^\[ERROR]\s*[\d/: ]*/, '').trim();
}

// ── 1Password ───────────────────────────────────────────────────────────────

const OP_TYPES: Record<string, VaultItemType> = {
  LOGIN: 'login',
  PASSWORD: 'login',
  CREDIT_CARD: 'card',
  IDENTITY: 'identity',
  SECURE_NOTE: 'note',
  API_CREDENTIAL: 'apiKey',
  WIRELESS_ROUTER: 'wifi',
  BANK_ACCOUNT: 'bank',
  SSH_KEY: 'sshKey',
  SERVER: 'server',
  DATABASE: 'database',
  PASSPORT: 'document',
  DRIVER_LICENSE: 'document',
  SOFTWARE_LICENSE: 'license',
  CRYPTO_WALLET: 'wallet',
};

const OP_KINDS: Record<string, VaultFieldKind> = {
  STRING: 'text',
  CONCEALED: 'secret',
  OTP: 'totp',
  EMAIL: 'email',
  URL: 'url',
  DATE: 'date',
  MONTH_YEAR: 'monthYear',
  PHONE: 'phone',
  CREDIT_CARD_NUMBER: 'secret',
  SSHKEY: 'secretText',
};

interface OpListItem {
  id: string;
  title?: string;
  category?: string;
  vault?: { id: string; name?: string };
  tags?: string[];
  favorite?: boolean;
  urls?: { href?: string; primary?: boolean }[];
  updated_at?: string;
  additional_information?: string;
}

interface OpField {
  id: string;
  type?: string;
  purpose?: string;
  label?: string;
  value?: string;
}

const OP_ID = /^[a-z0-9]{1,64}$/;

export class OnePasswordSource implements PasswordSource {
  readonly id = '1password' as const;
  readonly name = '1Password';
  readonly unlock = 'app' as const;
  readonly need = 'op';
  #list?: { items: ExternalItem[]; at: number };

  constructor(private readonly exec: Exec = realExec) {}

  async #op(args: string[], signal?: AbortSignal): Promise<RunResult> {
    const op = await this.exec.find('op');
    if (!op)
      throw new SourceError(
        'Install the 1Password command line tool to see your 1Password items here.',
      );
    return this.exec.run(op, args, { timeout: UNLOCK_WAIT_MS, ...(signal && { signal }) });
  }

  async state(): Promise<Pick<VaultSource, 'state' | 'message'>> {
    const op = await this.exec.find('op');
    if (!op) return { state: 'missing', message: 'Needs the 1Password command line tool.' };
    const accounts = await this.exec.run(op, ['account', 'list', '--format', 'json'], {
      timeout: 10_000,
    });
    if (accounts.code !== 0 || accounts.stdout.trim() === '[]' || !accounts.stdout.trim())
      return {
        state: 'locked',
        message:
          'In the 1Password app, open Settings › Developer and turn on “Integrate with 1Password CLI”.',
      };
    return { state: 'ready' };
  }

  #split(ref: string): { vault: string; item: string } {
    const m = /^op_([a-z0-9]+)_([a-z0-9]+)$/.exec(ref);
    if (!m?.[1] || !m[2]) throw new SourceError('That 1Password item isn’t known.');
    return { vault: m[1], item: m[2] };
  }

  async list(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ExternalItem[]> {
    if (this.#list && !options.force && Date.now() - this.#list.at < LIST_MS)
      return this.#list.items;
    const result = await this.#op(['item', 'list', '--format', 'json'], options.signal);
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    let raw: OpListItem[];
    try {
      raw = JSON.parse(result.stdout) as OpListItem[];
    } catch {
      throw new SourceError('1Password answered with something Conch couldn’t read.');
    }
    const items = raw
      .filter((i) => OP_ID.test(i.id) && i.vault && OP_ID.test(i.vault.id))
      .map((i): ExternalItem => ({
        ref: `op_${i.vault?.id}_${i.id}`,
        type: OP_TYPES[i.category ?? ''] ?? 'login',
        title: i.title?.trim() || 'Untitled',
        subtitle: i.additional_information ?? '',
        urls: (i.urls ?? []).map((u) => u.href ?? '').filter(Boolean),
        tags: i.tags ?? [],
        favorite: Boolean(i.favorite),
        totp: false,
        container: i.vault?.name,
        ...(i.updated_at && { updatedAt: Date.parse(i.updated_at) || undefined }),
      }));
    this.#list = { items, at: Date.now() };
    return items;
  }

  async fields(ref: string, signal?: AbortSignal) {
    const { vault, item } = this.#split(ref);
    const result = await this.#op(
      ['item', 'get', item, '--vault', vault, '--format', 'json'],
      signal,
    );
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    const parsed = JSON.parse(result.stdout) as { fields?: OpField[] };
    let notes = '';
    const fields: ExternalField[] = [];
    for (const f of parsed.fields ?? []) {
      if (f.purpose === 'NOTES') {
        notes = f.value ?? '';
        continue;
      }
      if (!f.id || (!f.value && f.type !== 'CONCEALED' && f.type !== 'OTP')) continue;
      const kind = OP_KINDS[f.type ?? ''] ?? 'text';
      const concealed = kind === 'secret' || kind === 'totp' || kind === 'secretText';
      fields.push({
        id: f.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'field',
        label: f.label || (f.purpose === 'USERNAME' ? 'Username' : 'Field'),
        kind,
        ...(f.purpose === 'USERNAME' && { role: 'username' as const }),
        ...(f.purpose === 'PASSWORD' && { role: 'password' as const }),
        ...(kind === 'totp' && { role: 'totp' as const }),
        // The value of a concealed field never leaves this function.
        ...(!concealed && { value: f.value ?? '' }),
      });
    }
    return { fields, notes };
  }

  async value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string> {
    const { vault, item } = this.#split(ref);
    const result = await this.#op(
      ['item', 'get', item, '--vault', vault, '--format', 'json', '--reveal'],
      signal,
    );
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    const parsed = JSON.parse(result.stdout) as { fields?: OpField[] };
    const field = (parsed.fields ?? []).find(
      (f) => (f.id ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) === fieldId,
    );
    if (!field?.value) throw new SourceError('That field is empty in 1Password.');
    return field.value;
  }

  async totp(ref: string, signal?: AbortSignal): Promise<string> {
    const { vault, item } = this.#split(ref);
    const result = await this.#op(['item', 'get', item, '--vault', vault, '--otp'], signal);
    if (result.code !== 0 || !/^\d{6,8}$/.test(result.stdout.trim()))
      throw new SourceError(this.#explain(result.stderr) || 'That item has no one-time code.');
    return result.stdout.trim();
  }

  #explain(stderr: string): string {
    const text = firstLine(stderr).toLowerCase();
    if (/lock|sign|authoriz|session|biometric/.test(text))
      return '1Password is locked. Unlock it, then try again.';
    return text ? `1Password said: ${firstLine(stderr)}` : '1Password didn’t answer.';
  }
}

// ── Bitwarden ───────────────────────────────────────────────────────────────

interface BwItem {
  id: string;
  type: number;
  name?: string;
  notes?: string | null;
  favorite?: boolean;
  folderId?: string | null;
  revisionDate?: string;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[] | null;
    fido2Credentials?: BitwardenFido2[] | null;
  } | null;
  card?: {
    cardholderName?: string | null;
    number?: string | null;
    brand?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    code?: string | null;
  } | null;
  identity?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  fields?: { name?: string | null; value?: string | null; type?: number }[] | null;
}

const BW_ID = /^[0-9a-f-]{36}$/i;

/**
 * Bitwarden through `bw`. Unlocking gives a session key, kept in memory only
 * (never written, never logged) and passed back in `BW_SESSION`.
 */
export class BitwardenSource implements PasswordSource {
  readonly id = 'bitwarden' as const;
  readonly name = 'Bitwarden';
  readonly unlock = 'password' as const;
  readonly need = 'bw';
  #session?: string;
  #list?: { items: ExternalItem[]; at: number };

  constructor(private readonly exec: Exec = realExec) {}

  async #bw(args: string[], extra: Record<string, string> = {}, signal?: AbortSignal) {
    const bw = await this.exec.find('bw');
    if (!bw)
      throw new SourceError(
        'Install the Bitwarden command line tool to see your Bitwarden items here.',
      );
    return this.exec.run(bw, args, {
      timeout: UNLOCK_WAIT_MS,
      env: agentEnv({
        ...(this.#session && { BW_SESSION: this.#session }),
        BW_NOINTERACTION: 'true',
        ...extra,
      }),
      ...(signal && { signal }),
    });
  }

  async state(): Promise<Pick<VaultSource, 'state' | 'message'>> {
    if (!(await this.exec.find('bw')))
      return { state: 'missing', message: 'Needs the Bitwarden command line tool.' };
    const result = await this.#bw(['status']);
    let status = '';
    try {
      status = (JSON.parse(result.stdout) as { status?: string }).status ?? '';
    } catch {
      return { state: 'error', message: 'The Bitwarden command line tool didn’t answer.' };
    }
    if (status === 'unauthenticated')
      return {
        state: 'locked',
        message: 'Sign in to Bitwarden once in a terminal with “bw login”, then unlock it here.',
      };
    if (status !== 'unlocked' || !this.#session)
      return {
        state: 'locked',
        message: 'Unlock Bitwarden with its master password to see your items here.',
      };
    return { state: 'ready' };
  }

  async unlockWith(password: string): Promise<void> {
    // `--passwordenv` reads the master password from this variable: not argv, not a file.
    const result = await this.#bw(['unlock', '--passwordenv', 'CONCH_BW_PASSWORD', '--raw'], {
      CONCH_BW_PASSWORD: password,
    });
    const session = result.stdout.trim();
    if (result.code !== 0 || !session || /\s/.test(session))
      throw new SourceError(
        /invalid master password|incorrect/i.test(result.stderr)
          ? 'That isn’t your Bitwarden master password.'
          : firstLine(result.stderr) || 'Bitwarden wouldn’t unlock.',
      );
    this.#session = session;
    this.#list = undefined;
  }

  lock(): void {
    this.#session = undefined;
    this.#list = undefined;
  }

  async #items(signal?: AbortSignal): Promise<BwItem[]> {
    if (!this.#session) throw new SourceError('Unlock Bitwarden first.');
    const result = await this.#bw(['list', 'items'], {}, signal);
    if (result.code !== 0) {
      if (/locked|session/i.test(result.stderr)) this.lock();
      throw new SourceError(firstLine(result.stderr) || 'Bitwarden didn’t answer.');
    }
    return JSON.parse(result.stdout) as BwItem[];
  }

  #fieldsOf(item: BwItem): ExternalField[] {
    const fields: ExternalField[] = [];
    if (item.login) {
      if (item.login.username)
        fields.push({
          id: 'username',
          label: 'Username',
          kind: 'text',
          role: 'username',
          value: item.login.username,
        });
      if (item.login.password)
        fields.push({ id: 'password', label: 'Password', kind: 'secret', role: 'password' });
      if (item.login.totp)
        fields.push({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp' });
    }
    if (item.card) {
      if (item.card.cardholderName)
        fields.push({
          id: 'cardholder',
          label: 'Name on card',
          kind: 'text',
          role: 'cardholder',
          value: item.card.cardholderName,
        });
      if (item.card.number)
        fields.push({ id: 'cardNumber', label: 'Number', kind: 'secret', role: 'cardNumber' });
    }
    (item.fields ?? []).forEach((f, i) => {
      if (!f.name) return;
      const concealed = f.type === 1;
      fields.push({
        id: `custom${i}`,
        label: f.name.slice(0, 80),
        kind: concealed ? 'secret' : 'text',
        ...(!concealed && { value: f.value ?? '' }),
      });
    });
    return fields;
  }

  async list(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ExternalItem[]> {
    if (this.#list && !options.force && Date.now() - this.#list.at < LIST_MS)
      return this.#list.items;
    const raw = await this.#items(options.signal);
    // The list carries every password; only what's safe to show is kept.
    const items = raw
      .filter((i) => BW_ID.test(i.id))
      .map((i): ExternalItem => {
        const type: VaultItemType =
          i.type === 2 ? 'note' : i.type === 3 ? 'card' : i.type === 4 ? 'identity' : 'login';
        const subtitle =
          i.login?.username ||
          (i.card?.number ? `•••• ${i.card.number.slice(-4)}` : '') ||
          i.identity?.email ||
          '';
        return {
          ref: `bw_${i.id}`,
          type,
          title: i.name?.trim() || 'Untitled',
          subtitle,
          urls: (i.login?.uris ?? []).map((u) => u.uri ?? '').filter((u) => siteOf(u)),
          tags: [],
          favorite: Boolean(i.favorite),
          totp: Boolean(i.login?.totp),
          ...(i.revisionDate && { updatedAt: Date.parse(i.revisionDate) || undefined }),
          fields: this.#fieldsOf(i),
          notes: type === 'note' ? '' : (i.notes ?? ''),
        };
      });
    this.#list = { items, at: Date.now() };
    return items;
  }

  async fields(ref: string) {
    const item = (await this.list()).find((i) => i.ref === ref);
    if (!item) throw new SourceError('That Bitwarden item isn’t there any more.');
    return { fields: item.fields ?? [], notes: item.notes ?? '' };
  }

  async #get(ref: string, signal?: AbortSignal): Promise<BwItem> {
    const id = ref.replace(/^bw_/, '');
    if (!BW_ID.test(id)) throw new SourceError('That Bitwarden item isn’t known.');
    const result = await this.#bw(['get', 'item', id], {}, signal);
    if (result.code !== 0)
      throw new SourceError(firstLine(result.stderr) || 'Bitwarden didn’t answer.');
    return JSON.parse(result.stdout) as BwItem;
  }

  async value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string> {
    const item = await this.#get(ref, signal);
    const custom = /^custom(\d+)$/.exec(fieldId);
    const value =
      fieldId === 'password'
        ? item.login?.password
        : fieldId === 'cardNumber'
          ? item.card?.number
          : fieldId === 'username'
            ? item.login?.username
            : fieldId === 'totp'
              ? item.login?.totp
              : custom
                ? item.fields?.[Number(custom[1])]?.value
                : undefined;
    if (!value) throw new SourceError('That field is empty in Bitwarden.');
    return value;
  }

  async full(ref: string, signal?: AbortSignal): Promise<FullItem> {
    const item = await this.#get(ref, signal);
    const fields: FullItem['fields'] = [];
    const add = (f: Omit<ExternalField, 'value'>, value: string | null | undefined) => {
      if (value) fields.push({ ...f, value });
    };
    add(
      { id: 'username', label: 'Username', kind: 'text', role: 'username' },
      item.login?.username,
    );
    add(
      { id: 'password', label: 'Password', kind: 'secret', role: 'password' },
      item.login?.password,
    );
    add({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp' }, item.login?.totp);
    const c = item.card;
    add(
      { id: 'cardholder', label: 'Name on card', kind: 'text', role: 'cardholder' },
      c?.cardholderName,
    );
    add({ id: 'cardNumber', label: 'Number', kind: 'secret', role: 'cardNumber' }, c?.number);
    add(
      { id: 'expiry', label: 'Expires', kind: 'monthYear', role: 'expiry' },
      c?.expMonth && c.expYear ? `${String(c.expMonth).padStart(2, '0')}/${c.expYear}` : '',
    );
    add({ id: 'cvv', label: 'Security code', kind: 'pin', role: 'cvv' }, c?.code);
    const i = item.identity;
    add({ id: 'firstName', label: 'First name', kind: 'text', role: 'firstName' }, i?.firstName);
    add({ id: 'lastName', label: 'Last name', kind: 'text', role: 'lastName' }, i?.lastName);
    add({ id: 'email', label: 'Email', kind: 'email', role: 'email' }, i?.email);
    (item.fields ?? []).forEach((f, n) => {
      if (f.name)
        add(
          { id: `custom${n}`, label: f.name.slice(0, 80), kind: f.type === 1 ? 'secret' : 'text' },
          f.value,
        );
    });
    const passkeys = (item.login?.fido2Credentials ?? [])
      .map(fromBitwarden)
      .filter((p): p is PasskeyInput => Boolean(p));
    return { fields, notes: item.notes ?? '', ...(passkeys.length && { passkeys }) };
  }

  async totp(ref: string, signal?: AbortSignal): Promise<string> {
    const id = ref.replace(/^bw_/, '');
    if (!BW_ID.test(id)) throw new SourceError('That Bitwarden item isn’t known.');
    const result = await this.#bw(['get', 'totp', id], {}, signal);
    const code = result.stdout.trim();
    if (result.code !== 0 || !/^\d{6,8}$/.test(code))
      throw new SourceError('That item has no one-time code.');
    return code;
  }
}

// ── KeePassXC ───────────────────────────────────────────────────────────────

/**
 * A KeePassXC database through `keepassxc-cli`. Its password is typed once
 * and kept in memory (the CLI asks for it on every call, on stdin).
 */
export class KeePassXcSource implements PasswordSource {
  readonly id = 'keepassxc' as const;
  readonly name = 'KeePassXC';
  readonly unlock = 'password' as const;
  readonly need = 'keepassxc';
  #password?: string;
  #paths = new Map<string, string>();
  /**
   * The list read (`export`) hands over every value anyway: they're kept in
   * memory while the database is unlocked, as its password already is, so
   * Show and Copy answer at once instead of running keepassxc-cli again
   * (which derives the database key each time, a second or more).
   */
  #values = new Map<string, { password?: string; totp?: string }>();
  #list?: { items: ExternalItem[]; at: number };

  constructor(
    private readonly database: () => Promise<string | undefined>,
    private readonly exec: Exec = realExec,
  ) {}

  /** `keepassxc-cli <command> [options] <database> [entry]`, the password on stdin. */
  async #cli(
    command: string,
    options: string[],
    entry: string[] = [],
    signal?: AbortSignal,
    password = this.#password,
  ) {
    const cli = await this.exec.find('keepassxc-cli');
    if (!cli) throw new SourceError('Install KeePassXC to see your KeePassXC items here.');
    const db = await this.database();
    if (!db) throw new SourceError('Choose your KeePassXC database first.');
    if (password === undefined) throw new SourceError('Unlock KeePassXC first.');
    return this.exec.run(cli, [command, ...options, db, ...entry], {
      input: `${password}\n`,
      timeout: 30_000,
      ...(signal && { signal }),
    });
  }

  async state(): Promise<Pick<VaultSource, 'state' | 'message'>> {
    if (!(await this.exec.find('keepassxc-cli')))
      return { state: 'missing', message: 'Needs KeePassXC.' };
    if (!(await this.database()))
      return { state: 'locked', message: 'Choose your KeePassXC database (.kdbx file).' };
    if (this.#password === undefined)
      return { state: 'locked', message: 'Unlock your KeePassXC database to see its items here.' };
    return { state: 'ready' };
  }

  async unlockWith(password: string): Promise<void> {
    const result = await this.#cli('ls', ['-q'], [], undefined, password);
    if (result.code !== 0)
      throw new SourceError(
        /invalid credentials|wrong key|HMAC/i.test(result.stderr)
          ? 'That isn’t the database’s password.'
          : firstLine(result.stderr) || 'KeePassXC wouldn’t open the database.',
      );
    this.#password = password;
    this.#list = undefined;
  }

  lock(): void {
    this.#password = undefined;
    this.#list = undefined;
    this.#paths.clear();
    this.#values.clear();
  }

  async list(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ExternalItem[]> {
    if (this.#list && !options.force && Date.now() - this.#list.at < LIST_MS)
      return this.#list.items;
    const result = await this.#cli('export', ['-q', '-f', 'csv'], [], options.signal);
    if (result.code !== 0)
      throw new SourceError(firstLine(result.stderr) || 'KeePassXC didn’t answer.');
    const [head, ...rows] = parseCsv(result.stdout);
    const col = (name: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase() === name);
    const [g, t, u, p, url, n, totp, modified] = [
      'group',
      'title',
      'username',
      'password',
      'url',
      'notes',
      'totp',
      'last modified',
    ].map(col);
    this.#paths.clear();
    this.#values.clear();
    const items = rows.map((r): ExternalItem => {
      const group = (r[g ?? -1] ?? '').replace(/^Root\/?/, '');
      const title = r[t ?? -1] ?? 'Untitled';
      const path = group ? `${group}/${title}` : title;
      const ref = `kp_${sha(path)}`;
      this.#paths.set(ref, path);
      this.#values.set(ref, {
        ...(r[p ?? -1] && { password: r[p ?? -1] }),
        ...(r[totp ?? -1] && { totp: r[totp ?? -1] }),
      });
      const fields: ExternalField[] = [];
      if (r[u ?? -1])
        fields.push({
          id: 'username',
          label: 'Username',
          kind: 'text',
          role: 'username',
          value: r[u ?? -1] ?? '',
        });
      if (r[p ?? -1])
        fields.push({ id: 'password', label: 'Password', kind: 'secret', role: 'password' });
      if (r[totp ?? -1])
        fields.push({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp' });
      return {
        ref,
        type: 'login',
        title,
        subtitle: r[u ?? -1] ?? '',
        urls: [r[url ?? -1] ?? ''].filter((x) => siteOf(x)),
        tags: group ? [group.split('/')[0] ?? group] : [],
        favorite: false,
        totp: Boolean(r[totp ?? -1]),
        ...(group && { container: group }),
        ...(Date.parse(r[modified ?? -1] ?? '') && {
          updatedAt: Date.parse(r[modified ?? -1] ?? ''),
        }),
        fields,
        notes: r[n ?? -1] ?? '',
      };
    });
    this.#list = { items, at: Date.now() };
    return items;
  }

  async fields(ref: string) {
    const item = (await this.list()).find((i) => i.ref === ref);
    if (!item) throw new SourceError('That KeePassXC entry isn’t there any more.');
    return { fields: item.fields ?? [], notes: item.notes ?? '' };
  }

  #path(ref: string): string {
    const path = this.#paths.get(ref);
    if (!path) throw new SourceError('That KeePassXC entry isn’t known.');
    return path;
  }

  async value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string> {
    const kept = this.#values.get(ref);
    if (fieldId === 'password' && kept?.password) return kept.password;
    if (fieldId === 'totp' && kept?.totp) return kept.totp;
    const attribute =
      fieldId === 'password'
        ? 'Password'
        : fieldId === 'username'
          ? 'UserName'
          : fieldId === 'totp'
            ? 'otp'
            : undefined;
    if (!attribute) throw new SourceError('That field isn’t known.');
    const result = await this.#cli(
      'show',
      ['-q', '-s', '-a', attribute],
      [this.#path(ref)],
      signal,
    );
    const value = result.stdout.replace(/\r?\n$/, '');
    if (result.code !== 0 || !value)
      throw new SourceError(firstLine(result.stderr) || 'That field is empty.');
    return value;
  }

  async totp(ref: string, signal?: AbortSignal): Promise<string> {
    const setup = this.#values.get(ref)?.totp;
    if (setup) {
      try {
        return totpNow(parseTotp(setup)).code;
      } catch {
        // Not a setup Conch reads: ask KeePassXC for the code.
      }
    }
    const result = await this.#cli('show', ['-q', '-t'], [this.#path(ref)], signal);
    const code = result.stdout.trim();
    if (result.code !== 0 || !/^\d{6,8}$/.test(code))
      throw new SourceError('That entry has no one-time code.');
    return code;
  }
}

// ── Proton Pass ─────────────────────────────────────────────────────────────

const PROTON_TYPES: Record<string, VaultItemType> = {
  login: 'login',
  alias: 'login',
  note: 'note',
  credit_card: 'card',
  identity: 'identity',
  ssh_key: 'sshKey',
  wifi: 'wifi',
  custom: 'note',
};

const PROTON_ID = /^[A-Za-z0-9_=-]{8,200}$/;

interface ProtonItem {
  item?: {
    content?: {
      title?: string;
      note?: string;
      content?: Record<string, Record<string, unknown> | null> | string;
      extra_fields?: { name?: string; content?: Record<string, unknown> }[];
    };
  };
}

/**
 * Proton Pass through `pass-cli`. You sign in once in a terminal
 * (`pass-cli login`); its session key stays in the system keychain, so
 * Conch never handles the Proton password. The item list carries no secrets
 * by design (`ItemSummary` in pass-cli); one item is read with `item view`.
 */
export class ProtonPassSource implements PasswordSource {
  readonly id = 'protonpass' as const;
  readonly name = 'Proton Pass';
  readonly unlock = 'app' as const;
  readonly need = 'pass-cli';
  #list?: { items: ExternalItem[]; at: number };
  /** ref → share and item ids, from the last list. */
  #ids = new Map<string, { share: string; item: string }>();

  constructor(private readonly exec: Exec = realExec) {}

  async #cli(args: string[], signal?: AbortSignal) {
    const cli = await this.exec.find('pass-cli');
    if (!cli)
      throw new SourceError('Install the Proton Pass command line tool to see your items here.');
    return this.exec.run(cli, args, {
      timeout: UNLOCK_WAIT_MS,
      env: agentEnv({ PROTON_PASS_NO_UPDATE_CHECK: '1' }),
      // Never left waiting at a prompt.
      input: '',
      ...(signal && { signal }),
    });
  }

  #explain(stderr: string): string {
    if (/authenticated client|not logged|login/i.test(stderr))
      return 'Sign in to Proton Pass once in a terminal with “pass-cli login”, then try again.';
    if (/locked/i.test(stderr))
      return 'Proton Pass is locked. Unlock it in a terminal with “pass-cli session unlock”.';
    return firstLine(stderr)
      ? `Proton Pass said: ${firstLine(stderr)}`
      : 'Proton Pass didn’t answer.';
  }

  async state(): Promise<Pick<VaultSource, 'state' | 'message'>> {
    if (!(await this.exec.find('pass-cli')))
      return { state: 'missing', message: 'Needs the Proton Pass command line tool.' };
    const result = await this.#cli(['vault', 'list', '--output', 'json']);
    if (result.code !== 0) return { state: 'locked', message: this.#explain(result.stderr) };
    return { state: 'ready' };
  }

  async list(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ExternalItem[]> {
    if (this.#list && !options.force && Date.now() - this.#list.at < LIST_MS)
      return this.#list.items;
    const vaults = await this.#cli(['vault', 'list', '--output', 'json'], options.signal);
    if (vaults.code !== 0) throw new SourceError(this.#explain(vaults.stderr));
    let shares: { name?: string; share_id?: string }[];
    try {
      shares = (JSON.parse(vaults.stdout) as { vaults?: typeof shares }).vaults ?? [];
    } catch {
      throw new SourceError('Proton Pass answered with something Conch couldn’t read.');
    }
    const items: ExternalItem[] = [];
    this.#ids.clear();
    for (const share of shares) {
      if (!share.share_id || !PROTON_ID.test(share.share_id)) continue;
      const result = await this.#cli(
        ['item', 'list', '--share-id', share.share_id, '--output', 'json'],
        options.signal,
      );
      if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
      const listed =
        (
          JSON.parse(result.stdout) as {
            items?: {
              id?: string;
              share_id?: string;
              title?: string;
              item_type?: string;
              state?: string;
              modify_time?: string;
            }[];
          }
        ).items ?? [];
      for (const i of listed) {
        if (!i.id || !PROTON_ID.test(i.id) || /trash/i.test(i.state ?? '')) continue;
        const ref = `pp_${sha(`${share.share_id}/${i.id}`)}`;
        this.#ids.set(ref, { share: share.share_id, item: i.id });
        items.push({
          ref,
          type: PROTON_TYPES[i.item_type ?? ''] ?? 'login',
          title: i.title?.trim() || 'Untitled',
          // Usernames and sites aren't in the list; they come with the item.
          subtitle: '',
          urls: [],
          tags: [],
          favorite: false,
          totp: false,
          ...(share.name && { container: share.name }),
          ...(i.modify_time && { updatedAt: Date.parse(`${i.modify_time}Z`) || undefined }),
        });
      }
    }
    this.#list = { items, at: Date.now() };
    return items;
  }

  async #view(ref: string, signal?: AbortSignal): Promise<ProtonItem> {
    const ids = this.#ids.get(ref);
    if (!ids) throw new SourceError('That Proton Pass item isn’t known.');
    const result = await this.#cli(
      ['item', 'view', '--share-id', ids.share, '--item-id', ids.item, '--output', 'json'],
      signal,
    );
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    try {
      return JSON.parse(result.stdout) as ProtonItem;
    } catch {
      throw new SourceError('Proton Pass answered with something Conch couldn’t read.');
    }
  }

  /** Every field with its value; `fields` drops the concealed ones' values. */
  async full(ref: string, signal?: AbortSignal): Promise<FullItem> {
    const data = (await this.#view(ref, signal)).item?.content ?? {};
    const fields: FullItem['fields'] = [];
    const add = (f: Omit<ExternalField, 'value'>, value: unknown) => {
      if (typeof value === 'string' && value) fields.push({ ...f, value });
    };
    const content = typeof data.content === 'object' && data.content ? data.content : {};
    const login = content.Login ?? undefined;
    if (login) {
      add({ id: 'username', label: 'Username', kind: 'text', role: 'username' }, login.username);
      add({ id: 'email', label: 'Email', kind: 'email', role: 'email' }, login.email);
      add({ id: 'password', label: 'Password', kind: 'secret', role: 'password' }, login.password);
      add({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp' }, login.totp_uri);
    }
    const card = content.CreditCard ?? undefined;
    if (card) {
      add(
        { id: 'cardholder', label: 'Name on card', kind: 'text', role: 'cardholder' },
        card.cardholder_name,
      );
      add({ id: 'cardNumber', label: 'Number', kind: 'secret', role: 'cardNumber' }, card.number);
      add(
        { id: 'expiry', label: 'Expires', kind: 'monthYear', role: 'expiry' },
        protonExpiry(card.expiration_date),
      );
      add(
        { id: 'cvv', label: 'Security code', kind: 'pin', role: 'cvv' },
        card.verification_number,
      );
      add({ id: 'cardPin', label: 'PIN', kind: 'pin', role: 'cardPin' }, card.pin);
    }
    const identity = content.Identity ?? undefined;
    if (identity) {
      add(
        { id: 'fullName', label: 'Full name', kind: 'text', role: 'fullName' },
        identity.full_name,
      );
      add({ id: 'email', label: 'Email', kind: 'email', role: 'email' }, identity.email);
      add({ id: 'phone', label: 'Phone', kind: 'phone', role: 'phone' }, identity.phone_number);
    }
    const wifi = content.Wifi ?? undefined;
    if (wifi) {
      add({ id: 'ssid', label: 'Network name', kind: 'text', role: 'networkName' }, wifi.ssid);
      add({ id: 'password', label: 'Password', kind: 'secret', role: 'password' }, wifi.password);
    }
    const ssh = content.SshKey ?? undefined;
    if (ssh) {
      add(
        { id: 'privateKey', label: 'Private key', kind: 'secretText', role: 'privateKey' },
        ssh.private_key,
      );
      add(
        { id: 'publicKey', label: 'Public key', kind: 'multiline', role: 'publicKey' },
        ssh.public_key,
      );
    }
    (data.extra_fields ?? []).forEach((f, n) => {
      const [kind, value] = Object.entries(f.content ?? {})[0] ?? [];
      const mapped: VaultFieldKind =
        kind === 'Hidden' ? 'secret' : kind === 'Totp' ? 'totp' : 'text';
      if (f.name) add({ id: `extra${n}`, label: f.name.slice(0, 80), kind: mapped }, value);
    });
    return { fields, notes: data.note ?? '' };
  }

  async fields(ref: string, signal?: AbortSignal) {
    const { fields, notes } = await this.full(ref, signal);
    return {
      fields: fields.map(({ value, ...f }) => (isConcealedKind(f.kind) ? f : { ...f, value })),
      notes,
    };
  }

  async value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string> {
    const field = (await this.full(ref, signal)).fields.find((f) => f.id === fieldId);
    if (!field) throw new SourceError('That field is empty in Proton Pass.');
    return field.value;
  }

  async totp(ref: string, signal?: AbortSignal): Promise<string> {
    const setup = (await this.full(ref, signal)).fields.find((f) => f.kind === 'totp')?.value;
    if (!setup) throw new SourceError('That item has no one-time code.');
    return codeOf(setup);
  }
}

/** Proton writes card expiry as `YYYY-MM`. */
function protonExpiry(value: unknown): string {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  return m ? `${m[2]}/${m[1]}` : typeof value === 'string' ? value : '';
}

function isConcealedKind(kind: VaultFieldKind): boolean {
  return kind === 'secret' || kind === 'secretText' || kind === 'pin' || kind === 'totp';
}

/** The current code from a setup a manager handed over (it never leaves the gateway). */
function codeOf(setup: string): string {
  try {
    return totpNow(parseTotp(setup)).code;
  } catch {
    throw new SourceError('That item’s one-time code setup isn’t one Conch can use.');
  }
}

// ── Dashlane ────────────────────────────────────────────────────────────────

interface DashlaneCredential {
  id?: string;
  title?: string;
  login?: string;
  email?: string;
  secondaryLogin?: string;
  password?: string;
  url?: string;
  note?: string;
  otpSecret?: string;
  otpUrl?: string;
  category?: string;
  modificationDatetime?: string | number;
}

interface DashlaneNote {
  id?: string;
  title?: string;
  content?: string;
  category?: string;
  updateDate?: string | number;
}

const DL_ID = /^\{?[0-9A-Fa-f-]{36}\}?$/;

/**
 * Dashlane through `dcli`. You register this computer once in a terminal
 * (`dcli sync`); after that Dashlane keeps its master password in the
 * system keychain. If you turned that off, Conch asks for it once and passes
 * it in `DASHLANE_MASTER_PASSWORD`, kept in memory.
 *
 * `dcli` has no list without secrets: Conch reads the list and keeps only
 * names, accounts and sites; passwords are read again, one item at a time,
 * when they're used.
 */
export class DashlaneSource implements PasswordSource {
  readonly id = 'dashlane' as const;
  readonly name = 'Dashlane';
  readonly unlock = 'password' as const;
  readonly need = 'dcli';
  #password?: string;
  #list?: { items: ExternalItem[]; at: number };
  #ids = new Map<string, { id: string; note: boolean }>();

  constructor(private readonly exec: Exec = realExec) {}

  async #cli(args: string[], signal?: AbortSignal, password = this.#password) {
    const cli = await this.exec.find('dcli');
    if (!cli)
      throw new SourceError('Install the Dashlane command line tool to see your items here.');
    return this.exec.run(cli, args, {
      timeout: UNLOCK_WAIT_MS,
      env: agentEnv({
        ...(password !== undefined && { DASHLANE_MASTER_PASSWORD: password }),
        DCLI_DISABLE_AUTO_SYNC: '1',
      }),
      input: '',
      ...(signal && { signal }),
    });
  }

  async state(): Promise<Pick<VaultSource, 'state' | 'message'>> {
    if (!(await this.exec.find('dcli')))
      return { state: 'missing', message: 'Needs the Dashlane command line tool.' };
    const result = await this.#cli(['status']);
    const text = result.stdout;
    if (/Logged in:\s*No/i.test(text) || result.code !== 0)
      return {
        state: 'locked',
        message: 'Set up Dashlane once in a terminal with “dcli sync”, then come back.',
      };
    if (/Locked:\s*Yes/i.test(text) && this.#password === undefined)
      return {
        state: 'locked',
        message: 'Unlock Dashlane with its master password to see your items here.',
      };
    return { state: 'ready' };
  }

  async unlockWith(password: string): Promise<void> {
    const result = await this.#cli(
      ['note', '-o', 'json', 'title=conch-unlock-check'],
      undefined,
      password,
    );
    if (result.code !== 0)
      throw new SourceError(
        /password|decrypt/i.test(result.stderr)
          ? 'That isn’t your Dashlane master password.'
          : firstLine(result.stderr) || 'Dashlane wouldn’t unlock.',
      );
    this.#password = password;
    this.#list = undefined;
  }

  lock(): void {
    this.#password = undefined;
    this.#list = undefined;
    this.#ids.clear();
  }

  #explain(stderr: string): string {
    if (/lock|master password|not logged|register/i.test(stderr))
      return 'Dashlane is locked. Unlock it, then try again.';
    return firstLine(stderr) ? `Dashlane said: ${firstLine(stderr)}` : 'Dashlane didn’t answer.';
  }

  async #credentials(filter: string[] = [], signal?: AbortSignal): Promise<DashlaneCredential[]> {
    const result = await this.#cli(['password', '-o', 'json', ...filter], signal);
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    try {
      return JSON.parse(result.stdout || '[]') as DashlaneCredential[];
    } catch {
      throw new SourceError('Dashlane answered with something Conch couldn’t read.');
    }
  }

  async #notes(signal?: AbortSignal): Promise<DashlaneNote[]> {
    const result = await this.#cli(['note', '-o', 'json'], signal);
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    try {
      return JSON.parse(result.stdout || '[]') as DashlaneNote[];
    } catch {
      return [];
    }
  }

  #ref(id: string): string {
    return `dl_${id.replace(/[{}]/g, '').toLowerCase()}`;
  }

  async list(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ExternalItem[]> {
    if (this.#list && !options.force && Date.now() - this.#list.at < LIST_MS)
      return this.#list.items;
    // The list has every password in it: only names, accounts and sites are kept.
    const credentials = await this.#credentials([], options.signal);
    const notes = await this.#notes(options.signal);
    this.#ids.clear();
    const items: ExternalItem[] = [];
    for (const c of credentials) {
      if (!c.id || !DL_ID.test(c.id)) continue;
      const ref = this.#ref(c.id);
      this.#ids.set(ref, { id: c.id, note: false });
      const fields: ExternalField[] = [];
      if (c.login)
        fields.push({
          id: 'username',
          label: 'Username',
          kind: 'text',
          role: 'username',
          value: c.login,
        });
      if (c.email && c.email !== c.login)
        fields.push({ id: 'email', label: 'Email', kind: 'email', role: 'email', value: c.email });
      if (c.password)
        fields.push({ id: 'password', label: 'Password', kind: 'secret', role: 'password' });
      if (c.otpSecret || c.otpUrl)
        fields.push({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp' });
      items.push({
        ref,
        type: 'login',
        title: c.title?.trim() || siteOf(c.url ?? '') || 'Untitled',
        subtitle: c.login || c.email || '',
        urls: [c.url ?? ''].filter((u) => siteOf(u)),
        tags: c.category ? [c.category] : [],
        favorite: false,
        totp: Boolean(c.otpSecret || c.otpUrl),
        fields,
        // Dashlane's notes on a login can hold anything: read with the item, not kept here.
        notes: '',
        ...(c.modificationDatetime && { updatedAt: dashlaneTime(c.modificationDatetime) }),
      });
    }
    for (const n of notes) {
      if (!n.id || !DL_ID.test(n.id)) continue;
      const ref = this.#ref(n.id);
      this.#ids.set(ref, { id: n.id, note: true });
      items.push({
        ref,
        type: 'note',
        title: n.title?.trim() || 'Note',
        subtitle: '',
        urls: [],
        tags: n.category ? [n.category] : [],
        favorite: false,
        totp: false,
        fields: [{ id: 'content', label: 'Note', kind: 'secretText' }],
        notes: '',
        ...(n.updateDate && { updatedAt: dashlaneTime(n.updateDate) }),
      });
    }
    this.#list = { items, at: Date.now() };
    return items;
  }

  async fields(ref: string) {
    const item = (await this.list()).find((i) => i.ref === ref);
    if (!item) throw new SourceError('That Dashlane item isn’t there any more.');
    return { fields: item.fields ?? [], notes: '' };
  }

  async full(ref: string, signal?: AbortSignal): Promise<FullItem> {
    const ids = this.#ids.get(ref);
    if (!ids) throw new SourceError('That Dashlane item isn’t known.');
    if (ids.note) {
      const note = (await this.#notes(signal)).find((n) => n.id === ids.id);
      if (!note) throw new SourceError('That Dashlane note isn’t there any more.');
      return {
        fields: note.content
          ? [{ id: 'content', label: 'Note', kind: 'secretText', value: note.content }]
          : [],
        notes: '',
      };
    }
    const c = (await this.#credentials([`id=${ids.id}`], signal)).find((x) => x.id === ids.id);
    if (!c) throw new SourceError('That Dashlane item isn’t there any more.');
    const fields: FullItem['fields'] = [];
    if (c.login)
      fields.push({
        id: 'username',
        label: 'Username',
        kind: 'text',
        role: 'username',
        value: c.login,
      });
    if (c.email && c.email !== c.login)
      fields.push({ id: 'email', label: 'Email', kind: 'email', role: 'email', value: c.email });
    if (c.password)
      fields.push({
        id: 'password',
        label: 'Password',
        kind: 'secret',
        role: 'password',
        value: c.password,
      });
    const otp = c.otpUrl || c.otpSecret;
    if (otp)
      fields.push({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp', value: otp });
    return { fields, notes: c.note ?? '' };
  }

  async value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string> {
    const field = (await this.full(ref, signal)).fields.find((f) => f.id === fieldId);
    if (!field) throw new SourceError('That field is empty in Dashlane.');
    return field.value;
  }

  async totp(ref: string, signal?: AbortSignal): Promise<string> {
    const setup = (await this.full(ref, signal)).fields.find((f) => f.kind === 'totp')?.value;
    if (!setup) throw new SourceError('That item has no one-time code.');
    return codeOf(setup);
  }
}

function dashlaneTime(value: string | number): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  // Dashlane writes seconds.
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  return Date.parse(String(value)) || undefined;
}

// ── Keeper ──────────────────────────────────────────────────────────────────

const KEEPER_TYPES: Record<string, VaultItemType> = {
  login: 'login',
  bankCard: 'card',
  bankAccount: 'bank',
  encryptedNotes: 'note',
  sshKeys: 'sshKey',
  serverCredentials: 'server',
  databaseCredentials: 'database',
  wifiCredentials: 'wifi',
  address: 'identity',
  contact: 'identity',
  passport: 'document',
  driverLicense: 'document',
  birthCertificate: 'document',
  membership: 'document',
  softwareLicense: 'license',
  general: 'login',
  legacy: 'login',
};

const KEEPER_UID = /^[A-Za-z0-9_-]{16,32}$/;

interface KeeperField {
  type?: string;
  label?: string;
  value?: unknown[];
}

/**
 * Keeper through Keeper Commander (`keeper`). Best set up once in a terminal
 * with persistent login (`this-device persistent-login on`), so it opens
 * without a password; otherwise Conch asks for the master password once and
 * passes it in `KEEPER_PASSWORD`, kept in memory. `list` carries no secrets;
 * one record is read with `get`.
 */
export class KeeperSource implements PasswordSource {
  readonly id = 'keeper' as const;
  readonly name = 'Keeper';
  readonly unlock = 'password' as const;
  readonly need = 'keeper';
  #password?: string;
  #list?: { items: ExternalItem[]; at: number };
  #reachable?: { ok: boolean; message?: string; at: number };

  constructor(private readonly exec: Exec = realExec) {}

  async #cli(args: string[], signal?: AbortSignal, password = this.#password) {
    const cli = await this.exec.find('keeper');
    if (!cli) throw new SourceError('Install Keeper Commander to see your Keeper items here.');
    return this.exec.run(cli, ['--batch-mode', ...args], {
      timeout: UNLOCK_WAIT_MS,
      env: agentEnv(password !== undefined ? { KEEPER_PASSWORD: password } : {}),
      // Batch mode with nothing on stdin: it fails instead of waiting at a prompt.
      input: '',
      ...(signal && { signal }),
    });
  }

  #explain(stderr: string): string {
    if (/password|login|session|expired|two.?factor|device/i.test(stderr))
      return 'Keeper needs you to sign in. Set up persistent login in a terminal with “keeper shell” then “this-device persistent-login on”, or unlock it here.';
    return firstLine(stderr) ? `Keeper said: ${firstLine(stderr)}` : 'Keeper didn’t answer.';
  }

  async state(options: { force?: boolean } = {}): Promise<Pick<VaultSource, 'state' | 'message'>> {
    if (!(await this.exec.find('keeper')))
      return { state: 'missing', message: 'Needs Keeper Commander.' };
    // Keeper syncs on every command, so a working list is the check, remembered for a minute.
    if (!this.#reachable || options.force || Date.now() - this.#reachable.at > 60_000) {
      try {
        await this.list({ force: true });
        this.#reachable = { ok: true, at: Date.now() };
      } catch (error) {
        this.#reachable = { ok: false, message: (error as Error).message, at: Date.now() };
      }
    }
    return this.#reachable.ok
      ? { state: 'ready' }
      : { state: 'locked', ...(this.#reachable.message && { message: this.#reachable.message }) };
  }

  async unlockWith(password: string): Promise<void> {
    const result = await this.#cli(['list', '--format', 'json'], undefined, password);
    if (result.code !== 0 || !result.stdout.trim().startsWith('['))
      throw new SourceError(
        /password/i.test(result.stderr)
          ? 'That isn’t your Keeper master password.'
          : this.#explain(result.stderr),
      );
    this.#password = password;
    this.#list = undefined;
    this.#reachable = undefined;
  }

  lock(): void {
    this.#password = undefined;
    this.#list = undefined;
    this.#reachable = undefined;
  }

  async list(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ExternalItem[]> {
    if (this.#list && !options.force && Date.now() - this.#list.at < LIST_MS)
      return this.#list.items;
    const result = await this.#cli(['list', '--format', 'json'], options.signal);
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    let rows: { record_uid?: string; type?: string; title?: string; description?: string }[];
    try {
      rows = JSON.parse(result.stdout || '[]') as typeof rows;
    } catch {
      throw new SourceError(this.#explain(result.stderr || result.stdout));
    }
    const items = rows
      .filter((r) => r.record_uid && KEEPER_UID.test(r.record_uid))
      .map((r): ExternalItem => {
        // `description` is "login @ site" for logins: no secret in it.
        const [user, site] = (r.description ?? '').split(' @ ');
        return {
          ref: `kr_${r.record_uid}`,
          type: KEEPER_TYPES[r.type ?? ''] ?? 'login',
          title: r.title?.trim() || 'Untitled',
          subtitle: (r.type === 'login' || r.type === 'general' ? user : '')?.trim() ?? '',
          urls: [site?.trim() ?? ''].filter((u) => siteOf(u)),
          tags: [],
          favorite: false,
          totp: false,
        };
      });
    this.#list = { items, at: Date.now() };
    return items;
  }

  async #get(ref: string, signal?: AbortSignal) {
    const uid = ref.replace(/^kr_/, '');
    if (!KEEPER_UID.test(uid)) throw new SourceError('That Keeper record isn’t known.');
    const result = await this.#cli(['get', uid, '--format', 'json'], signal);
    if (result.code !== 0) throw new SourceError(this.#explain(result.stderr));
    try {
      return JSON.parse(result.stdout) as {
        type?: string;
        fields?: KeeperField[];
        custom?: KeeperField[];
        notes?: string;
        // Version 2 ("legacy") records.
        login?: string;
        password?: string;
        totp?: string;
      };
    } catch {
      throw new SourceError('Keeper answered with something Conch couldn’t read.');
    }
  }

  async full(ref: string, signal?: AbortSignal): Promise<FullItem> {
    const record = await this.#get(ref, signal);
    const fields: FullItem['fields'] = [];
    const passkeys: PasskeyInput[] = [];
    const add = (f: Omit<ExternalField, 'value'>, value: unknown) => {
      if (typeof value === 'string' && value && fields.length < 60) fields.push({ ...f, value });
    };
    if (record.login)
      add({ id: 'username', label: 'Username', kind: 'text', role: 'username' }, record.login);
    if (record.password)
      add({ id: 'password', label: 'Password', kind: 'secret', role: 'password' }, record.password);
    if (record.totp)
      add({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp' }, record.totp);
    [...(record.fields ?? []), ...(record.custom ?? [])].forEach((f, n) => {
      const v = f.value?.[0];
      const id = `${f.type ?? 'field'}${n}`.replace(/[^A-Za-z0-9_-]/g, '_');
      const label = (f.label || KEEPER_LABELS[f.type ?? ''] || f.type || 'Field').slice(0, 80);
      switch (f.type) {
        case 'login':
          return add({ id: 'username', label: 'Username', kind: 'text', role: 'username' }, v);
        case 'password':
          return add({ id: 'password', label: 'Password', kind: 'secret', role: 'password' }, v);
        case 'oneTimeCode':
        case 'otp':
          return add({ id: 'totp', label: 'One-time code', kind: 'totp', role: 'totp' }, v);
        case 'email':
          return add({ id, label, kind: 'email', role: 'email' }, v);
        case 'url':
          return;
        case 'secret':
        case 'pinCode':
          return add({ id, label, kind: f.type === 'pinCode' ? 'pin' : 'secret' }, v);
        case 'note':
        case 'multiline':
          return add({ id, label, kind: 'multiline' }, v);
        case 'paymentCard': {
          const c = (v ?? {}) as Record<string, string>;
          add(
            { id: 'cardNumber', label: 'Number', kind: 'secret', role: 'cardNumber' },
            c.cardNumber,
          );
          add(
            { id: 'expiry', label: 'Expires', kind: 'monthYear', role: 'expiry' },
            c.cardExpirationDate,
          );
          return add(
            { id: 'cvv', label: 'Security code', kind: 'pin', role: 'cvv' },
            c.cardSecurityCode,
          );
        }
        case 'bankAccount': {
          const b = (v ?? {}) as Record<string, string>;
          add(
            { id: 'accountNumber', label: 'Account number', kind: 'secret', role: 'accountNumber' },
            b.accountNumber,
          );
          return add(
            { id: 'routingNumber', label: 'Routing number', kind: 'text', role: 'routingNumber' },
            b.routingNumber,
          );
        }
        case 'name': {
          const p = (v ?? {}) as Record<string, string>;
          add({ id: 'firstName', label: 'First name', kind: 'text', role: 'firstName' }, p.first);
          return add(
            { id: 'lastName', label: 'Last name', kind: 'text', role: 'lastName' },
            p.last,
          );
        }
        case 'phone':
          return add(
            { id, label, kind: 'phone', role: 'phone' },
            (v as { number?: string })?.number,
          );
        case 'keyPair': {
          const k = (v ?? {}) as Record<string, string>;
          add(
            { id: 'privateKey', label: 'Private key', kind: 'secretText', role: 'privateKey' },
            k.privateKey,
          );
          return add(
            { id: 'publicKey', label: 'Public key', kind: 'multiline', role: 'publicKey' },
            k.publicKey,
          );
        }
        case 'host': {
          const h = (v ?? {}) as Record<string, string>;
          add({ id: 'host', label: 'Host', kind: 'text', role: 'host' }, h.hostName);
          return add({ id: 'port', label: 'Port', kind: 'text', role: 'port' }, h.port);
        }
        case 'passkey': {
          const p = keeperPasskey(v);
          if (p) passkeys.push(p);
          return;
        }
        default:
          if (typeof v === 'string') add({ id, label, kind: 'text' }, v);
      }
    });
    return { fields, notes: record.notes ?? '', ...(passkeys.length && { passkeys }) };
  }

  async fields(ref: string, signal?: AbortSignal) {
    const { fields, notes } = await this.full(ref, signal);
    return {
      fields: fields.map(({ value, ...f }) => (isConcealedKind(f.kind) ? f : { ...f, value })),
      notes,
    };
  }

  async value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string> {
    const field = (await this.full(ref, signal)).fields.find((f) => f.id === fieldId);
    if (!field) throw new SourceError('That field is empty in Keeper.');
    return field.value;
  }

  async totp(ref: string, signal?: AbortSignal): Promise<string> {
    const setup = (await this.full(ref, signal)).fields.find((f) => f.kind === 'totp')?.value;
    if (!setup) throw new SourceError('That record has no one-time code.');
    return codeOf(setup);
  }
}

const KEEPER_LABELS: Record<string, string> = {
  email: 'Email',
  secret: 'Secret',
  pinCode: 'PIN',
  note: 'Note',
  multiline: 'Notes',
  phone: 'Phone',
  text: 'Text',
  date: 'Date',
  licenseNumber: 'Licence number',
  accountNumber: 'Account number',
};

/** Keeper keeps a passkey's private key as a JWK; Chrome and Conch want PKCS#8. */
function keeperPasskey(value: unknown): PasskeyInput | undefined {
  const v = (value ?? {}) as {
    privateKey?: Record<string, unknown>;
    credentialId?: string;
    signCount?: number;
    userId?: string;
    relyingParty?: string;
    username?: string;
  };
  if (!v.privateKey || !v.credentialId || !v.relyingParty) return undefined;
  try {
    const der = createPrivateKey({ key: v.privateKey as JsonWebKey, format: 'jwk' }).export({
      type: 'pkcs8',
      format: 'der',
    });
    return {
      credentialId: Buffer.from(v.credentialId, 'base64url').toString('base64url'),
      rpId: v.relyingParty,
      ...(v.userId && { userHandle: Buffer.from(v.userId, 'base64url').toString('base64url') }),
      ...(v.username && { userName: v.username }),
      privateKey: der.toString('base64url'),
      signCount: v.signCount ?? 0,
    };
  } catch {
    return undefined;
  }
}

// ── macOS Keychain ──────────────────────────────────────────────────────────

/**
 * Keychain items that belong to apps, not to you: never listed. Conch's own
 * device key is first among them.
 */
const KEYCHAIN_HIDDEN =
  /^(conch vault|conch|com\.apple\.|apple|icloud|safari|chrome|chromium|brave|edge|microsoft|electron|claude|codex|openai|anthropic|github\.com|gh:|docker|node|npm|vscode|code -|slack|zoom|teams|1password|bitwarden|dashlane|keeper|proton|keepass|airport|wi-fi|com\.|org\.|io\.|net\.)|safe storage|keychain|oauth|token|credentials?$|\.(plist|db)$/i;

interface KeychainEntry {
  cls: 'inet' | 'genp';
  service: string;
  account: string;
  label: string;
  path?: string;
  protocol?: string;
  modified?: number;
}

/** `security dump-keychain` without `-d`: attributes only, no secrets, no prompts. */
export function parseKeychainDump(text: string): KeychainEntry[] {
  const out: KeychainEntry[] = [];
  let current: { cls?: string; attrs: Record<string, string> } | undefined;
  const flush = () => {
    if (!current?.cls) return;
    const a = current.attrs;
    if (current.cls === 'inet' && a.srvr)
      out.push({
        cls: 'inet',
        service: a.srvr,
        account: a.acct ?? '',
        label: a['0x00000007'] ?? a.srvr,
        ...(a.path && { path: a.path }),
        ...(a.ptcl && { protocol: a.ptcl }),
        ...(a.mdat && { modified: keychainTime(a.mdat) }),
      });
    else if (current.cls === 'genp' && a.svce)
      out.push({
        cls: 'genp',
        service: a.svce,
        account: a.acct ?? '',
        label: a['0x00000007'] ?? a.svce,
        ...(a.mdat && { modified: keychainTime(a.mdat) }),
      });
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('keychain: ')) {
      flush();
      current = { attrs: {} };
      continue;
    }
    const cls = /^class: "(\w{4})"/.exec(line);
    if (cls && current) {
      current.cls = cls[1];
      continue;
    }
    const attr = /^\s+(?:"(\w{4})"|(0x[0-9A-F]{8}) )<\w+>=(.*)$/.exec(line);
    if (attr && current) {
      const name = attr[1] ?? attr[2] ?? '';
      const raw = attr[3] ?? '';
      if (raw === '<NULL>') continue;
      const quoted = /"((?:[^"\\]|\\.)*)"(?:\\000)?$/.exec(raw);
      if (quoted) current.attrs[name] = (quoted[1] ?? '').replace(/\\000$/, '');
    }
  }
  flush();
  return out;
}

function keychainTime(value: string): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z/.exec(value);
  if (!m) return undefined;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

/**
 * The login keychain on a Mac, through `/usr/bin/security`. Listing reads
 * attributes only; a password is read with `find-*-password -w`, and macOS
 * asks you the first time (“security wants to use your confidential
 * information”) — that dialog is the keychain's own consent, not Conch's.
 *
 * Safari, the Passwords app and iCloud Keychain keep theirs in a keychain no
 * other app can read; Conch imports those from the Passwords app's export.
 */
export class KeychainSource implements PasswordSource {
  readonly id = 'keychain' as const;
  readonly name = 'macOS Keychain';
  readonly unlock = 'app' as const;
  #list?: { items: ExternalItem[]; at: number };
  #entries = new Map<string, KeychainEntry>();

  constructor(
    private readonly exec: Exec = realExec,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async state(): Promise<Pick<VaultSource, 'state' | 'message'>> {
    if (this.platform !== 'darwin')
      return { state: 'missing', message: 'The macOS Keychain is only on a Mac.' };
    return { state: 'ready' };
  }

  async list(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ExternalItem[]> {
    if (this.platform !== 'darwin') return [];
    if (this.#list && !options.force && Date.now() - this.#list.at < LIST_MS)
      return this.#list.items;
    const result = await this.exec.run('/usr/bin/security', ['dump-keychain'], {
      timeout: 30_000,
      ...(options.signal && { signal: options.signal }),
    });
    if (result.code !== 0)
      throw new SourceError(firstLine(result.stderr) || 'The keychain didn’t answer.');
    this.#entries.clear();
    const items: ExternalItem[] = [];
    for (const e of parseKeychainDump(result.stdout)) {
      if (e.cls === 'genp' && (KEYCHAIN_HIDDEN.test(e.service) || KEYCHAIN_HIDDEN.test(e.label)))
        continue;
      const ref = `kc_${sha(`${e.cls}\0${e.service}\0${e.account}`)}`;
      if (this.#entries.has(ref)) continue;
      this.#entries.set(ref, e);
      const site =
        e.cls === 'inet'
          ? `${e.protocol === 'http' ? 'http' : 'https'}://${e.service}${e.path ?? ''}`
          : '';
      items.push({
        ref,
        type: e.cls === 'inet' ? 'login' : 'apiKey',
        title: e.label || e.service,
        subtitle: e.account,
        urls: site && siteOf(site) ? [site] : [],
        tags: [],
        favorite: false,
        totp: false,
        container: e.cls === 'inet' ? 'Internet passwords' : 'Application passwords',
        ...(e.modified && { updatedAt: e.modified }),
        fields: [
          ...(e.account
            ? [
                {
                  id: 'username',
                  label: 'Account',
                  kind: 'text' as const,
                  role: 'username' as const,
                  value: e.account,
                },
              ]
            : []),
          { id: 'password', label: 'Password', kind: 'secret', role: 'password' },
        ],
        notes: '',
      });
    }
    this.#list = { items, at: Date.now() };
    return items;
  }

  async fields(ref: string) {
    const item = (await this.list()).find((i) => i.ref === ref);
    if (!item) throw new SourceError('That keychain item isn’t there any more.');
    return { fields: item.fields ?? [], notes: '' };
  }

  async value(ref: string, fieldId: string, signal?: AbortSignal): Promise<string> {
    const e = this.#entries.get(ref);
    if (!e) throw new SourceError('That keychain item isn’t known.');
    if (fieldId === 'username') return e.account;
    if (fieldId !== 'password') throw new SourceError('That field isn’t known.');
    // Names, not secrets, are on the command line; the password comes back on stdout.
    const args =
      e.cls === 'inet'
        ? ['find-internet-password', '-s', e.service, ...(e.account ? ['-a', e.account] : []), '-w']
        : ['find-generic-password', '-s', e.service, ...(e.account ? ['-a', e.account] : []), '-w'];
    const result = await this.exec.run('/usr/bin/security', args, {
      timeout: UNLOCK_WAIT_MS,
      ...(signal && { signal }),
    });
    const value = result.stdout.replace(/\n$/, '');
    if (result.code !== 0 || !value)
      throw new SourceError(
        /denied|canceled|cancelled|user interaction/i.test(result.stderr)
          ? 'The keychain wasn’t allowed to share that password.'
          : 'That keychain item has no password.',
      );
    return value;
  }

  async totp(): Promise<string> {
    throw new SourceError('Keychain items have no one-time codes.');
  }
}
