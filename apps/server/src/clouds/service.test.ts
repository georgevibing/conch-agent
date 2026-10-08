import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeFetch, jsonResponse } from '../engines/api/fake';
import { SettingsStore } from '../settings/store';
import { azureEndpoint, AzureCloud, azureSubscriptions } from './azure';
import { CloudError } from './errors';
import { fakeExec, files } from './fakes';
import { activeProject, adc, GcpCloud } from './gcp';
import { CloudService } from './service';

const HOME = '/home/ada';
const GCLOUD = join(HOME, '.config', 'gcloud');
const SUB = '0b1f6471-1bf0-4dda-aec3-111122223333';
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const RESOURCE = `/subscriptions/${SUB}/resourceGroups/ai/providers/Microsoft.CognitiveServices/accounts/acme-openai`;

async function settings() {
  return new SettingsStore(await mkdtemp(join(tmpdir(), 'conch-clouds-')));
}

const AWS_CONFIG = `
[profile dev]
sso_session = acme
sso_account_id = 111122223333
sso_role_name = BedrockDeveloper
region = eu-west-1
[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
`;

describe('Google Cloud on this computer', () => {
  const read = files({
    [join(GCLOUD, 'application_default_credentials.json')]: JSON.stringify({
      type: 'authorized_user',
      quota_project_id: 'acme-billing',
      client_secret: 'never-read-into-conch',
    }),
    [join(GCLOUD, 'active_config')]: 'work\n',
    [join(GCLOUD, 'configurations', 'config_work')]:
      '[core]\nproject = acme-ml\naccount = ada@acme.com\n',
  });
  const base = { home: HOME, env: {}, read, platform: 'linux' as const };

  it('finds the credentials and the project without reading their secrets', async () => {
    const found = await adc({ ...base, exec: fakeExec().exec });
    expect(found).toEqual({ present: true, kind: 'authorized_user', project: 'acme-billing' });
    expect(JSON.stringify(found)).not.toContain('never-read');
    expect(await activeProject({ ...base, exec: fakeExec().exec })).toBe('acme-ml');
  });

  it('lists projects from gcloud, the active one first', async () => {
    const { exec } = fakeExec({
      'gcloud projects list': {
        stdout: JSON.stringify([
          { projectId: 'zeta-lab', name: 'Zeta', lifecycleState: 'ACTIVE' },
          { projectId: 'acme-ml', name: 'Acme ML', lifecycleState: 'ACTIVE' },
          { projectId: 'old-thing', lifecycleState: 'DELETE_REQUESTED' },
        ]),
      },
    });
    const projects = await new GcpCloud({ ...base, exec }).projects();
    expect(projects.map((p) => p.id)).toEqual(['acme-ml', 'acme-billing', 'zeta-lab']);
    expect(projects[0]).toMatchObject({ label: 'Acme ML', isDefault: true, state: 'ready' });
  });

  it('keeps a token for its hour, and says a sign-in that ended plainly', async () => {
    let n = 0;
    const { exec } = fakeExec({
      'gcloud auth application-default print-access-token': () => ({
        stdout: `ya29.token-number-${++n}-padding\n`,
      }),
    });
    const gcp = new GcpCloud({ ...base, exec });
    expect(await gcp.token()).toBe('ya29.token-number-1-padding');
    expect(await gcp.token()).toBe('ya29.token-number-1-padding');
    const ended = fakeExec({
      'gcloud auth application-default print-access-token': {
        code: 1,
        stderr:
          'ERROR: (gcloud.auth.application-default.print-access-token) Reauthentication failed. invalid_grant',
      },
    });
    const error = (await new GcpCloud({ ...base, exec: ended.exec })
      .token()
      .catch((e: unknown) => e)) as CloudError;
    expect(error.problem).toBe('signed-out');
  });
});

describe('Azure on this computer', () => {
  const profile = `\uFEFF${JSON.stringify({
    subscriptions: [
      { id: SUB, name: 'Acme Prod AI', state: 'Enabled', isDefault: true, tenantId: TENANT },
      { id: '11111111-2222-3333-4444-555555555555', name: 'Old', state: 'Disabled' },
    ],
  })}`;
  const read = files({ [join(HOME, '.azure', 'azureProfile.json')]: profile });
  const token = {
    'az account get-access-token': {
      stdout: JSON.stringify({
        accessToken: 'eyJ.fake-token-for-tests.x',
        expires_on: 1_900_000_000,
      }),
    },
  };

  it('reads the CLI’s subscriptions, byte-order mark and all, enabled ones only', async () => {
    const subs = await azureSubscriptions({ home: HOME, env: {}, read, exec: fakeExec().exec });
    expect(subs).toEqual([{ id: SUB, name: 'Acme Prod AI', tenant: TENANT, isDefault: true }]);
  });

  it('only ever sends a token to Microsoft’s own addresses', () => {
    expect(azureEndpoint('https://acme-openai.openai.azure.com/')).toBe(
      'https://acme-openai.openai.azure.com',
    );
    expect(azureEndpoint('https://acme.cognitiveservices.azure.com')).toBe(
      'https://acme.cognitiveservices.azure.com',
    );
    expect(azureEndpoint('http://acme.openai.azure.com')).toBeUndefined();
    expect(azureEndpoint('https://acme.openai.azure.com.evil.example')).toBeUndefined();
    expect(azureEndpoint('https://acme.openai.azure.com:8443')).toBeUndefined();
    expect(azureEndpoint('https://evil.example/?x=.openai.azure.com')).toBeUndefined();
  });

  it('lists the resources and their chat deployments through the management API, read only', async () => {
    const http = fakeFetch((call) => {
      expect(call.method).toBe('GET');
      expect(call.headers.authorization).toBe('Bearer eyJ.fake-token-for-tests.x');
      if (call.url.includes('/deployments'))
        return jsonResponse({
          value: [
            {
              name: 'chat',
              properties: {
                model: { name: 'gpt-4.1', format: 'OpenAI' },
                provisioningState: 'Succeeded',
              },
            },
            {
              name: 'half',
              properties: { model: { name: 'gpt-4o' }, provisioningState: 'Creating' },
            },
          ],
        });
      return jsonResponse({
        value: [
          {
            id: RESOURCE,
            name: 'acme-openai',
            kind: 'OpenAI',
            location: 'swedencentral',
            properties: {
              endpoint: 'https://acme-openai.openai.azure.com/',
              provisioningState: 'Succeeded',
            },
          },
          {
            id: `/subscriptions/${SUB}/resourceGroups/ai/providers/Microsoft.CognitiveServices/accounts/speech`,
            name: 'speech',
            kind: 'SpeechServices',
            properties: { endpoint: 'https://speech.cognitiveservices.azure.com/' },
          },
          {
            id: `/subscriptions/${SUB}/resourceGroups/ai/providers/Microsoft.CognitiveServices/accounts/odd`,
            name: 'odd',
            kind: 'OpenAI',
            properties: { endpoint: 'https://odd.example.com/' },
          },
        ],
      });
    });
    const azure = new AzureCloud({
      home: HOME,
      env: {},
      read,
      exec: fakeExec(token).exec,
      fetch: http.fetch,
    });
    const resources = await azure.resources();
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      endpoint: 'https://acme-openai.openai.azure.com',
      subscription: SUB,
      tenant: TENANT,
      account: { label: 'acme-openai', detail: 'Azure OpenAI · swedencentral · Acme Prod AI' },
    });
    expect((await azure.deployments(RESOURCE, TENANT)).map((d) => d.name)).toEqual(['chat']);
    expect(http.calls.every((c) => c.url.startsWith('https://management.azure.com/'))).toBe(true);
  });

  it('refuses a resource id that isn’t one', async () => {
    const azure = new AzureCloud({ home: HOME, env: {}, read, exec: fakeExec(token).exec });
    await expect(azure.deployments('/subscriptions/x/../../evil')).rejects.toBeInstanceOf(
      CloudError,
    );
  });
});

describe('choosing a cloud account', () => {
  const read = files({ [join(HOME, '.aws', 'config')]: AWS_CONFIG });

  it('takes only an account this computer has, in a real region', async () => {
    const store = await settings();
    const changed: string[] = [];
    const clouds = new CloudService({
      settings: store,
      exec: fakeExec().exec,
      env: {},
      home: HOME,
      read,
      onChange: (id) => changed.push(id),
    });
    const picker = await clouds.picker('bedrock');
    expect(picker.accounts.map((a) => a.id)).toEqual(['dev']);
    expect(picker.region).toBe('eu-west-1');
    await expect(clouds.choose('bedrock', { account: 'someone-else' })).rejects.toBeInstanceOf(
      CloudError,
    );
    const chosen = await clouds.choose('bedrock', { account: 'dev', region: 'mars-north-1' });
    // A region that doesn't exist falls back to the profile's own.
    expect(chosen.chosen).toMatchObject({ account: 'dev', region: 'eu-west-1' });
    expect(changed).toEqual(['bedrock']);
    expect((await store.get()).clouds?.bedrock?.account).toBe('dev');
  });

  it('offers a signed-in profile in one press, and stops offering it once chosen', async () => {
    const fresh = JSON.stringify({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const { createHash } = await import('node:crypto');
    const cacheFile = join(
      HOME,
      '.aws',
      'sso',
      'cache',
      `${createHash('sha1').update('acme').digest('hex')}.json`,
    );
    const clouds = new CloudService({
      settings: await settings(),
      exec: fakeExec().exec,
      env: {},
      home: HOME,
      read: files({ [join(HOME, '.aws', 'config')]: AWS_CONFIG, [cacheFile]: fresh }),
    });
    const [found] = await clouds.found(new Set());
    expect(found).toMatchObject({ kind: 'cloud', provider: 'bedrock', name: 'Amazon Bedrock' });
    expect(found?.id).toMatch(/^cloud-bedrock-[0-9a-f]{16}$/);
    expect(await clouds.useFound(found?.id ?? '')).toBe('bedrock');
    expect(await clouds.found(new Set())).toEqual([]);
  });

  it('runs Claude Code on Bedrock or Vertex with the switches Claude Code documents', async () => {
    const clouds = new CloudService({
      settings: await settings(),
      exec: fakeExec().exec,
      env: {},
      home: HOME,
      read: files({
        [join(HOME, '.aws', 'config')]: AWS_CONFIG,
        [join(GCLOUD, 'application_default_credentials.json')]: '{"type":"authorized_user"}',
      }),
    });
    expect(await clouds.claudeEnv()).toEqual({});
    await clouds.claudeCode({ via: 'bedrock', account: 'dev', region: 'us-east-1' });
    expect(await clouds.claudeEnv()).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_PROFILE: 'dev',
      AWS_REGION: 'us-east-1',
    });
    await clouds.claudeCode({ via: 'vertex', account: 'acme-ml' });
    expect(await clouds.claudeEnv()).toEqual({
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: 'acme-ml',
      CLOUD_ML_REGION: 'global',
    });
    await clouds.claudeCode({ via: 'anthropic' });
    expect(await clouds.claudeEnv()).toEqual({});
  });

  it('never runs anything that writes the clouds’ own files', async () => {
    const { exec, calls } = fakeExec();
    const clouds = new CloudService({
      settings: await settings(),
      exec,
      env: {},
      home: HOME,
      read,
    });
    await clouds.picker('bedrock');
    await clouds.picker('vertex');
    await clouds.picker('azure-openai');
    await clouds.found(new Set());
    for (const call of calls)
      expect(call.args.join(' ')).not.toMatch(
        /configure set|config set|login|logout|create|delete/,
      );
  });
});
