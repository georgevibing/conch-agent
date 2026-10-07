/**
 * Where the key that opens the vault is kept (ADR 0025).
 *
 * The vault's own key is random and never written down in the clear. It's
 * wrapped with a *device key* that the operating system guards for this user:
 *
 * - macOS: the login Keychain, through `/usr/bin/security`;
 * - Windows: DPAPI (CurrentUser), through PowerShell, as a blob beside the vault;
 * - Linux: the Secret Service (GNOME Keyring, KWallet), through `secret-tool`.
 *
 * The device key always travels on stdin, never as an argument (`ps` shows
 * arguments to every user). Where none of these is available (a headless
 * server, a test run) the device key is a 0600 file next to the vault, and
 * Conch says so in plain words rather than pretending.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';

import { writeFileAtomic } from '../lib/fs';
import { findExecutable, run } from '../lib/proc';

export type KeystoreKind = 'keychain' | 'file';

export interface Keystore {
  readonly kind: KeystoreKind;
  /** The device key, made the first time it's asked for. */
  deviceKey(): Promise<Buffer>;
  /** Replace the device key (after a restore onto this computer). */
  store(key: Buffer): Promise<void>;
  forget(): Promise<void>;
}

const SERVICE = 'Conch vault';
const KEY_BYTES = 32;

/** One account per Conch home, so test runs and a second Conch never share a key. */
function accountFor(home: string): string {
  return `conch-${createHash('sha256').update(home).digest('hex').slice(0, 16)}`;
}

function decodeKey(text: string): Buffer | undefined {
  const trimmed = text.trim();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return undefined;
  return Buffer.from(trimmed, 'hex');
}

/** A 0600 file beside the vault: honest about what it is. */
export class FileKeystore implements Keystore {
  readonly kind = 'file' as const;
  constructor(private readonly dir: string) {}

  get #path() {
    return join(this.dir, 'device.key');
  }

  async deviceKey(): Promise<Buffer> {
    const existing = await readFile(this.#path, 'utf8').then(decodeKey, () => undefined);
    if (existing) return existing;
    const key = randomBytes(KEY_BYTES);
    await this.store(key);
    return key;
  }

  async store(key: Buffer): Promise<void> {
    await writeFileAtomic(this.#path, `${key.toString('hex')}\n`, 0o600);
  }

  async forget(): Promise<void> {
    await rm(this.#path, { force: true });
  }
}

/** macOS login Keychain. `security -i` reads its commands from stdin. */
class MacKeychain implements Keystore {
  readonly kind = 'keychain' as const;
  constructor(
    private readonly security: string,
    private readonly account: string,
  ) {}

  async #read(): Promise<Buffer | undefined> {
    const result = await run(
      this.security,
      ['find-generic-password', '-s', SERVICE, '-a', this.account, '-w'],
      { timeout: 10_000 },
    );
    return result.code === 0 ? decodeKey(result.stdout) : undefined;
  }

  async deviceKey(): Promise<Buffer> {
    const existing = await this.#read();
    if (existing) return existing;
    const key = randomBytes(KEY_BYTES);
    await this.store(key);
    return key;
  }

  async store(key: Buffer): Promise<void> {
    // Interactive mode: the secret is in the command text on stdin, not in argv.
    const command = `add-generic-password -U -s "${SERVICE}" -a "${this.account}" -l "${SERVICE}" -w ${key.toString('hex')}\n`;
    const result = await run(this.security, ['-i'], { input: command, timeout: 10_000 });
    const back = await this.#read();
    if (result.code !== 0 || !back?.equals(key))
      throw new Error('The Keychain wouldn’t keep the key for your passwords.');
  }

  async forget(): Promise<void> {
    await run(this.security, ['delete-generic-password', '-s', SERVICE, '-a', this.account], {
      timeout: 10_000,
    });
  }
}

/** Linux Secret Service. `secret-tool store` reads the secret from stdin. */
class SecretService implements Keystore {
  readonly kind = 'keychain' as const;
  constructor(
    private readonly tool: string,
    private readonly account: string,
  ) {}

  async #read(): Promise<Buffer | undefined> {
    const result = await run(
      this.tool,
      ['lookup', 'service', 'conch-vault', 'account', this.account],
      {
        timeout: 10_000,
      },
    );
    return result.code === 0 ? decodeKey(result.stdout) : undefined;
  }

  async deviceKey(): Promise<Buffer> {
    const existing = await this.#read();
    if (existing) return existing;
    const key = randomBytes(KEY_BYTES);
    await this.store(key);
    return key;
  }

  async store(key: Buffer): Promise<void> {
    await run(
      this.tool,
      ['store', `--label=${SERVICE}`, 'service', 'conch-vault', 'account', this.account],
      { input: key.toString('hex'), timeout: 10_000 },
    );
    const back = await this.#read();
    if (!back?.equals(key))
      throw new Error('The keyring wouldn’t keep the key for your passwords.');
  }

  async forget(): Promise<void> {
    await run(this.tool, ['clear', 'service', 'conch-vault', 'account', this.account], {
      timeout: 10_000,
    });
  }
}

const PROTECT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($in)
$out = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[Convert]::ToBase64String($out)`;
const UNPROTECT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($in)
$out = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
[Convert]::ToBase64String($out)`;

/** Windows DPAPI: only this Windows user can unwrap the blob. */
class Dpapi implements Keystore {
  readonly kind = 'keychain' as const;
  constructor(
    private readonly powershell: string,
    private readonly dir: string,
  ) {}

  get #path() {
    return join(this.dir, 'device.dpapi');
  }

  async #ps(script: string, input: string): Promise<string | undefined> {
    const result = await run(
      this.powershell,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { input, timeout: 20_000 },
    );
    return result.code === 0 ? result.stdout.trim() : undefined;
  }

  async deviceKey(): Promise<Buffer> {
    const blob = await readFile(this.#path, 'utf8').catch(() => undefined);
    if (blob) {
      const plain = await this.#ps(UNPROTECT, blob);
      if (plain) {
        const key = Buffer.from(plain, 'base64');
        if (key.length === KEY_BYTES) return key;
      }
      throw new Error('Windows wouldn’t open the key for your passwords.');
    }
    const key = randomBytes(KEY_BYTES);
    await this.store(key);
    return key;
  }

  async store(key: Buffer): Promise<void> {
    const blob = await this.#ps(PROTECT, key.toString('base64'));
    if (!blob) throw new Error('Windows wouldn’t keep the key for your passwords.');
    await writeFileAtomic(this.#path, `${blob}\n`, 0o600);
  }

  async forget(): Promise<void> {
    await rm(this.#path, { force: true });
  }
}

/**
 * Which keystore a Conch home uses. The gateway and `pnpm conch` choose the
 * same way, so the terminal opens the device key the gateway sealed with:
 * the operating system's, or the file for test runs and the mock engine.
 */
export function keystoreMode(config: {
  CONCH_VAULT_KEYSTORE?: 'auto' | 'file';
  CONCH_ENGINE?: string;
}): 'auto' | 'file' {
  return (
    config.CONCH_VAULT_KEYSTORE ??
    (config.CONCH_ENGINE === 'mock' || process.env.VITEST ? 'file' : 'auto')
  );
}

/**
 * This home's device key for a process that isn't the gateway (`pnpm
 * conch`): found the first time it's needed, so commands that never open a
 * key never touch the keychain.
 */
export function deviceKeyFor(home: string, mode: 'auto' | 'file'): () => Promise<Buffer> {
  let keystore: Promise<Keystore> | undefined;
  let key: Promise<Buffer> | undefined;
  return () => {
    keystore ??= chooseKeystore(join(home, 'vault'), home, mode);
    key ??= keystore
      .then((k) => k.deviceKey())
      .catch((error: unknown) => {
        key = undefined;
        throw error;
      });
    return key;
  };
}

/**
 * The best keystore this computer has. `mode: 'file'` forces the file (tests,
 * `CONCH_VAULT_KEYSTORE=file`); `auto` tries the operating system's first and
 * checks it really works before trusting it with the only copy of the key.
 */
export async function chooseKeystore(
  dir: string,
  home: string,
  mode: 'auto' | 'file' = 'auto',
): Promise<Keystore> {
  const file = new FileKeystore(dir);
  if (mode === 'file') return file;
  const account = accountFor(home);
  const os = platform();
  try {
    if (os === 'darwin') {
      const security = await findExecutable('security', { extraDirs: ['/usr/bin'] });
      if (security) return new MacKeychain(security, account);
    } else if (os === 'win32') {
      const powershell = await findExecutable('powershell');
      if (powershell) return new Dpapi(powershell, dir);
    } else {
      const tool = await findExecutable('secret-tool');
      // A Secret Service needs a session bus; a headless server has none.
      if (tool && process.env.DBUS_SESSION_BUS_ADDRESS) return new SecretService(tool, account);
    }
  } catch {
    // Fall through to the file.
  }
  return file;
}
