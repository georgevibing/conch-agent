/**
 * Passwords: Conch's own vault, and the password managers it can read
 * (ADR 0025).
 *
 * The browser sees what an item is (its name, the account, the sites it's
 * for, whether its password is weak) but never a secret value unless it asks
 * for one field on purpose (`reveal`), which needs a recent sign-in from
 * anywhere but this computer. The agent never sees values at all: it names an
 * item and Conch fills it in.
 */
import { z } from 'zod';

import { Id } from './common';

// ── What can be stored ──────────────────────────────────────────────────────

/**
 * The kinds of thing people keep. Each has a template of fields
 * (`VAULT_TEMPLATES`); any item can add its own fields too.
 */
export const VaultItemType = z.enum([
  'login',
  'card',
  'identity',
  'note',
  'apiKey',
  'wifi',
  'bank',
  'sshKey',
  'server',
  'database',
  'document',
  'license',
  'wallet',
]);
export type VaultItemType = z.infer<typeof VaultItemType>;

/**
 * How a field is shown and checked. `secret`, `totp`, `pin` and
 * `secretText` are concealed: their values only leave the gateway through
 * `reveal`, a copy, or a fill the agent asks for.
 */
export const VaultFieldKind = z.enum([
  'text',
  'multiline',
  'secret',
  'secretText',
  'pin',
  'totp',
  'url',
  'email',
  'phone',
  'date',
  'monthYear',
  'number',
]);
export type VaultFieldKind = z.infer<typeof VaultFieldKind>;

export const CONCEALED_KINDS: ReadonlySet<VaultFieldKind> = new Set([
  'secret',
  'secretText',
  'pin',
  'totp',
]);

export function isConcealed(kind: VaultFieldKind): boolean {
  return CONCEALED_KINDS.has(kind);
}

/**
 * What a field means, so Conch can fill a sign-in form, show the right line
 * under a name, or check a password's health — whatever the field is called.
 */
export const VaultFieldRole = z.enum([
  'username',
  'password',
  'totp',
  'cardholder',
  'cardNumber',
  'expiry',
  'cvv',
  'cardPin',
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'address',
  'birthday',
  'apiKey',
  'secretKey',
  'token',
  'networkName',
  'accountNumber',
  'routingNumber',
  'iban',
  'swift',
  'privateKey',
  'publicKey',
  'passphrase',
  'host',
  'port',
  'database',
  'documentNumber',
  'issuedOn',
  'expiresOn',
  'licenseKey',
  'recoveryPhrase',
  'address2',
]);
export type VaultFieldRole = z.infer<typeof VaultFieldRole>;

export const VAULT_LIMITS = {
  /** Items in Conch's own vault. */
  maxItems: 20_000,
  maxFields: 60,
  maxTitle: 200,
  maxLabel: 80,
  /** One field's value; an SSH key or a recovery phrase fits easily. */
  maxValue: 20_000,
  maxNotes: 50_000,
  maxUrls: 20,
  maxTags: 20,
  maxTag: 40,
  /** Old passwords kept per item. */
  maxHistory: 10,
  /** Days a deleted item waits in Recently deleted. */
  trashDays: 30,
  /** Rows in one import. */
  maxImport: 20_000,
} as const;

export const VaultField = z.object({
  id: Id,
  label: z.string().trim().min(1).max(VAULT_LIMITS.maxLabel),
  kind: VaultFieldKind,
  role: VaultFieldRole.optional(),
  value: z.string().max(VAULT_LIMITS.maxValue),
});
export type VaultField = z.infer<typeof VaultField>;

/** A field as the browser sees it: concealed values stay behind. */
export const VaultFieldView = z.object({
  id: Id,
  label: z.string(),
  kind: VaultFieldKind,
  role: VaultFieldRole.optional(),
  /** The value, for fields that aren't concealed. */
  value: z.string().optional(),
  /** For concealed fields: whether there's anything to reveal. */
  filled: z.boolean(),
  /** For passwords: how strong it is, 0 (very weak) to 4 (very strong). */
  strength: z.number().int().min(0).max(4).optional(),
});
export type VaultFieldView = z.infer<typeof VaultFieldView>;

/** Sites a login belongs to; Conch fills it only on these (and asks first elsewhere). */
export const VaultUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((u) => !/^\s*(javascript|data|vbscript|file):/i.test(u), 'That isn’t a web address.');

const Tag = z.string().trim().min(1).max(VAULT_LIMITS.maxTag);

// ── Where items come from ───────────────────────────────────────────────────

/**
 * `conch`: Conch's own vault. `system`: the keys Conch itself uses (provider
 * keys, integration and channel tokens), shown read-only and changed where
 * they're used. The rest are password managers Conch reads
 * through their own app or command line; their items are shown alongside, read
 * only, and their values are fetched only when used.
 */
export const VaultSourceId = z.enum([
  'conch',
  'system',
  '1password',
  'bitwarden',
  'keepassxc',
  'protonpass',
  'dashlane',
  'keeper',
  'keychain',
]);
export type VaultSourceId = z.infer<typeof VaultSourceId>;

export const VaultSourceState = z.enum([
  /** Ready. */
  'ready',
  /** Installed but locked, or signed out: one step from ready. */
  'locked',
  /** Its app or command line isn't on this computer. */
  'missing',
  /** Something went wrong; `message` says what. */
  'error',
  /** Turned off in Passwords › Sources. */
  'off',
]);
export type VaultSourceState = z.infer<typeof VaultSourceState>;

export const VaultSource = z.object({
  id: VaultSourceId,
  name: z.string(),
  state: VaultSourceState,
  /** One plain sentence when it isn't ready, and what to do. */
  message: z.string().optional(),
  /** Items it holds (when it can say). */
  count: z.number().int().nonnegative().optional(),
  /** Conch can add, edit and delete its items. */
  writable: z.boolean(),
  /** Conch can copy its own items into it (Copy to, ADR 0062): it makes new items, nothing else. */
  accepts: z.boolean().optional(),
  /** Where a copy can go in it (1Password's vaults), from what it last listed. */
  places: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  /** Set when Conch can get what it needs for this source (ADR 0016). */
  need: z.string().optional(),
  /** What unlocking takes: nothing (it asks itself, e.g. Touch ID) or a password typed here. */
  unlock: z.enum(['none', 'app', 'password']).default('none'),
  /** `false`: it can't work on this computer (the macOS Keychain off a Mac), so it isn't offered. */
  available: z.boolean().optional(),
  /** When its items were last read. */
  syncedAt: z.number().optional(),
  /** Kept unlocked on this computer: it opens by itself when Conch starts. */
  keptUnlocked: z.boolean().optional(),
  /** KeePassXC: the database file chosen. */
  database: z.string().optional(),
  /** KeePassXC: its key file, if it needs one. */
  keyFile: z.string().optional(),
  /**
   * 1Password: how Conch reaches it. `app`: the 1Password app on this computer
   * (its CLI integration). `service-account`: a service account's token,
   * saved sealed in Conch, for a computer without the app (a server). The
   * token itself is never sent back.
   */
  access: z
    .object({
      mode: z.enum(['app', 'service-account']),
      /** Service account: the vaults it can read (names only), from its last look. */
      vaults: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
      /** Service account: the vaults Conch shows. Absent: every one it can read. */
      shown: z.array(z.string()).optional(),
    })
    .optional(),
  /** Its items are copied into Conch's vault and kept up to date (`VaultTransferBody.keepSynced`). */
  sync: z
    .object({
      enabled: z.boolean(),
      /** Last time the copies were brought up to date. */
      at: z.number().optional(),
      /** Items copied from it that are in Conch's vault. */
      copies: z.number().int().nonnegative(),
      /** One sentence when the last update didn't go through. */
      problem: z.string().optional(),
    })
    .optional(),
});
export type VaultSource = z.infer<typeof VaultSource>;

// ── Passkeys ────────────────────────────────────────────────────────────────

/**
 * A passkey (WebAuthn discoverable credential) kept with a login. The private
 * key never leaves the gateway except into Conch's own browser, for one
 * sign-in on its own site after the person agreed (ADR 0025 § Passkeys).
 */
export const VaultPasskey = z.object({
  id: Id,
  /** The credential id, base64url. */
  credentialId: z.string().regex(/^[A-Za-z0-9_-]{16,1400}$/),
  /** The site it belongs to (WebAuthn relying party id), e.g. `github.com`. */
  rpId: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$/),
  /** The site's id for the account, base64url. */
  userHandle: z
    .string()
    .regex(/^[A-Za-z0-9_-]{0,700}$/)
    .optional(),
  /** The account's name as the site gave it. */
  userName: z.string().max(200).optional(),
  /** ES256 private key, PKCS#8 DER, base64url. */
  privateKey: z.string().regex(/^[A-Za-z0-9_-]{40,4000}$/),
  signCount: z.number().int().nonnegative().default(0),
  createdAt: z.number(),
  usedAt: z.number().optional(),
});
export type VaultPasskey = z.infer<typeof VaultPasskey>;

/** A passkey as the browser sees it: never its key. */
export const VaultPasskeyView = z.object({
  id: Id,
  rpId: z.string(),
  userName: z.string().optional(),
  createdAt: z.number(),
  usedAt: z.number().optional(),
});
export type VaultPasskeyView = z.infer<typeof VaultPasskeyView>;

// ── Health ──────────────────────────────────────────────────────────────────

export const VaultProblem = z.enum([
  /** Easy to guess. */
  'weak',
  /** The same password is used on another item. */
  'reused',
  /** Seen in a data breach (Have I Been Pwned, checked anonymously). */
  'compromised',
  /** The site supports two-factor sign-in and this item has no code. */
  'no2fa',
  /** A login for a plain http:// site. */
  'insecure',
  /** A card or document past its expiry date. */
  'expired',
]);
export type VaultProblem = z.infer<typeof VaultProblem>;

// ── Items ───────────────────────────────────────────────────────────────────

/** One item in a list: enough to find it and see what needs attention. */
export const VaultItemSummary = z.object({
  /** Unique across sources: `conch:…`, `1password:…`. */
  id: z.string().min(1).max(300),
  source: VaultSourceId,
  type: VaultItemType,
  title: z.string(),
  /** The quiet second line: the username, `•••• 4242`, an email. */
  subtitle: z.string().default(''),
  /** Hostnames, for the icon and for matching a site. */
  domains: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  /** Has a one-time code. */
  totp: z.boolean().default(false),
  /** Has a passkey. */
  passkey: z.boolean().default(false),
  problems: z.array(VaultProblem).default([]),
  /** Where it sits in its own app ("Personal" vault, a folder), for external items. */
  container: z.string().optional(),
  readOnly: z.boolean().default(false),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  /** Last time it was used (copied, filled, given to an integration). */
  usedAt: z.number().optional(),
  /** Set while it's in Recently deleted. */
  deletedAt: z.number().optional(),
});
export type VaultItemSummary = z.infer<typeof VaultItemSummary>;

export const VaultItemDetail = VaultItemSummary.extend({
  fields: z.array(VaultFieldView),
  urls: z.array(z.string()).default([]),
  notes: z.string().default(''),
  /** How many earlier passwords are kept. */
  history: z.number().int().nonnegative().default(0),
  /** Where Conch uses it: "OpenRouter key", "Notion integration". */
  usedBy: z.array(z.string()).default([]),
  /** Sites the agent may fill it on without asking (beyond its own). */
  allowedSites: z.array(z.string()).default([]),
  /** The agent may use it at all. */
  agentAccess: z.enum(['ask', 'allow', 'never']).default('ask'),
  /** The agent may read a value itself (a note, a PIN), with your OK each time or without asking. */
  agentRead: z.enum(['ask', 'allow']).default('ask'),
  passkeys: z.array(VaultPasskeyView).default([]),
  /** A copy of an item in another password manager, kept up to date from it. */
  origin: z
    .object({
      source: VaultSourceId,
      /** Kept up to date while that manager's sync is on; edits here stop it for this item. */
      syncing: z.boolean(),
      syncedAt: z.number().optional(),
    })
    .optional(),
  /** Where to change it, for `system` items. */
  manage: z
    .object({ label: z.string(), place: z.string(), focus: z.string().optional() })
    .optional(),
});
export type VaultItemDetail = z.infer<typeof VaultItemDetail>;

/** Fields as typed in the editor. Ids are kept for existing fields so history follows them. */
export const VaultFieldInput = z.object({
  id: Id.optional(),
  label: z.string().trim().min(1).max(VAULT_LIMITS.maxLabel),
  kind: VaultFieldKind,
  role: VaultFieldRole.optional(),
  /**
   * The value. For a concealed field being edited, omit it to keep what's
   * stored (the browser never had it), or send the new one.
   */
  value: z.string().max(VAULT_LIMITS.maxValue).optional(),
});
export type VaultFieldInput = z.infer<typeof VaultFieldInput>;

export const SaveVaultItemBody = z.object({
  type: VaultItemType,
  title: z.string().trim().min(1).max(VAULT_LIMITS.maxTitle),
  fields: z.array(VaultFieldInput).max(VAULT_LIMITS.maxFields).default([]),
  urls: z.array(VaultUrl).max(VAULT_LIMITS.maxUrls).default([]),
  tags: z.array(Tag).max(VAULT_LIMITS.maxTags).default([]),
  notes: z.string().max(VAULT_LIMITS.maxNotes).default(''),
  favorite: z.boolean().default(false),
  agentAccess: z.enum(['ask', 'allow', 'never']).default('ask'),
  agentRead: z.enum(['ask', 'allow']).default('ask'),
  allowedSites: z.array(z.string().trim().min(1).max(253)).max(20).default([]),
});
export type SaveVaultItemBody = z.infer<typeof SaveVaultItemBody>;

export const PatchVaultItemBody = z.object({
  favorite: z.boolean().optional(),
  tags: z.array(Tag).max(VAULT_LIMITS.maxTags).optional(),
});

export const Revealed = z.object({ value: z.string() });

export const TotpCode = z.object({
  code: z.string(),
  /** Seconds each code lasts. */
  period: z.number().int().positive(),
  /** Epoch ms the code stops working. */
  expiresAt: z.number(),
});
export type TotpCode = z.infer<typeof TotpCode>;

export const PasswordHistoryEntry = z.object({ value: z.string(), changedAt: z.number() });
export const PasswordHistory = z.object({ entries: z.array(PasswordHistoryEntry) });

// ── The whole vault ─────────────────────────────────────────────────────────

export const VaultLockState = z.object({
  /** "Ask for a password to open Passwords" is on. */
  enabled: z.boolean(),
  /** It's on, and Passwords isn't open right now. */
  locked: z.boolean(),
  /** Minutes without use before it locks itself; 0 = only when Conch stops. */
  autoLockMinutes: z.number().int().nonnegative(),
});
export type VaultLockState = z.infer<typeof VaultLockState>;

export const VaultStatus = z.object({
  lock: VaultLockState.default({ enabled: false, locked: false, autoLockMinutes: 30 }),
  /** How Conch's own vault is locked on this computer. */
  protection: z.enum(['keychain', 'file']),
  sources: z.array(VaultSource),
  /** Counts of problems in every source, for the Security check. */
  health: z.object({
    weak: z.number().int().nonnegative(),
    reused: z.number().int().nonnegative(),
    compromised: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    insecure: z.number().int().nonnegative(),
    /** When passwords were last checked against known breaches. */
    breachCheckedAt: z.number().optional(),
  }),
  /** Items waiting in Recently deleted. */
  trash: z.number().int().nonnegative(),
});
export type VaultStatus = z.infer<typeof VaultStatus>;

export const VaultList = z.object({
  items: z.array(VaultItemSummary),
  status: VaultStatus,
});
export type VaultList = z.infer<typeof VaultList>;

// ── Import & export ─────────────────────────────────────────────────────────

/** Where an import file came from; `auto` recognises it by its columns. */
export const ImportFormat = z.enum([
  'auto',
  'chrome',
  'safari',
  'firefox',
  'bitwarden-csv',
  'bitwarden-json',
  '1password-csv',
  'lastpass',
  'keepassxc',
  'proton',
  'dashlane',
  'generic',
]);
export type ImportFormat = z.infer<typeof ImportFormat>;

export const ImportBody = z.object({
  format: ImportFormat.default('auto'),
  /** The file's text. CSV or JSON, at most a few MB. */
  text: z.string().min(1).max(10_000_000),
  /** Actually save; without it the gateway only previews. */
  commit: z.boolean().default(false),
  /** Skip items that look the same as one already here (the default). */
  skipDuplicates: z.boolean().default(true),
});

export const ImportPreview = z.object({
  format: ImportFormat,
  /** "Chrome", "Bitwarden". */
  formatName: z.string(),
  found: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  /** Rows that had nothing worth keeping. */
  skipped: z.number().int().nonnegative(),
  /** A few titles, for the preview. */
  sample: z.array(z.object({ title: z.string(), subtitle: z.string(), type: VaultItemType })),
  /** Set once saved. */
  imported: z.number().int().nonnegative().optional(),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

// ── Copying from another password manager ───────────────────────────────────

/**
 * Copy items from a password manager Conch reads into Conch's own vault,
 * through that manager's own program, one value at a time (ADR 0025 §
 * Moving in). Without `commit` it only previews.
 */
export const VaultTransferBody = z.object({
  /** Only these items (their ids in the list); omit for all of them. */
  ids: z.array(z.string().min(1).max(300)).max(VAULT_LIMITS.maxImport).optional(),
  commit: z.boolean().default(false),
  skipDuplicates: z.boolean().default(true),
  /** Keep the copies up to date from it from now on (one way: it to Conch). */
  keepSynced: z.boolean().default(false),
});
export type VaultTransferBody = z.infer<typeof VaultTransferBody>;

/**
 * Copy to (ADR 0062): some of Conch's own items, copied into another
 * password manager as new items there. A few at a time, so the page can
 * show how far it got and stop.
 */
export const VaultCopyOutBody = z.object({
  /** Conch's own items (`pw_…`). */
  ids: z.array(z.string().min(1).max(300)).min(1).max(25),
  /** Where in it: a 1Password vault's id. Its default place when left out. */
  place: z
    .string()
    .regex(/^[a-z0-9]{1,64}$/)
    .optional(),
  /** Leave out ones it already has: the same site and account, or copied from it. */
  skipDuplicates: z.boolean().default(true),
});
export type VaultCopyOutBody = z.infer<typeof VaultCopyOutBody>;

export const VaultCopyOutResult = z.object({
  copied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.array(z.object({ title: z.string(), message: z.string() })),
});
export type VaultCopyOutResult = z.infer<typeof VaultCopyOutResult>;

export const VaultTransferPreview = z.object({
  source: VaultSourceId,
  sourceName: z.string(),
  found: z.number().int().nonnegative(),
  /** Look the same as an item already here. */
  duplicates: z.number().int().nonnegative(),
  /** Copied before; they'd be brought up to date rather than copied again. */
  copiedBefore: z.number().int().nonnegative(),
  sample: z.array(z.object({ title: z.string(), subtitle: z.string(), type: VaultItemType })),
});
export type VaultTransferPreview = z.infer<typeof VaultTransferPreview>;

/** A copy under way, or finished. */
export const VaultTransferJob = z.object({
  jobId: Id,
  source: VaultSourceId,
  sourceName: z.string(),
  state: z.enum(['running', 'done', 'failed', 'cancelled']),
  total: z.number().int().nonnegative(),
  /** Items read so far. */
  done: z.number().int().nonnegative(),
  copied: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** Items that couldn't be read, by name, with why. */
  failed: z.array(z.object({ title: z.string(), message: z.string() })).max(50),
  /** One sentence when the whole copy stopped. */
  message: z.string().optional(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
});
export type VaultTransferJob = z.infer<typeof VaultTransferJob>;

export const VaultSyncPatch = z.object({ enabled: z.boolean() });

// ── Generating ──────────────────────────────────────────────────────────────

export const GeneratorOptions = z.object({
  style: z.enum(['random', 'words', 'pin']).default('random'),
  /** Characters for `random` and `pin`, words for `words`. */
  length: z.number().int().min(4).max(128).default(20),
  symbols: z.boolean().default(true),
  digits: z.boolean().default(true),
  /** Leave out characters that look alike (O/0, l/1/I). */
  unambiguous: z.boolean().default(true),
  separator: z.string().max(3).default('-'),
  capitalize: z.boolean().default(true),
});
export type GeneratorOptions = z.infer<typeof GeneratorOptions>;

// ── Requests ────────────────────────────────────────────────────────────────

export const VaultIdsBody = z.object({
  ids: z.array(z.string().min(1).max(300)).min(1).max(VAULT_LIMITS.maxItems),
});
export const PurgeBody = z.object({
  /** Omit to empty Recently deleted. */
  ids: z.array(z.string().min(1).max(300)).max(VAULT_LIMITS.maxItems).optional(),
});
export const RevealRequest = z.object({
  fieldId: Id,
  /** Copying rather than showing (recorded as such). */
  copy: z.boolean().default(false),
});
export const TotpRequest = z.object({ fieldId: Id.optional() });
export const VaultSourcePatch = z.object({
  enabled: z.boolean().optional(),
  /** KeePassXC: the database file. */
  database: z.string().max(4096).optional(),
  /** KeePassXC: a key file the database also needs; empty to clear it. */
  keyFile: z.string().max(4096).optional(),
});
/** A KeePassXC database Conch found on this computer, to choose with one click. */
export const KeePassDatabase = z.object({
  path: z.string(),
  name: z.string(),
  /** "Documents", "iCloud Drive". */
  where: z.string(),
  /** KeePassXC opened it lately. */
  recent: z.boolean(),
  modifiedAt: z.number().optional(),
});
export type KeePassDatabase = z.infer<typeof KeePassDatabase>;
/**
 * A 1Password service account token (`ops_…`), as 1Password shows it once
 * when the service account is made. Whitespace a paste brings is dropped.
 */
export const SERVICE_ACCOUNT_TOKEN = /^ops_[A-Za-z0-9+/=_-]{20,4000}$/;
export const OnePasswordTokenBody = z.object({
  token: z
    .string()
    .max(4100)
    .transform((t) => t.replace(/\s+/g, ''))
    .refine((t) => SERVICE_ACCOUNT_TOKEN.test(t), {
      message: 'That isn’t a service account token. It starts with ops_.',
    }),
});
export const OnePasswordVaultsBody = z.object({
  /** The vaults Conch shows, by 1Password's vault id. */
  vaults: z
    .array(z.string().regex(/^[a-z0-9]{1,64}$/))
    .min(1, 'Choose at least one vault.')
    .max(500),
});
/** A token that worked: the vaults it can read, and every manager as it is now. Never the token. */
export const OnePasswordConnected = z.object({
  vaults: z.array(z.object({ id: z.string(), name: z.string() })),
  sources: z.array(VaultSource),
});
export type OnePasswordConnected = z.infer<typeof OnePasswordConnected>;
export const UnlockSourceBody = z.object({
  password: z.string().min(1).max(1024),
  /** Keep it unlocked on this computer, across restarts (sealed with its device key). */
  remember: z.boolean().default(false),
});
export const BreachCheckResult = z.object({
  checked: z.number().int().nonnegative(),
  compromised: z.number().int().nonnegative(),
});

// ── The lock ────────────────────────────────────────────────────────────────

/** At least 8 characters: it's typed often, and the device key is mixed in. */
export const VaultPasswordBody = z.object({ password: z.string().min(8).max(1024) });
export const VaultLockSettingsBody = z.object({
  /** Turn the lock on (with `password`) or off. */
  enabled: z.boolean().optional(),
  password: z.string().min(8).max(1024).optional(),
  autoLockMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
});

// ── Asking in the chat ──────────────────────────────────────────────────────

/** A field the agent asks the person to fill in (never with a value). */
export const RequestedField = z.object({
  label: z.string().trim().min(1).max(VAULT_LIMITS.maxLabel),
  kind: VaultFieldKind,
  role: VaultFieldRole.optional(),
});
export type RequestedField = z.infer<typeof RequestedField>;

/**
 * Something Passwords needs from the person, shown as a card in the chat:
 * unlock it, or type in a credential the agent asked for. The agent can only
 * ask; whatever is typed goes straight into the vault, never into the chat.
 */
export const VaultRequest = z.object({
  requestId: Id,
  kind: z.enum(['unlock', 'save']),
  state: z.enum(['waiting', 'done', 'declined', 'expired']),
  /** For `save`: what to call it, what kind, for which site, and why. */
  title: z.string().max(VAULT_LIMITS.maxTitle).optional(),
  itemType: VaultItemType.optional(),
  /** The site by its real host, which the person recognises. */
  site: z.string().max(253).optional(),
  reason: z.string().max(300).optional(),
  fields: z.array(RequestedField).max(12).optional(),
  /** Set once saved. */
  itemId: z.string().optional(),
});
export type VaultRequest = z.infer<typeof VaultRequest>;

export const AnswerVaultRequestBody = z.object({
  title: z.string().trim().min(1).max(VAULT_LIMITS.maxTitle),
  fields: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(VAULT_LIMITS.maxLabel),
        kind: VaultFieldKind,
        role: VaultFieldRole.optional(),
        value: z.string().max(VAULT_LIMITS.maxValue),
      }),
    )
    .max(12),
  urls: z.array(VaultUrl).max(VAULT_LIMITS.maxUrls).default([]),
  agentAccess: z.enum(['ask', 'allow', 'never']).default('ask'),
});

/** The agent asking to read or fill something: shown with the permission card. */
export const VaultPermission = z.object({
  action: z.enum(['read', 'fill']),
  itemTitle: z.string(),
  itemType: VaultItemType,
  fieldLabel: z.string(),
  /** Its own words: why it needs it. */
  reason: z.string().max(300).optional(),
  /** For a fill, the page's host. */
  site: z.string().optional(),
  /** A password, card or recovery phrase: said plainly on the card. */
  sensitive: z.boolean(),
});
export type VaultPermission = z.infer<typeof VaultPermission>;
