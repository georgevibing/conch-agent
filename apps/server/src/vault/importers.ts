/**
 * Bringing passwords in from wherever they were (ADR 0025). Each format is
 * recognised by its exact header row, as the apps write it:
 *
 * - Chrome / Edge / Brave: `name,url,username,password,note` (Chromium `password_csv_writer.cc`)
 * - Firefox: `url,username,password,httpRealm,formActionOrigin,guid,…` (`LoginExport.sys.mjs`)
 * - Safari / Apple Passwords: `Title,URL,Username,Password,Notes,OTPAuth`
 * - 1Password CSV: Title, Website, Username, Password, One-time password, Favorite, Archived, Tags, Notes
 * - Bitwarden CSV: `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp`
 * - Bitwarden JSON: `{ encrypted: false, folders, items }`, passkeys included (`login.fido2Credentials`)
 * - LastPass: `url,username,password,totp,extra,name,grouping,fav` (`http://sn` = a secure note)
 * - KeePassXC: `Group,Title,Username,Password,URL,Notes,TOTP,Icon,Last Modified,Created`
 * - Proton Pass: `type,name,url,autofillUrls,email,username,password,note,totp,createTime,modifyTime,vault`
 * - Dashlane: `username,username2,username3,title,password,note,url,category,otpSecret`
 *
 * Anything else with a recognisable username/password/url column comes in as
 * `generic`. The text is parsed in memory and never written anywhere but the
 * encrypted vault.
 */
import type { ImportFormat, VaultFieldKind, VaultFieldRole, VaultItemType } from '@conch/protocol';
import { siteOf, VAULT_LIMITS } from '@conch/protocol';

import { type BitwardenFido2, fromBitwarden, type PasskeyInput } from './passkeys';

/** One item read from a file, before it gets an id. */
export interface Imported {
  type: VaultItemType;
  title: string;
  fields: { label: string; kind: VaultFieldKind; role?: VaultFieldRole; value: string }[];
  urls: string[];
  notes: string;
  tags: string[];
  favorite: boolean;
  /** Passkeys the file carries (Bitwarden JSON), checked in `passkeys.ts`. */
  passkeys?: PasskeyInput[];
}

export class ImportError extends Error {}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

const NAMES: Record<Exclude<ImportFormat, 'auto'>, string> = {
  chrome: 'Chrome, Edge or Brave',
  safari: 'Safari or Apple Passwords',
  firefox: 'Firefox',
  'bitwarden-csv': 'Bitwarden',
  'bitwarden-json': 'Bitwarden',
  '1password-csv': '1Password',
  lastpass: 'LastPass',
  keepassxc: 'KeePassXC',
  proton: 'Proton Pass',
  dashlane: 'Dashlane',
  generic: 'a spreadsheet',
};

export function formatName(format: Exclude<ImportFormat, 'auto'>): string {
  return NAMES[format];
}

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

/** Which app wrote these headers. */
export function detectFormat(text: string): Exclude<ImportFormat, 'auto'> {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'bitwarden-json';
  const header = (parseCsv(trimmed.split(/\r?\n/, 1)[0] ?? '')[0] ?? []).map(norm);
  const has = (...names: string[]) => names.every((n) => header.includes(norm(n)));
  if (has('login_uri', 'login_username', 'login_password')) return 'bitwarden-csv';
  if (has('autofillUrls', 'vault')) return 'proton';
  if (has('extra', 'grouping', 'fav')) return 'lastpass';
  if (has('httpRealm', 'formActionOrigin')) return 'firefox';
  if (has('group', 'title', 'username', 'password', 'url', 'notes')) return 'keepassxc';
  if (has('username2', 'category')) return 'dashlane';
  if (has('title', 'url', 'username', 'password', 'otpauth')) return 'safari';
  if (has('title', 'website', 'username', 'password')) return '1password-csv';
  if (has('name', 'url', 'username', 'password')) return 'chrome';
  return 'generic';
}

function login(
  title: string,
  username: string,
  password: string,
  urls: string[],
  extra: Partial<Imported> & { totp?: string } = {},
): Imported {
  const fields: Imported['fields'] = [];
  if (username) fields.push({ label: 'Username', kind: 'text', role: 'username', value: username });
  if (password)
    fields.push({ label: 'Password', kind: 'secret', role: 'password', value: password });
  if (extra.totp)
    fields.push({ label: 'One-time code', kind: 'totp', role: 'totp', value: extra.totp });
  const cleanUrls = urls.map((u) => u.trim()).filter((u) => u && siteOf(u));
  return {
    type: 'login',
    title: (title || siteOf(cleanUrls[0] ?? '') || username || 'Login').slice(
      0,
      VAULT_LIMITS.maxTitle,
    ),
    fields,
    urls: cleanUrls.slice(0, VAULT_LIMITS.maxUrls),
    notes: extra.notes ?? '',
    tags: extra.tags ?? [],
    favorite: extra.favorite ?? false,
  };
}

function note(title: string, text: string, tags: string[] = []): Imported {
  return {
    type: 'note',
    title: (title || 'Note').slice(0, VAULT_LIMITS.maxTitle),
    fields: text ? [{ label: 'Note', kind: 'secretText', value: text }] : [],
    urls: [],
    notes: '',
    tags,
    favorite: false,
  };
}

const truthy = (v: string | undefined) => /^(1|true|yes|y)$/i.test((v ?? '').trim());
const tagsFrom = (v: string | undefined) =>
  (v ?? '')
    .split(/[,;/\\]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, VAULT_LIMITS.maxTags);

function rowsWithHeader(text: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const keys = head.map(norm);
  return rows.map((row) => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? ''])));
}

/** Bitwarden's `fields` column: one `name: value` per line. */
function customFields(text: string | undefined): Imported['fields'] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:]{1,80}):\s?(.*)$/s))
    .filter((m): m is RegExpMatchArray => Boolean(m?.[1]))
    .map((m) => ({ label: (m[1] ?? '').trim(), kind: 'text' as const, value: m[2] ?? '' }));
}

interface BitwardenItem {
  type?: number;
  name?: string;
  notes?: string | null;
  favorite?: boolean;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[] | null;
    fido2Credentials?: BitwardenFido2[] | null;
  } | null;
  card?: Record<string, string | null> | null;
  identity?: Record<string, string | null> | null;
  fields?: { name?: string | null; value?: string | null; type?: number }[] | null;
  folderId?: string | null;
}

function fromBitwardenJson(text: string): Imported[] {
  let data: {
    encrypted?: boolean;
    items?: BitwardenItem[];
    folders?: { id: string; name: string }[];
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new ImportError('That file isn’t valid JSON.');
  }
  if (data.encrypted)
    throw new ImportError(
      'That Bitwarden export is encrypted. Export again and choose “.json” (not “.json (Encrypted)”).',
    );
  const folders = new Map((data.folders ?? []).map((f) => [f.id, f.name]));
  return (data.items ?? []).map((item): Imported => {
    const tags =
      item.folderId && folders.get(item.folderId) ? [folders.get(item.folderId) ?? ''] : [];
    const extra = (item.fields ?? [])
      .filter((f) => f.name)
      .map((f) => ({
        label: (f.name ?? '').slice(0, VAULT_LIMITS.maxLabel),
        kind: (f.type === 1 ? 'secret' : 'text') as VaultFieldKind,
        value: f.value ?? '',
      }));
    if (item.type === 3 && item.card) {
      const c = item.card;
      const fields: Imported['fields'] = [
        { label: 'Name on card', kind: 'text', role: 'cardholder', value: c.cardholderName ?? '' },
        { label: 'Number', kind: 'secret', role: 'cardNumber', value: c.number ?? '' },
        {
          label: 'Expires',
          kind: 'monthYear',
          role: 'expiry',
          value:
            c.expMonth && c.expYear ? `${String(c.expMonth).padStart(2, '0')}/${c.expYear}` : '',
        },
        { label: 'Security code', kind: 'pin', role: 'cvv', value: c.code ?? '' },
      ];
      return {
        type: 'card',
        title: item.name ?? 'Card',
        fields: [...fields, ...extra].filter((f) => f.value),
        urls: [],
        notes: item.notes ?? '',
        tags,
        favorite: Boolean(item.favorite),
      };
    }
    if (item.type === 4 && item.identity) {
      const i = item.identity;
      const fields: Imported['fields'] = [
        { label: 'First name', kind: 'text', role: 'firstName', value: i.firstName ?? '' },
        { label: 'Last name', kind: 'text', role: 'lastName', value: i.lastName ?? '' },
        { label: 'Email', kind: 'email', role: 'email', value: i.email ?? '' },
        { label: 'Phone', kind: 'phone', role: 'phone', value: i.phone ?? '' },
        {
          label: 'Address',
          kind: 'multiline',
          role: 'address',
          value: [i.address1, i.address2, i.city, i.state, i.postalCode, i.country]
            .filter(Boolean)
            .join('\n'),
        },
      ];
      return {
        type: 'identity',
        title: item.name ?? 'Identity',
        fields: [...fields, ...extra].filter((f) => f.value),
        urls: [],
        notes: item.notes ?? '',
        tags,
        favorite: Boolean(item.favorite),
      };
    }
    if (item.type === 2 || !item.login) {
      const n = note(item.name ?? 'Note', item.notes ?? '', tags);
      return { ...n, fields: [...n.fields, ...extra], favorite: Boolean(item.favorite) };
    }
    const l = item.login;
    const imported = login(
      item.name ?? '',
      l.username ?? '',
      l.password ?? '',
      (l.uris ?? []).map((u) => u.uri ?? ''),
      {
        totp: l.totp ?? undefined,
        notes: item.notes ?? '',
        tags,
        favorite: Boolean(item.favorite),
      },
    );
    const passkeys = (l.fido2Credentials ?? [])
      .map(fromBitwarden)
      .filter((p): p is PasskeyInput => Boolean(p));
    return {
      ...imported,
      fields: [...imported.fields, ...extra],
      ...(passkeys.length && { passkeys }),
    };
  });
}

/** Everything in a file, as items. Throws `ImportError` in words. */
export function parseImport(
  text: string,
  requested: ImportFormat = 'auto',
): { format: Exclude<ImportFormat, 'auto'>; items: Imported[]; skipped: number } {
  const format = requested === 'auto' ? detectFormat(text) : requested;
  let items: Imported[];
  if (format === 'bitwarden-json') items = fromBitwardenJson(text);
  else {
    const rows = rowsWithHeader(text);
    if (!rows.length) throw new ImportError('That file has nothing in it Conch can read.');
    const g = (r: Record<string, string>, ...names: string[]) => {
      for (const n of names) {
        const v = r[norm(n)];
        if (v) return v;
      }
      return '';
    };
    items = rows.map((r): Imported => {
      switch (format) {
        case 'chrome':
          return login(g(r, 'name'), g(r, 'username'), g(r, 'password'), [g(r, 'url')], {
            notes: g(r, 'note'),
          });
        case 'firefox':
          return login('', g(r, 'username'), g(r, 'password'), [g(r, 'url', 'origin')]);
        case 'safari':
          return login(g(r, 'title'), g(r, 'username'), g(r, 'password'), [g(r, 'url')], {
            notes: g(r, 'notes'),
            totp: g(r, 'otpauth'),
          });
        case '1password-csv':
          return login(
            g(r, 'title'),
            g(r, 'username'),
            g(r, 'password'),
            [g(r, 'website', 'url')],
            {
              notes: g(r, 'notes'),
              totp: g(r, 'one-time password', 'otp', 'onetimepassword'),
              tags: tagsFrom(g(r, 'tags')),
              favorite: truthy(g(r, 'favorite')),
            },
          );
        case 'bitwarden-csv': {
          const tags = tagsFrom(g(r, 'folder'));
          if (g(r, 'type') === 'note') {
            const n = note(g(r, 'name'), g(r, 'notes'), tags);
            return { ...n, fields: [...n.fields, ...customFields(g(r, 'fields'))] };
          }
          const imported = login(
            g(r, 'name'),
            g(r, 'login_username'),
            g(r, 'login_password'),
            g(r, 'login_uri').split(/[\n,]/),
            {
              notes: g(r, 'notes'),
              totp: g(r, 'login_totp'),
              tags,
              favorite: truthy(g(r, 'favorite')),
            },
          );
          return { ...imported, fields: [...imported.fields, ...customFields(g(r, 'fields'))] };
        }
        case 'lastpass': {
          const tags = tagsFrom(g(r, 'grouping'));
          if (g(r, 'url') === 'http://sn') return note(g(r, 'name'), g(r, 'extra'), tags);
          return login(g(r, 'name'), g(r, 'username'), g(r, 'password'), [g(r, 'url')], {
            notes: g(r, 'extra'),
            totp: g(r, 'totp'),
            tags,
            favorite: truthy(g(r, 'fav')),
          });
        }
        case 'keepassxc':
          return login(g(r, 'title'), g(r, 'username'), g(r, 'password'), [g(r, 'url')], {
            notes: g(r, 'notes'),
            totp: g(r, 'totp'),
            tags: tagsFrom(g(r, 'group')).filter((t) => t.toLowerCase() !== 'root'),
          });
        case 'proton': {
          const tags = tagsFrom(g(r, 'vault'));
          if (g(r, 'type') === 'note') return note(g(r, 'name'), g(r, 'note'), tags);
          return login(
            g(r, 'name'),
            g(r, 'username') || g(r, 'email'),
            g(r, 'password'),
            [g(r, 'url'), ...g(r, 'autofillUrls').split(/[\n,]/)],
            { notes: g(r, 'note'), totp: g(r, 'totp'), tags },
          );
        }
        case 'dashlane':
          return login(g(r, 'title'), g(r, 'username'), g(r, 'password'), [g(r, 'url')], {
            notes: g(r, 'note'),
            totp: g(r, 'otpUrl', 'otpSecret'),
            tags: tagsFrom(g(r, 'category')),
          });
        default:
          return login(
            g(r, 'title', 'name', 'account'),
            g(r, 'username', 'user', 'login', 'email'),
            g(r, 'password', 'pass', 'pwd'),
            [g(r, 'url', 'website', 'site', 'uri', 'address')],
            { notes: g(r, 'notes', 'note', 'comments') },
          );
      }
    });
  }
  const kept = items.filter((i) => i.fields.some((f) => f.value) || i.notes);
  if (kept.length > VAULT_LIMITS.maxImport)
    throw new ImportError(
      `That file has more than ${VAULT_LIMITS.maxImport} items. Split it and import each part.`,
    );
  return { format, items: kept, skipped: items.length - kept.length };
}

/** RFC 4180 output, for "Export as CSV" (Bitwarden-style columns most apps import). */
export function toCsv(rows: string[][]): string {
  // Values go out exactly as they are: a password starting with "=" must import
  // into the next password manager unchanged. The export dialog says not to
  // open the file in a spreadsheet (which would also run formulas).
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
