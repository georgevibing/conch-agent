import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeExec, files } from '../../clouds/fakes';
import { CloudService } from '../../clouds/service';
import { problemOf } from './engine';
import { azureVariant, bedrockVariant, probed, vertexVariant } from './clouds';
import {
  fakeFetch,
  fakeHome,
  failure,
  jsonResponse,
  namedFrames,
  sseResponse,
  type FakeCall,
} from './fake';
import type { WireEvent } from './types';

const HOME = '/home/ada';
const KEY_ID = 'ASIA' + 'EXAMPLEEXAMPLE02';
const SECRET = 'not-a-real-' + 'aws-secret';
const AWS_CONFIG = `
[profile dev]
sso_session = acme
sso_account_id = 111122223333
sso_role_name = BedrockDeveloper
region = eu-west-1
[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
`;
const SSO = join(
  HOME,
  '.aws',
  'sso',
  'cache',
  `${createHash('sha1').update('acme').digest('hex')}.json`,
);
const exported = JSON.stringify({
  Version: 1,
  AccessKeyId: KEY_ID,
  SecretAccessKey: SECRET,
  SessionToken: 'session',
});

/** A reply streamed the way the Messages API streams it. */
const REPLY = namedFrames(
  [
    'message_start',
    { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } },
  ],
  [
    'content_block_start',
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ],
  [
    'content_block_delta',
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello from your cloud' },
    },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  [
    'message_delta',
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  ],
  ['message_stop', { type: 'message_stop' }],
);

async function drain(events: AsyncIterable<WireEvent>) {
  const out: WireEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function bedrock(
  handler: (call: FakeCall) => Response,
  exec = fakeExec({ 'aws configure export-credentials': { stdout: exported } }),
) {
  const { settings } = await fakeHome();
  const clouds = new CloudService({
    settings,
    exec: exec.exec,
    env: {},
    home: HOME,
    read: files({
      [join(HOME, '.aws', 'config')]: AWS_CONFIG,
      [SSO]: JSON.stringify({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    }),
  });
  const http = fakeFetch(handler);
  const variant = bedrockVariant({ clouds, fetch: http.fetch, home: HOME });
  return { clouds, variant, http, exec };
}

/** Bedrock's answers: Opus and Sonnet are on for this account; the rest aren't. */
function bedrockCloud(call: FakeCall): Response {
  if (call.url.startsWith('https://bedrock.')) return jsonResponse({ modelSummaries: [] });
  if (call.url.endsWith('/count_tokens')) {
    const model = (call.body as { model: string }).model;
    return /opus-5-5|sonnet-5-5/.test(model)
      ? jsonResponse({ input_tokens: 8 })
      : jsonResponse(
          { message: 'You don’t have access to the model with the specified model ID.' },
          403,
        );
  }
  return sseResponse(REPLY);
}

describe('Amazon Bedrock', () => {
  it('isn’t ready until someone picks an account, so no bill starts by itself', async () => {
    const { variant, http } = await bedrock(bedrockCloud);
    const status = await variant.status?.();
    expect(status).toMatchObject({ state: 'signed-out' });
    expect(status?.message).toMatch(/Choose the AWS account/);
    expect(http.calls).toHaveLength(0);
  });

  it('offers only the models the account can use, asked about for free', async () => {
    const { clouds, variant, http } = await bedrock(bedrockCloud);
    await clouds.choose('bedrock', { account: 'dev' });
    const status = await variant.status?.();
    expect(status).toMatchObject({
      state: 'ready',
      auth: { method: 'bedrock', description: 'Amazon Bedrock · dev · eu-west-1 · 2 models' },
    });
    const models = await variant.wire.models({});
    expect(models.map((m) => m.info.id)).toEqual([
      'anthropic.claude-opus-5-5',
      'anthropic.claude-sonnet-5-5',
    ]);
    expect(models[0]?.info).toMatchObject({ label: 'Claude Opus 5.5', context: 1_000_000 });
    expect(models[0]?.info.efforts).toContain('xhigh');
    // Only free token counts and the model list were asked: no message was sent.
    expect(
      http.calls.every(
        (c) => c.url.endsWith('/count_tokens') || c.url.includes('/foundation-models'),
      ),
    ).toBe(true);
  });

  it('signs each request with the AWS sign-in, and streams the answer', async () => {
    const { clouds, variant, http } = await bedrock(bedrockCloud);
    await clouds.choose('bedrock', { account: 'dev' });
    const events = await drain(
      variant.wire.stream({
        key: '',
        model: 'anthropic.claude-opus-5-5',
        system: 'Be brief.',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
        effort: 'auto',
        signal: new AbortController().signal,
      }),
    );
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e.type === 'text' ? e.delta : ''))
        .join(''),
    ).toBe('Hello from your cloud');
    const sent = http.calls.at(-1);
    expect(sent?.url).toBe('https://bedrock-mantle.eu-west-1.api.aws/anthropic/v1/messages');
    expect(sent?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=ASIAEXAMPLEEXAMPLE02\/\d{8}\/eu-west-1\/bedrock-mantle\/aws4_request, SignedHeaders=anthropic-version;content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
    );
    expect(sent?.headers['x-amz-security-token']).toBe('session');
    expect(sent?.body).toMatchObject({ model: 'anthropic.claude-opus-5-5', stream: true });
    // The secret signs; it never travels.
    expect(JSON.stringify(http.calls)).not.toContain(SECRET);
  });

  it('takes a Bedrock API key instead, sent as it is and never signed', async () => {
    const { variant, http } = await bedrock(bedrockCloud);
    const key = 'ABSK' + 'QmVkcm9ja0FQSUtleS1leGFtcGxlLXRlc3Q=';
    const status = await variant.status?.(key);
    expect(status?.state).toBe('ready');
    const count = http.calls.find((c) => c.url.endsWith('/count_tokens'));
    expect(count?.headers['x-api-key']).toBe(key);
    expect(count?.headers.authorization).toBeUndefined();
    expect(count?.url).not.toContain(key);
  });

  it('says a sign-in that ended in plain words, with one press to sign in again', async () => {
    const ended = fakeExec({
      'aws configure export-credentials': {
        code: 255,
        stderr: 'Error loading SSO Token: Token for acme does not exist',
      },
    });
    const { clouds, variant } = await bedrock(bedrockCloud, ended);
    await clouds.choose('bedrock', { account: 'dev' });
    const status = await variant.status?.();
    expect(status).toMatchObject({
      state: 'signed-out',
      canSignIn: true,
      message: 'Your AWS sign-in for “dev” has ended. Sign in to AWS again.',
    });
  });

  it('a turn that meets an ended sign-in asks for the sign-in, not a dead end', async () => {
    const ended = fakeExec({
      'aws configure export-credentials': {
        code: 255,
        stderr: 'Token has expired and refresh failed',
      },
    });
    const { clouds, variant } = await bedrock(bedrockCloud, ended);
    await clouds.choose('bedrock', { account: 'dev' });
    const error = await failure(
      drain(
        variant.wire.stream({
          key: '',
          model: 'anthropic.claude-opus-5-5',
          system: '',
          messages: [{ role: 'user', content: 'Hi' }],
          tools: [],
          effort: 'auto',
          signal: new AbortController().signal,
        }),
      ),
    );
    expect(problemOf(error)).toBe('signed-out');
  });

  it('offers to install the AWS CLI when a sign-in needs it', async () => {
    const { clouds, variant } = await bedrock(bedrockCloud, fakeExec({}, { present: [] }));
    await clouds.choose('bedrock', { account: 'dev' });
    expect(await variant.status?.()).toMatchObject({
      state: 'not-installed',
      fix: { need: 'aws-cli', kind: 'install' },
    });
  });

  it('a throttle is a limit another provider can answer for', async () => {
    const { clouds, variant } = await bedrock((call) =>
      call.url.endsWith('/count_tokens')
        ? bedrockCloud(call)
        : jsonResponse(
            { type: 'error', error: { type: 'rate_limit_error', message: 'Too many tokens' } },
            429,
            { 'retry-after': '3' },
          ),
    );
    await clouds.choose('bedrock', { account: 'dev' });
    await variant.wire.models({});
    const error = await failure(
      drain(
        variant.wire.stream({
          key: '',
          model: 'anthropic.claude-opus-5-5',
          system: '',
          messages: [{ role: 'user', content: 'Hi' }],
          tools: [],
          effort: 'auto',
          signal: new AbortController().signal,
        }),
      ),
    );
    expect(problemOf(error)).toBe('limit');
  });

  it('refuses a model id that isn’t a Bedrock Claude id before it reaches an address', async () => {
    const { clouds, variant, http } = await bedrock(bedrockCloud);
    await clouds.choose('bedrock', { account: 'dev' });
    const error = await failure(
      variant.wire.complete({
        key: '',
        model: '../../evil',
        system: '',
        prompt: 'x',
        maxTokens: 10,
        signal: new AbortController().signal,
      }),
    );
    expect(error.kind).toBe('not-found');
    expect(http.calls).toHaveLength(0);
  });

  it('tells a person when the account has no Claude in that region', async () => {
    const { clouds, variant } = await bedrock((call) =>
      call.url.endsWith('/count_tokens')
        ? jsonResponse({ message: 'denied' }, 403)
        : jsonResponse({}),
    );
    await clouds.choose('bedrock', { account: 'dev', region: 'us-east-1' });
    const status = await variant.status?.();
    expect(status?.state).toBe('error');
    expect(status?.message).toMatch(/can’t use Claude in us-east-1 yet/);
  });
});

describe('what a free token count says', () => {
  it('reads each answer', () => {
    expect(probed(200, '')).toBe('yes');
    expect(probed(403, 'no access')).toBe('no');
    expect(probed(404, '')).toBe('no');
    expect(probed(429, 'slow down')).toBe('unsure');
    expect(() => probed(401, 'bad sign-in')).toThrow();
  });
});

describe('Google Vertex AI', () => {
  async function vertex(handler: (call: FakeCall) => Response) {
    const { settings } = await fakeHome();
    const clouds = new CloudService({
      settings,
      exec: fakeExec({
        'gcloud auth application-default print-access-token': {
          stdout: 'ya29.a-token-for-tests-only\n',
        },
        'gcloud projects list': {
          stdout: JSON.stringify([{ projectId: 'acme-ml', name: 'Acme ML' }]),
        },
      }).exec,
      env: {},
      home: HOME,
      read: files({
        [join(HOME, '.config', 'gcloud', 'application_default_credentials.json')]:
          '{"type":"authorized_user"}',
      }),
    });
    const http = fakeFetch(handler);
    return { clouds, http, variant: vertexVariant({ clouds, fetch: http.fetch, home: HOME }) };
  }

  it('sends Claude to Vertex the way Vertex takes it, billed to the chosen project', async () => {
    const { clouds, http, variant } = await vertex((call) =>
      call.url.includes('count-tokens')
        ? /opus-5-5/.test((call.body as { model: string }).model)
          ? jsonResponse({ input_tokens: 3 })
          : jsonResponse({ error: { message: 'Publisher model not found' } }, 404)
        : sseResponse(REPLY),
    );
    await clouds.choose('vertex', { account: 'acme-ml' });
    expect(await variant.status?.()).toMatchObject({
      state: 'ready',
      auth: { method: 'vertex', description: 'Google Vertex AI · Acme ML · Global · 1 model' },
    });
    await drain(
      variant.wire.stream({
        key: '',
        model: 'claude-opus-5-5',
        system: '',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
        effort: 'auto',
        signal: new AbortController().signal,
      }),
    );
    const sent = http.calls.at(-1);
    expect(sent?.url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/acme-ml/locations/global/publishers/anthropic/models/claude-opus-5-5:streamRawPredict',
    );
    expect(sent?.headers.authorization).toBe('Bearer ya29.a-token-for-tests-only');
    expect(sent?.headers['x-goog-user-project']).toBe('acme-ml');
    expect(sent?.body).toMatchObject({ anthropic_version: 'vertex-2023-10-16', stream: true });
    expect((sent?.body as Record<string, unknown>).model).toBeUndefined();
  });

  it('uses the multi-region host for the EU', async () => {
    const { clouds, http, variant } = await vertex(() => jsonResponse({ input_tokens: 3 }));
    await clouds.choose('vertex', { account: 'acme-ml', region: 'eu' });
    await variant.wire.models({});
    expect(http.calls[0]?.url).toMatch(
      /^https:\/\/aiplatform\.eu\.rep\.googleapis\.com\/v1\/projects\/acme-ml\/locations\/eu\//,
    );
  });
});

describe('Azure OpenAI', () => {
  const SUB = '0b1f6471-1bf0-4dda-aec3-111122223333';
  const RESOURCE = `/subscriptions/${SUB}/resourceGroups/ai/providers/Microsoft.CognitiveServices/accounts/acme-openai`;

  it('lists your deployments and talks to your own resource with your Azure sign-in', async () => {
    const { settings } = await fakeHome();
    const http = fakeFetch((call) => {
      if (call.url.includes('/deployments'))
        return jsonResponse({
          value: [
            { name: 'chat-4-1', properties: { model: { name: 'gpt-4.1', format: 'OpenAI' } } },
            {
              name: 'search-embeddings',
              properties: { model: { name: 'text-embedding-3-large', format: 'OpenAI' } },
            },
          ],
        });
      if (call.url.startsWith('https://management.azure.com/'))
        return jsonResponse({
          value: [
            {
              id: RESOURCE,
              name: 'acme-openai',
              kind: 'OpenAI',
              location: 'swedencentral',
              properties: { endpoint: 'https://acme-openai.openai.azure.com/' },
            },
          ],
        });
      return jsonResponse({
        id: 'x',
        choices: [{ message: { role: 'assistant', content: 'hello' } }],
      });
    });
    const clouds = new CloudService({
      settings,
      exec: fakeExec({
        'az account get-access-token': {
          stdout: JSON.stringify({
            accessToken: 'eyJ.fake-azure-token.x',
            expires_on: 1_900_000_000,
          }),
        },
      }).exec,
      env: {},
      home: HOME,
      fetch: http.fetch,
      read: files({
        [join(HOME, '.azure', 'azureProfile.json')]: JSON.stringify({
          subscriptions: [{ id: SUB, name: 'Acme', state: 'Enabled', isDefault: true }],
        }),
      }),
    });
    const variant = azureVariant({ clouds, fetch: http.fetch, home: HOME });
    expect((await variant.status?.())?.state).toBe('signed-out');
    await clouds.choose('azure-openai', { account: RESOURCE });
    expect(await variant.status?.()).toMatchObject({
      state: 'ready',
      auth: {
        method: 'foundry',
        description: 'Azure OpenAI · acme-openai · swedencentral · 1 deployment',
      },
    });
    const models = await variant.wire.models({});
    expect(models.map((m) => m.info.id)).toEqual(['chat-4-1']);
    expect(models[0]?.info.images).toBe(true);
    await variant.wire.complete({
      key: '',
      model: 'chat-4-1',
      system: '',
      prompt: 'hi',
      maxTokens: 10,
      signal: new AbortController().signal,
    });
    const sent = http.calls.at(-1);
    expect(sent?.url).toBe('https://acme-openai.openai.azure.com/openai/v1/chat/completions');
    expect(sent?.headers.authorization).toBe('Bearer eyJ.fake-azure-token.x');
  });
});
