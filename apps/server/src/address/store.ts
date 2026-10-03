/**
 * Your own address (ADR 0064): what Conch keeps about it.
 *
 * - `~/.conch/address.json` — the name you chose, when, and the computer it
 *   was set on. A setting, backed up like any other (`kept`).
 * - `~/.conch/address/` — what goes with *this* computer and is never backed
 *   up (`derived`): the ACME account key, the certificate and its key, how
 *   the last try went, and this computer's own id. Files are 0600 in a 0700
 *   folder, readable only by you.
 *
 * The id lives in the derived folder on purpose: a backup restored on another
 * computer brings `address.json` but not the id, so the address there reads
 * as "set up on another computer" and opens nothing by itself (like the door,
 * ADR 0045).
 */
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { domainToASCII } from 'node:url';

import { parse as parseDomain } from 'tldts';
import { z } from 'zod';

import { readJson, writeFileAtomic, writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';

/** Something about the name a person typed, said so they can fix it. */
export class AddressError extends Error {}

const AddressFile = z.object({
  version: z.literal(1).default(1),
  /** The hostname, lowercase ASCII (IDNA): `conch.example.com`. */
  name: z.string().max(253).optional(),
  /** When it was set. */
  since: z.number().optional(),
  /** The id of the computer it was set on (`address/machine`). */
  setOn: z.string().max(64).optional(),
  /**
   * Something `conch address` asked of the running Conch: it acts on each once. Writing
   * this file is the proof it's the person, as it is for `access.json`.
   */
  ask: z.object({ action: z.literal('renew'), at: z.number() }).optional(),
});
export type AddressFile = z.infer<typeof AddressFile>;

/**
 * What the running Conch says about the address, for `conch setup` and `conch address`:
 * the status, and which change (`since`) and ask (`ask`) it has taken up.
 */
const StatusFile = z.object({
  at: z.number(),
  since: z.number().optional(),
  ask: z.number().optional(),
  status: z.unknown(),
});
export type StatusFile = z.infer<typeof StatusFile>;

/** How the last try at a certificate went, so a restart doesn't hammer Let's Encrypt. */
const AddressState = z.object({
  lastAttempt: z.number().optional(),
  nextAttempt: z.number().optional(),
  failures: z.number().int().min(0).default(0),
  error: z
    .object({ kind: z.string(), message: z.string(), command: z.string().optional() })
    .optional(),
});
export type AddressState = z.infer<typeof AddressState>;

export interface StoredCertificate {
  certPem: string;
  keyPem: string;
}

/**
 * The hostname in a person's words, made exact: `https://Conch.Example.com/`
 * becomes `conch.example.com`. Throws `AddressError` with what to do instead.
 */
export function normaliseName(raw: string): string {
  let text = raw.trim();
  if (!text) throw new AddressError('Type the address, like conch.yourname.com.');
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  // A trailing slash is only how addresses are often copied; anything after it is a path.
  const slash = text.indexOf('/');
  if (slash !== -1) {
    if (text.slice(slash).replace(/\/+$/, '') !== '')
      throw new AddressError(
        'Just the name, without a path after it. It looks like conch.yourname.com.',
      );
    text = text.slice(0, slash);
  }
  if (/[@?#\s]/.test(text))
    throw new AddressError('That doesn’t look like an address. It looks like conch.yourname.com.');
  if (isIP(text.replace(/^\[|\]$/g, '')))
    throw new AddressError(
      'That’s an IP address. Conch needs a name you own, like conch.yourname.com, for its certificate.',
    );
  if (/:\d*$/.test(text))
    throw new AddressError(
      'Just the name, without a port: Conch answers on the usual ones (443, and 80 for the certificate).',
    );
  const ascii = domainToASCII(text.toLowerCase().replace(/\.$/, ''));
  if (!ascii || ascii.length > 253 || !/^[a-z0-9.-]+$/.test(ascii))
    throw new AddressError('That doesn’t look like an address. It looks like conch.yourname.com.');
  if (ascii === 'localhost' || ascii.endsWith('.localhost'))
    throw new AddressError(
      'localhost only means this computer. Use a name you own, like conch.yourname.com.',
    );
  if (!ascii.includes('.'))
    throw new AddressError(
      'That name has no domain. Use the whole thing, like conch.yourname.com.',
    );
  if (/\.(local|internal|lan|home|arpa)$/.test(ascii))
    throw new AddressError(
      'That name only works inside a network, so no certificate authority can check it. Use a name you own on the internet.',
    );
  if (ascii.split('.').some((label) => !label || label.length > 63 || /^-|-$/.test(label)))
    throw new AddressError('That doesn’t look like an address. It looks like conch.yourname.com.');
  const parsed = parseDomain(ascii, { allowPrivateDomains: true });
  if (!parsed.publicSuffix || !parsed.domain || (!parsed.isIcann && !parsed.isPrivate))
    throw new AddressError(
      `“${ascii}” doesn’t end in a domain anyone can own. Check the spelling, like conch.yourname.com.`,
    );
  return ascii;
}

/** `~/.conch/address.json` and `~/.conch/address/`. */
export class AddressStore {
  readonly file: string;
  readonly dir: string;

  constructor(readonly home: string) {
    this.file = join(home, 'address.json');
    this.dir = join(home, 'address');
  }

  async read(): Promise<AddressFile> {
    return (await readStore(this.file, AddressFile)).value;
  }

  async write(file: AddressFile): Promise<void> {
    await writeJson(this.file, AddressFile.parse(file));
  }

  /** Forget the address and everything that went with it on this computer (but the id). */
  async clear(): Promise<void> {
    await rm(this.file, { force: true });
    for (const name of ['cert.pem', 'key.pem', 'state.json'])
      await rm(join(this.dir, name), { force: true });
  }

  /** This computer's own id: made once, never backed up. */
  async machine(): Promise<string> {
    const path = join(this.dir, 'machine');
    const known = await readFile(path, 'utf8').then(
      (text) => text.trim(),
      () => '',
    );
    if (/^[a-f0-9]{32}$/.test(known)) return known;
    const id = randomBytes(16).toString('hex');
    await writeFileAtomic(path, `${id}\n`);
    return id;
  }

  async certificate(): Promise<StoredCertificate | undefined> {
    try {
      const [certPem, keyPem] = await Promise.all([
        readFile(join(this.dir, 'cert.pem'), 'utf8'),
        readFile(join(this.dir, 'key.pem'), 'utf8'),
      ]);
      if (!certPem.includes('BEGIN CERTIFICATE') || !keyPem.includes('PRIVATE KEY'))
        return undefined;
      return { certPem, keyPem };
    } catch {
      return undefined;
    }
  }

  /** The key first, so a certificate on disk never comes without its key. */
  async saveCertificate(cert: StoredCertificate): Promise<void> {
    await writeFileAtomic(join(this.dir, 'key.pem'), cert.keyPem);
    await writeFileAtomic(join(this.dir, 'cert.pem'), cert.certPem);
  }

  async accountKey(): Promise<Record<string, unknown> | undefined> {
    const jwk = await readJson<Record<string, unknown>>(join(this.dir, 'account.jwk')).catch(
      () => undefined,
    );
    return jwk && typeof jwk.d === 'string' ? jwk : undefined;
  }

  async saveAccountKey(jwk: Record<string, unknown>): Promise<void> {
    await writeJson(join(this.dir, 'account.jwk'), jwk);
  }

  /** What the running Conch last said (undefined before it ever has). */
  async status(): Promise<StatusFile | undefined> {
    try {
      const parsed = StatusFile.safeParse(
        JSON.parse(await readFile(join(this.dir, 'status.json'), 'utf8')),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async saveStatus(file: Omit<StatusFile, 'at'>): Promise<void> {
    await writeJson(join(this.dir, 'status.json'), { ...file, at: Date.now() });
  }

  async state(): Promise<AddressState> {
    return (await readStore(join(this.dir, 'state.json'), AddressState)).value;
  }

  async saveState(state: AddressState): Promise<void> {
    await writeJson(join(this.dir, 'state.json'), AddressState.parse(state));
  }
}
