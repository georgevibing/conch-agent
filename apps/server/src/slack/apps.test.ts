import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent } from '@conch/protocol';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockSlack } from '../channels/mock/slack';
import { MockEngine } from '../engines/mock/engine';
import { hostedApps } from '../integrations/hosted';
import { IntegrationService } from '../integrations/service';
import { SlackApps } from './apps';
import { slackRoutes } from './routes';
import { SlackService } from './service';
import { SlackStore } from './store';

const mock = new MockSlack();
let home: string;
let events: ServerEvent[];
let slack: SlackService;
let apps: SlackApps;
let integrations: IntegrationService;

beforeAll(async () => {
  await mock.start();
});
afterAll(async () => {
  await mock.stop();
});

function make() {
  events = [];
  slack = new SlackService({
    store: new SlackStore(home),
    base: () => mock.api,
    manualChecks: true,
    emit: () => void apps.changed(),
  });
  apps = new SlackApps(slack, { emit: (event) => events.push(event) });
  integrations = new IntegrationService({
    home,
    emit: (event) => events.push(event),
    engines: async () => [new MockEngine()],
    cwd: async () => home,
    manualChecks: true,
    hosted: hostedApps(apps),
  });
}

beforeEach(async () => {
  mock.resetUser();
  home = await mkdtemp(join(tmpdir(), 'conch-slack-app-'));
  make();
});
afterEach(async () => {
  slack.stop();
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Slack is an app like Gmail (ADR 0052)', () => {
  it('is listed, opened, switched, checked and removed the same way as every app', async () => {
    expect((await integrations.list()).integrations).toEqual([]);
    await slack.connect(MockSlack.USER_TOKEN);
    const [listed] = (await integrations.list()).integrations;
    expect(listed).toMatchObject({
      id: 'slack',
      catalogId: 'slack',
      name: 'Slack',
      transport: { type: 'host' },
      enabled: true,
      policy: 'ask-writes',
      health: { state: 'ok' },
      account: 'Mock Workspace · as ada',
    });
    expect(listed?.tools.map((t) => t.name)).toEqual([
      'slack_channels',
      'slack_search',
      'slack_read_channel',
      'slack_send_message',
    ]);
    expect(listed?.tools.find((t) => t.name === 'slack_send_message')?.alwaysAsks).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('xoxp-');

    expect(await integrations.get('slack')).toEqual(listed);
    const off = await integrations.update('slack', { enabled: false });
    expect(off).toMatchObject({ enabled: false, health: { state: 'off' } });
    expect(await integrations.decide('mcp__conch__slack_search')).toBe('off');
    await integrations.update('slack', { enabled: true });

    await integrations.check('slack');
    expect((await integrations.get('slack')).health.state).toBe('ok');

    await integrations.remove('slack');
    expect((await integrations.list()).integrations).toEqual([]);
    expect(mock.userTokens.has(MockSlack.USER_TOKEN)).toBe(false);
  });

  it('holds the same choices as every app: a policy, Allow · Ask · Off per tool, and sending that always asks', async () => {
    await slack.connect(MockSlack.USER_TOKEN);
    expect(await slack.decide('slack_search')).toBe('allow');
    await integrations.update('slack', { policy: 'ask' });
    expect(await slack.decide('slack_search')).toBe('ask');
    expect(await slack.decide('slack_send_message')).toBe('ask');
    await integrations.update('slack', { policy: 'trust' });
    expect(await slack.decide('slack_send_message')).toBe('ask');

    await integrations.update('slack', { tools: { slack_channels: 'off' } });
    expect(await integrations.decide('slack_channels')).toBe('off');
    expect(slack.offers('slack_channels')).toBe(false);
    const back = await integrations.update('slack', { tools: { slack_channels: null } });
    expect(back.tools.find((t) => t.name === 'slack_channels')?.policy).toBeUndefined();

    await expect(
      integrations.update('slack', { tools: { slack_send_message: 'allow' } }),
    ).rejects.toThrow(/always asks/);
    await expect(integrations.update('slack', { tools: { slack_delete: 'off' } })).rejects.toThrow(
      /isn’t one of its tools/,
    );
    await expect(integrations.update('slack', { values: { token: 'xoxp-1' } })).rejects.toThrow(
      /Connect Slack again/,
    );
  });

  it('tells open pages what changed with the same events as every app', async () => {
    await slack.connect(MockSlack.USER_TOKEN);
    await settle();
    expect(
      events.some((e) => e.type === 'integration.changed' && e.integration.id === 'slack'),
    ).toBe(true);
    await slack.disconnect();
    await settle();
    expect(events.at(-1)).toEqual({ type: 'integration.deleted', integrationId: 'slack' });
  });

  it('a Slack connected before keeps working, with its choices, after the update', async () => {
    // slack.secrets.json as the version before wrote it: no policy.
    await writeFile(
      join(home, 'slack.secrets.json'),
      JSON.stringify({
        connection: {
          token: MockSlack.USER_TOKEN,
          generation: 'g1',
          team: 'Mock Workspace',
          user: 'ada',
          userId: 'U0ADA',
          scopes: [
            'channels:read',
            'channels:history',
            'groups:read',
            'groups:history',
            'search:read',
            'users:read',
            'chat:write',
          ],
          connectedAt: 1_700_000_000_000,
        },
        enabled: true,
        tools: { slack_search: 'ask', slack_send_message: 'off' },
        health: { state: 'ok', checkedAt: 1_700_000_000_000 },
      }),
    );
    make();
    const item = await integrations.get('slack');
    expect(item).toMatchObject({
      enabled: true,
      policy: 'ask-writes',
      createdAt: 1_700_000_000_000,
    });
    expect(item.tools.find((t) => t.name === 'slack_search')?.policy).toBe('ask');
    expect(await slack.decide('slack_search')).toBe('ask');
    expect(await slack.decide('slack_read_channel')).toBe('allow');
    expect(await integrations.decide('slack_send_message')).toBe('off');
  });

  it('counts as connected, so the chat doesn’t offer it again', async () => {
    await slack.connect(MockSlack.USER_TOKEN);
    expect(await integrations.about('What did Sam say in Slack about the launch?')).toEqual([
      { name: 'Slack', catalogId: 'slack' },
    ]);
  });
});

describe('setting Slack up', () => {
  const routes = () => {
    const app = Fastify();
    slackRoutes(app, slack, apps, async () => ({
      name: 'Conch',
      workspace: 'Mock Workspace',
      appId: 'A0MOCKAPP',
    }));
    return app;
  };

  it('offers the Slack channel’s app, by name only', async () => {
    const app = routes();
    const setup = await app.inject({ method: 'GET', url: '/api/slack/setup' });
    expect(setup.json()).toEqual({
      channelApp: { name: 'Conch', workspace: 'Mock Workspace', appId: 'A0MOCKAPP' },
    });
    expect(setup.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('a pasted token comes back as the app, never as the token', async () => {
    const app = routes();
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/slack/connect',
      payload: { token: MockSlack.BOT_TOKEN },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toMatch(/User OAuth Token/);
    const made = await app.inject({
      method: 'POST',
      url: '/api/slack/connect',
      payload: { token: MockSlack.USER_TOKEN },
    });
    expect(made.statusCode).toBe(200);
    expect(made.json()).toMatchObject({ id: 'slack', transport: { type: 'host' } });
    expect(made.body).not.toContain('xoxp-');
    // What the page used to call is gone: Slack is opened, switched and removed like every app.
    for (const [method, url] of [
      ['GET', '/api/slack'],
      ['PATCH', '/api/slack'],
      ['DELETE', '/api/slack'],
      ['POST', '/api/slack/check'],
    ] as const)
      expect((await app.inject({ method, url, payload: {} })).statusCode).toBe(404);
    await app.close();
  });
});
