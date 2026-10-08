import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { LoginState } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { awsAccounts, awsProfiles, AwsKeys, ENV_ACCOUNT, ssoState } from './aws';
import { CloudError } from './errors';
import { fakeExec, files } from './fakes';
import { parseIni } from './ini';

const HOME = '/home/ada';
const NOW = Date.UTC(2026, 9, 8, 12);
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
const cache = (name: string) => join(HOME, '.aws', 'sso', 'cache', `${sha1(name)}.json`);
// Written in two parts so it never reads as a real key to a scanner.
const KEY_ID = 'AKIA' + 'EXAMPLEEXAMPLE00';
const SECRET = 'not-a-real-' + 'secret-value';

const CONFIG = `
# Work, through the company's start page
[profile dev]
sso_session = acme
sso_account_id = 111122223333
sso_role_name = BedrockDeveloper
region = eu-west-1

[profile admin]
sso_session = acme
sso_account_id = 111122223333
sso_role_name = AdministratorAccess

[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access

[profile legacy]
sso_start_url = https://old.awsapps.com/start
sso_region = us-east-1
sso_account_id = 444455556666
sso_role_name = ReadOnly

[profile ops]
role_arn = arn:aws:iam::777788889999:role/Ops
source_profile = default

[profile vault]
credential_process = aws-vault export --format=json ops

[default]
region = us-west-2
s3 =
  max_concurrent_requests = 20
`;

const CREDENTIALS = `
[default]
aws_access_key_id = ${KEY_ID}
aws_secret_access_key = ${SECRET}
`;

function deps(extra: Record<string, string> = {}, env: NodeJS.ProcessEnv = {}) {
  return {
    home: HOME,
    env,
    now: () => NOW,
    read: files({
      [join(HOME, '.aws', 'config')]: CONFIG,
      [join(HOME, '.aws', 'credentials')]: CREDENTIALS,
      ...extra,
    }),
  };
}

describe('the INI the AWS CLI writes', () => {
  it('reads sections, comments and nested blocks', () => {
    const ini = parseIni(CONFIG);
    expect(ini.get('profile dev')?.get('sso_session')).toBe('acme');
    expect(ini.get('default')?.get('region')).toBe('us-west-2');
    expect(ini.get('default')?.get('s3')).toContain('max_concurrent_requests');
  });
});

describe('AWS profiles on this computer', () => {
  it('finds every kind, without reading a secret into the list', async () => {
    const { exec } = fakeExec();
    const profiles = await awsProfiles({ ...deps(), exec });
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
    expect(byName.dev).toMatchObject({
      kind: 'sso',
      ssoSession: 'acme',
      role: 'BedrockDeveloper',
      region: 'eu-west-1',
    });
    expect(byName.legacy).toMatchObject({ kind: 'sso', startUrl: 'https://old.awsapps.com/start' });
    expect(byName.ops).toMatchObject({
      kind: 'role',
      account: '777788889999',
      role: 'Ops',
      source: 'default',
    });
    expect(byName.vault?.kind).toBe('process');
    expect(byName.default).toMatchObject({ kind: 'keys', region: 'us-west-2' });
    expect(JSON.stringify(profiles)).not.toContain(SECRET);
  });

  it('says whether single sign-on is still good, from the dates alone', async () => {
    const { exec } = fakeExec();
    const fresh = JSON.stringify({
      accessToken: 't',
      expiresAt: new Date(NOW + 3_600_000).toISOString(),
    });
    const ended = JSON.stringify({
      accessToken: 't',
      expiresAt: new Date(NOW - 60_000).toISOString(),
    });
    const renews = JSON.stringify({
      accessToken: 't',
      expiresAt: new Date(NOW - 60_000).toISOString(),
      refreshToken: 'r',
      registrationExpiresAt: new Date(NOW + 86_400_000).toISOString(),
    });
    const dev = { name: 'dev', kind: 'sso' as const, ssoSession: 'acme' };
    expect(await ssoState(dev, { ...deps({ [cache('acme')]: fresh }), exec })).toBe('ready');
    expect(await ssoState(dev, { ...deps({ [cache('acme')]: ended }), exec })).toBe('expired');
    expect(await ssoState(dev, { ...deps({ [cache('acme')]: renews }), exec })).toBe('ready');
    expect(await ssoState(dev, { ...deps(), exec })).toBe('signed-out');
    // An older profile's cache is named for its start page.
    const legacy = {
      name: 'legacy',
      kind: 'sso' as const,
      startUrl: 'https://old.awsapps.com/start',
    };
    expect(
      await ssoState(legacy, {
        ...deps({ [cache('https://old.awsapps.com/start')]: fresh }),
        exec,
      }),
    ).toBe('ready');
  });

  it('offers signed-in, narrower accounts first and never an admin role first', async () => {
    const { exec } = fakeExec();
    const fresh = JSON.stringify({ expiresAt: new Date(NOW + 3_600_000).toISOString() });
    const accounts = await awsAccounts({ ...deps({ [cache('acme')]: fresh }), exec });
    const admin = accounts.find((a) => a.id === 'admin');
    expect(admin?.broad).toBe(true);
    expect(accounts.findIndex((a) => a.id === 'dev')).toBeLessThan(
      accounts.findIndex((a) => a.id === 'admin'),
    );
    expect(accounts.find((a) => a.id === 'dev')?.detail).toBe(
      'Single sign-on · BedrockDeveloper · account …3333',
    );
    // A role is as signed in as the profile whose keys assume it.
    expect(accounts.find((a) => a.id === 'ops')?.state).toBe('ready');
    expect(accounts.find((a) => a.id === 'default')?.isDefault).toBe(true);
  });

  it('offers keys from the environment as their own account', async () => {
    const { exec } = fakeExec();
    const accounts = await awsAccounts({
      ...deps(
        {},
        { AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: SECRET, AWS_REGION: 'us-east-2' },
      ),
      exec,
    });
    expect(accounts.find((a) => a.id === ENV_ACCOUNT)).toMatchObject({
      kind: 'env',
      region: 'us-east-2',
    });
  });
});

describe('AWS keys for a request', () => {
  const exported = JSON.stringify({
    Version: 1,
    AccessKeyId: 'ASIA' + 'EXAMPLEEXAMPLE01',
    SecretAccessKey: SECRET,
    SessionToken: 'session',
    Expiration: new Date(NOW + 3_600_000).toISOString(),
  });

  it('asks the AWS CLI once, then keeps the keys until shortly before they end', async () => {
    const { exec, calls } = fakeExec({ 'aws configure export-credentials': { stdout: exported } });
    const keys = new AwsKeys({ ...deps(), exec });
    const [one, two] = await Promise.all([keys.credentials('dev'), keys.credentials('dev')]);
    expect(one).toEqual(two);
    expect(one.sessionToken).toBe('session');
    await keys.credentials('dev');
    expect(calls.filter((c) => c.program === 'aws')).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      'configure',
      'export-credentials',
      '--profile',
      'dev',
      '--format',
      'process',
    ]);
  });

  it('reads plain access keys itself, with no program needed', async () => {
    const { exec, calls } = fakeExec({}, { present: [] });
    const keys = new AwsKeys({ ...deps(), exec });
    expect(await keys.credentials('default')).toMatchObject({ accessKeyId: KEY_ID });
    expect(calls).toHaveLength(0);
  });

  it('turns a sign-in that ended into one plain next step', async () => {
    const { exec } = fakeExec({
      'aws configure export-credentials': {
        code: 255,
        stderr: 'Error when retrieving token from sso: Token has expired and refresh failed',
      },
    });
    const error = await new AwsKeys({ ...deps(), exec })
      .credentials('dev')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as CloudError).problem).toBe('signed-out');
    expect((error as CloudError).kind).toBe('auth');
    expect((error as CloudError).message).toBe(
      'Your AWS sign-in for “dev” has ended. Sign in to AWS again.',
    );
  });

  it('offers to install the AWS CLI when it isn’t here', async () => {
    const { exec } = fakeExec({}, { present: [] });
    const error = (await new AwsKeys({ ...deps(), exec })
      .credentials('dev')
      .catch((e: unknown) => e)) as CloudError;
    expect(error.problem).toBe('missing-tool');
    expect(error.need).toBe('aws-cli');
  });

  it('says so when a profile is gone, instead of guessing another', async () => {
    const { exec } = fakeExec();
    const error = (await new AwsKeys({ ...deps(), exec })
      .credentials('gone')
      .catch((e: unknown) => e)) as CloudError;
    expect(error.problem).toBe('not-chosen');
  });
});

describe('signing in to AWS again', () => {
  it('shows the device page and code, then checks keys come', async () => {
    const { exec, calls } = fakeExec(
      {
        'aws configure export-credentials': {
          stdout: JSON.stringify({ Version: 1, AccessKeyId: KEY_ID, SecretAccessKey: SECRET }),
        },
      },
      {
        signIn: {
          lines: [
            'Attempting to automatically open the SSO authorization page in your default browser.',
            'If the browser does not open, open the following URL:',
            'https://device.sso.eu-west-1.amazonaws.com/',
            'Then enter the code:',
            'WDQK-PLVR',
            'Successfully logged into Start URL: https://acme.awsapps.com/start',
          ],
        },
      },
    );
    const states: LoginState[] = [];
    new AwsKeys({ ...deps(), exec }).signIn('dev', (s) => states.push(s));
    await expect.poll(() => states.at(-1)?.phase).toBe('done');
    const waiting = states.filter((s) => s.phase === 'waiting-for-browser').at(-1);
    expect(waiting).toMatchObject({
      url: 'https://device.sso.eu-west-1.amazonaws.com/',
      code: 'WDQK-PLVR',
    });
    expect(calls[0]?.args).toEqual(['sso', 'login', '--profile', 'dev', '--use-device-code']);
  });

  it('never shows a page that isn’t AWS’s own', async () => {
    const { exec } = fakeExec(
      { 'aws configure export-credentials': { code: 1, stderr: 'Token has expired' } },
      { signIn: { lines: ['Open https://evil.example/login'], code: 1 } },
    );
    const states: LoginState[] = [];
    new AwsKeys({ ...deps(), exec }).signIn('dev', (s) => states.push(s));
    await expect.poll(() => states.at(-1)?.phase).toBe('failed');
    expect(states.some((s) => s.url?.includes('evil'))).toBe(false);
  });
});
