/**
 * The AWS sign-ins already on this computer (ADR 0109): every profile in
 * `~/.aws/config` and `~/.aws/credentials` — single sign-on, access keys, a
 * role, a program that hands out keys — and keys in the environment.
 *
 * Read-only, always. Conch never writes either file. It reads the SSO cache
 * only to say whether a sign-in is still good (`expiresAt`), never to use
 * its token. Keys for a request come from the AWS CLI itself (`aws configure
 * export-credentials`, which also renews an SSO session that can renew), or
 * straight from the credentials file for plain access keys; they are held in
 * memory until they expire and never written, logged or sent to the browser.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CloudAccount, CloudAccountState, LoginState } from '@conch/protocol';
import { z } from 'zod';

import type { LoginHandle } from '../engines/types';
import { CloudError } from './errors';
import { clean, type CloudExec } from './exec';
import { parseIni } from './ini';
import { signIn } from './signin';
import type { AwsCredentials } from './sigv4';

/** Keys from the environment rather than a profile. Not a name a profile can have. */
export const ENV_ACCOUNT = '@environment';

export interface AwsProfile {
  name: string;
  kind: 'sso' | 'keys' | 'role' | 'process' | 'env';
  region?: string;
  /** The AWS account it's in, when the file says. */
  account?: string;
  role?: string;
  ssoSession?: string;
  startUrl?: string;
  /** For a role: the profile whose keys assume it. */
  source?: string;
}

export interface AwsDeps {
  exec: CloudExec;
  env: NodeJS.ProcessEnv;
  home: string;
  now?: () => number;
  read?: (path: string) => Promise<string | undefined>;
}

const readText = (path: string) => readFile(path, 'utf8').catch(() => undefined);

/** Roles that can do everything: Conch only needs to ask for models. */
const BROAD = /admin|administrator|poweruser|fullaccess|full-access|root|owner/i;
/** Roles named for looking, not changing. */
const NARROW = /readonly|read-only|viewer|bedrock|developer|user/i;

const tail = (account: string | undefined) => (account ? `…${account.slice(-4)}` : undefined);

const configPath = (deps: AwsDeps) =>
  deps.env.AWS_CONFIG_FILE?.trim() || join(deps.home, '.aws', 'config');
const credentialsPath = (deps: AwsDeps) =>
  deps.env.AWS_SHARED_CREDENTIALS_FILE?.trim() || join(deps.home, '.aws', 'credentials');

/** Every profile this computer has, read the way the AWS CLI reads them. */
export async function awsProfiles(deps: AwsDeps): Promise<AwsProfile[]> {
  const read = deps.read ?? readText;
  const config = parseIni((await read(configPath(deps))) ?? '');
  const credentials = parseIni((await read(credentialsPath(deps))) ?? '');
  const sessions = new Map<string, Map<string, string>>();
  const named = new Map<string, Map<string, string>>();
  for (const [section, values] of config) {
    if (section === 'default') named.set('default', values);
    else if (section.startsWith('profile ')) named.set(section.slice(8).trim(), values);
    else if (section.startsWith('sso-session ')) sessions.set(section.slice(12).trim(), values);
  }
  const names = new Set([...named.keys(), ...credentials.keys()]);
  const out: AwsProfile[] = [];
  for (const name of names) {
    const conf = named.get(name) ?? new Map<string, string>();
    const keys = credentials.get(name);
    const region = conf.get('region') || undefined;
    const session = conf.get('sso_session');
    const startUrl =
      conf.get('sso_start_url') ?? (session && sessions.get(session)?.get('sso_start_url'));
    if (session || startUrl) {
      out.push({
        name,
        kind: 'sso',
        region:
          region ??
          conf.get('sso_region') ??
          (session && sessions.get(session)?.get('sso_region')) ??
          undefined,
        account: conf.get('sso_account_id'),
        role: conf.get('sso_role_name'),
        ...(session && { ssoSession: session }),
        ...(startUrl && { startUrl }),
      });
      continue;
    }
    const arn = conf.get('role_arn') ?? keys?.get('role_arn');
    if (arn) {
      const match = /^arn:aws[\w-]*:iam::(\d{12}):role\/(?:.*\/)?([\w+=,.@-]+)$/.exec(arn);
      out.push({
        name,
        kind: 'role',
        region,
        ...(match?.[1] && { account: match[1] }),
        ...(match?.[2] && { role: match[2] }),
        ...((conf.get('source_profile') ?? keys?.get('source_profile')) && {
          source: conf.get('source_profile') ?? keys?.get('source_profile'),
        }),
      });
      continue;
    }
    if (conf.get('credential_process') ?? keys?.get('credential_process')) {
      out.push({ name, kind: 'process', region });
      continue;
    }
    if (keys?.get('aws_access_key_id') && keys.get('aws_secret_access_key'))
      out.push({ name, kind: 'keys', region: region ?? keys.get('region') });
  }
  if (deps.env.AWS_ACCESS_KEY_ID?.trim() && deps.env.AWS_SECRET_ACCESS_KEY?.trim())
    out.push({
      name: ENV_ACCOUNT,
      kind: 'env',
      ...((deps.env.AWS_REGION ?? deps.env.AWS_DEFAULT_REGION) && {
        region: deps.env.AWS_REGION ?? deps.env.AWS_DEFAULT_REGION,
      }),
    });
  return out;
}

const SsoToken = z.object({
  expiresAt: z.string(),
  refreshToken: z.string().optional(),
  registrationExpiresAt: z.string().optional(),
});

/**
 * Whether an SSO profile is signed in, from the CLI's own cache file (named
 * for the session, or the start address for older profiles). Only the dates
 * are read.
 */
export async function ssoState(profile: AwsProfile, deps: AwsDeps): Promise<CloudAccountState> {
  const name = profile.ssoSession ?? profile.startUrl;
  if (!name) return 'unknown';
  const file = join(
    deps.home,
    '.aws',
    'sso',
    'cache',
    `${createHash('sha1').update(name, 'utf8').digest('hex')}.json`,
  );
  const text = await (deps.read ?? readText)(file);
  if (!text) return 'signed-out';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'signed-out';
  }
  const token = SsoToken.safeParse(parsed);
  if (!token.success) return 'signed-out';
  const now = deps.now?.() ?? Date.now();
  if (Date.parse(token.data.expiresAt) > now + 60_000) return 'ready';
  // A session that can renew itself does, the next time the CLI is asked for keys.
  const renews =
    token.data.refreshToken &&
    (!token.data.registrationExpiresAt || Date.parse(token.data.registrationExpiresAt) > now);
  return renews ? 'ready' : 'expired';
}

/** How a profile signs in, in words. */
function detailOf(profile: AwsProfile): string {
  const where = [profile.role, tail(profile.account) && `account ${tail(profile.account)}`]
    .filter(Boolean)
    .join(' · ');
  switch (profile.kind) {
    case 'sso':
      return ['Single sign-on', where].filter(Boolean).join(' · ');
    case 'role':
      return ['A role', where].filter(Boolean).join(' · ');
    case 'process':
      return 'Keys from a program you set up';
    case 'env':
      return 'Keys in this computer’s settings';
    default:
      return 'Access keys on this computer';
  }
}

/** The profiles as accounts to pick from: signed-in and narrower ones first. */
export async function awsAccounts(deps: AwsDeps): Promise<CloudAccount[]> {
  const profiles = await awsProfiles(deps);
  const states = new Map<string, CloudAccountState>();
  for (const profile of profiles)
    states.set(
      profile.name,
      profile.kind === 'sso'
        ? await ssoState(profile, deps)
        : profile.kind === 'keys' || profile.kind === 'env'
          ? 'ready'
          : 'unknown',
    );
  // A role is as signed in as the profile whose keys assume it.
  for (const profile of profiles)
    if (profile.kind === 'role' && profile.source && states.has(profile.source))
      states.set(profile.name, states.get(profile.source) ?? 'unknown');
  const preferred = deps.env.AWS_PROFILE?.trim() || 'default';
  const rank = (a: CloudAccount) =>
    (a.state === 'ready' ? 0 : a.state === 'unknown' ? 1 : 2) * 10 +
    (a.broad ? 4 : 0) +
    (a.isDefault ? 0 : 1);
  return profiles
    .map((profile): CloudAccount => ({
      id: profile.name,
      label: profile.kind === 'env' ? 'This computer’s AWS keys' : profile.name,
      detail: detailOf(profile),
      state: states.get(profile.name) ?? 'unknown',
      kind: profile.kind,
      ...(profile.region && { region: profile.region }),
      isDefault: profile.name === preferred,
      broad: Boolean(profile.role && BROAD.test(profile.role) && !NARROW.test(profile.role)),
    }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

const Exported = z.object({
  AccessKeyId: z.string().min(1),
  SecretAccessKey: z.string().min(1),
  SessionToken: z.string().optional(),
  Expiration: z.string().optional(),
});

/** What the AWS CLI's refusal means, in the words a person acts on. */
export function awsProblem(stderr: string, profile: string): CloudError {
  const said = stderr.toLowerCase();
  if (/not found|enoent/.test(said) && /aws/.test(said))
    return new CloudError(
      'missing-tool',
      'Conch uses the AWS CLI to sign in to AWS. Install it, and Conch carries on.',
      {
        need: 'aws-cli',
      },
    );
  if (/invalid choice|unknown options|export-credentials/.test(said) && !/token|sso/.test(said))
    return new CloudError(
      'outdated-tool',
      'Your AWS CLI is too old to hand Conch keys. Update it, and Conch carries on.',
      {
        need: 'aws-cli',
      },
    );
  if (
    /expired|sso session|sso login|token has expired|refresh|unauthorizedssotoken|error loading sso token|invalid_grant|no access token|login again/.test(
      said,
    )
  )
    return new CloudError(
      'signed-out',
      `Your AWS sign-in for “${profile}” has ended. Sign in to AWS again.`,
    );
  if (/could not be found|profile .* not found/.test(said))
    return new CloudError(
      'not-chosen',
      `There’s no AWS profile called “${profile}” on this computer any more. Choose another.`,
    );
  return new CloudError('failed', clean(stderr) || 'The AWS CLI couldn’t hand Conch keys.');
}

/**
 * Keys for one profile, renewed before they expire. One request at a time per
 * profile, so a burst of model calls asks the CLI once.
 */
export class AwsKeys {
  #cache = new Map<string, AwsCredentials>();
  #pending = new Map<string, Promise<AwsCredentials>>();
  /** A failure, kept a few seconds so a page that looks every few seconds doesn't run the CLI each time. */
  #failed = new Map<string, { error: unknown; at: number }>();

  constructor(private readonly deps: AwsDeps) {}

  forget(profile?: string) {
    if (profile) {
      this.#cache.delete(profile);
      this.#failed.delete(profile);
    } else {
      this.#cache.clear();
      this.#failed.clear();
    }
  }

  async credentials(profile: string, options: { force?: boolean } = {}): Promise<AwsCredentials> {
    const now = this.deps.now?.() ?? Date.now();
    const known = this.#cache.get(profile);
    if (!options.force && known && (!known.expiresAt || known.expiresAt - 5 * 60_000 > now))
      return known;
    const failed = this.#failed.get(profile);
    if (!options.force && failed && now - failed.at < 10_000) throw failed.error;
    let pending = this.#pending.get(profile);
    if (!pending) {
      pending = this.#fetch(profile)
        .catch((error: unknown) => {
          this.#failed.set(profile, { error, at: this.deps.now?.() ?? Date.now() });
          throw error;
        })
        .finally(() => this.#pending.delete(profile));
      this.#pending.set(profile, pending);
    }
    const fresh = await pending;
    this.#failed.delete(profile);
    this.#cache.set(profile, fresh);
    return fresh;
  }

  async #fetch(profile: string): Promise<AwsCredentials> {
    const { env } = this.deps;
    if (profile === ENV_ACCOUNT) {
      const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
      const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
      if (!accessKeyId || !secretAccessKey)
        throw new CloudError(
          'not-chosen',
          'The AWS keys in this computer’s settings are gone. Choose another account.',
        );
      return {
        accessKeyId,
        secretAccessKey,
        ...(env.AWS_SESSION_TOKEN?.trim() && { sessionToken: env.AWS_SESSION_TOKEN.trim() }),
      };
    }
    const profiles = await awsProfiles(this.deps);
    const found = profiles.find((p) => p.name === profile);
    if (!found)
      throw new CloudError(
        'not-chosen',
        `There’s no AWS profile called “${profile}” on this computer any more. Choose another.`,
      );
    // Plain keys need no program: read them where the CLI would.
    if (found.kind === 'keys') {
      const credentials = parseIni(
        (await (this.deps.read ?? readText)(credentialsPath(this.deps))) ?? '',
      );
      const values = credentials.get(profile);
      const accessKeyId = values?.get('aws_access_key_id');
      const secretAccessKey = values?.get('aws_secret_access_key');
      if (accessKeyId && secretAccessKey)
        return {
          accessKeyId,
          secretAccessKey,
          ...(values?.get('aws_session_token') && {
            sessionToken: values.get('aws_session_token'),
          }),
        };
    }
    const result = await this.deps.exec.run(
      'aws',
      ['configure', 'export-credentials', '--profile', profile, '--format', 'process'],
      { timeout: 60_000 },
    );
    if (result.code === 127)
      throw new CloudError(
        'missing-tool',
        'Conch uses the AWS CLI to sign in to AWS. Install it, and Conch carries on.',
        {
          need: 'aws-cli',
        },
      );
    if (result.code !== 0) throw awsProblem(result.stderr, profile);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new CloudError('failed', 'The AWS CLI sent keys Conch didn’t understand.');
    }
    const keys = Exported.safeParse(parsed);
    if (!keys.success)
      throw new CloudError('failed', 'The AWS CLI sent keys Conch didn’t understand.');
    const expires = keys.data.Expiration ? Date.parse(keys.data.Expiration) : Number.NaN;
    return {
      accessKeyId: keys.data.AccessKeyId,
      secretAccessKey: keys.data.SecretAccessKey,
      ...(keys.data.SessionToken && { sessionToken: keys.data.SessionToken }),
      // Keys that don't say are asked for again within the hour.
      expiresAt: Number.isFinite(expires)
        ? expires
        : (this.deps.now?.() ?? Date.now()) + 55 * 60_000,
    };
  }

  /**
   * Sign a profile in again: `aws sso login`, with a code that works from any
   * device (`--use-device-code`), falling back to the CLI's default where it's
   * older. The CLI keeps the session; Conch only checks keys come afterwards.
   */
  signIn(profile: string, update: (state: LoginState) => void): LoginHandle {
    return signIn(
      this.deps.exec,
      {
        program: 'aws',
        args: ['sso', 'login', '--profile', profile, '--use-device-code'],
        fallback: ['sso', 'login', '--profile', profile],
        hosts: /(^|\.)(awsapps\.com|amazonaws\.com|aws\.amazon\.com|signin\.aws|aws)$/,
        code: /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/,
        waiting: 'Sign in to AWS on the page that opens. This updates by itself.',
        verify: async () => {
          this.forget(profile);
          await this.credentials(profile, { force: true });
          return true;
        },
        done: `Signed in to AWS as “${profile}”.`,
      },
      update,
    );
  }
}
