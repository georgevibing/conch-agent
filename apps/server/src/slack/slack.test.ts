import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { classify } from '../backup/manifest';
import { MockSlack } from '../channels/mock/slack';
import type { AskRequest, ToolContext } from '../conversations/manager';
import { sinkReason, taintFrom } from '../conversations/taint';
import type { HostTool, HostToolResult } from '../engines/types';
import { protectedPaths } from '../lib/protect';
import { deviceSealer, registerSealer, SEALED_FILES, unregisterSealer } from '../lib/sealed';
import { needs } from '../skills/permissions';
import { SLACK_WEB_API, slackCall, SlackApiError } from './api';
import { SlackService } from './service';
import { SlackStore } from './store';
import { offeredSlackTools, slackTools } from './tools';

const mock = new MockSlack();
let home: string;
let service: SlackService;
let notes: string[];
let emitted: number;

beforeAll(async () => {
  await mock.start();
});
afterAll(async () => {
  await mock.stop();
});

beforeEach(async () => {
  mock.resetUser();
  home = await mkdtemp(join(tmpdir(), 'conch-slack-'));
  notes = [];
  emitted = 0;
  service = new SlackService({
    store: new SlackStore(home),
    base: () => mock.api,
    manualChecks: true,
    onHeal: (message) => notes.push(message),
    emit: () => emitted++,
  });
});
afterEach(async () => {
  service.stop();
  unregisterSealer(home);
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function context(over: Partial<ToolContext> = {}) {
  const ask = vi.fn(async (_request: AskRequest): Promise<'allow' | 'deny'> => 'allow');
  const ctx = {
    conversationId: 'c1',
    append: () => undefined,
    permissionMode: 'default',
    signal: new AbortController().signal,
    ask,
    ...over,
  } as unknown as ToolContext;
  return { ctx, ask: (over.ask as typeof ask | undefined) ?? ask };
}

function tool(ctx: ToolContext, name: string): HostTool {
  const found = slackTools(service, ctx).find((t) => t.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
}

const text = (result: string | HostToolResult) =>
  typeof result === 'string' ? result : result.text;

describe('connecting Slack', () => {
  it('says which key it needs when another one is pasted, and saves nothing', async () => {
    await expect(service.connect(MockSlack.BOT_TOKEN)).rejects.toThrow(/bot token.*xoxp-/);
    await expect(service.connect(MockSlack.APP_TOKEN)).rejects.toThrow(/app-level token/);
    await expect(service.connect('hello there')).rejects.toThrow(/starts with xoxp-/);
    await expect(service.connect('xoxp-' + '0000000000-0000000000-wrongwrongwrong')).rejects.toThrow(
      /doesn’t accept that token/,
    );
    expect((await service.status()).connected).toBe(false);
  });

  it('names what an app made before is missing, instead of half-working', async () => {
    await expect(service.connect(MockSlack.NARROW_USER_TOKEN)).rejects.toThrow(
      /can’t see your channels, read your channels.*or search yet/,
    );
    expect((await service.status()).connected).toBe(false);
  });

  it('keeps the token sealed and never says it back', async () => {
    registerSealer(
      home,
      deviceSealer(async () => Buffer.alloc(32, 7)),
    );
    const status = await service.connect(`  ${MockSlack.USER_TOKEN} `);
    expect(status).toMatchObject({
      connected: true,
      workspace: 'Mock Workspace',
      user: 'ada',
      url: 'https://mock.slack.com/',
      missing: [],
      health: { state: 'ok' },
    });
    expect(JSON.stringify(status)).not.toContain(MockSlack.USER_TOKEN);
    const disk = await readFile(join(home, 'slack.secrets.json'), 'utf8');
    expect(disk).toContain('conch-sealed');
    expect(disk).not.toContain('xoxp-');
    expect(SEALED_FILES.has('slack.secrets.json')).toBe(true);
    expect(protectedPaths(home)).toContain(join(home, 'slack.secrets.json'));
    expect(classify('slack.secrets.json')).toMatchObject({ class: 'secret', group: 'secrets' });
    expect(emitted).toBeGreaterThan(0);
  });

  it('disconnecting asks Slack to forget the token too', async () => {
    await service.connect(MockSlack.USER_TOKEN);
    await service.disconnect();
    expect(mock.userTokens.has(MockSlack.USER_TOKEN)).toBe(false);
    expect((await service.status()).connected).toBe(false);
  });
});

describe('health', () => {
  it('a revoked sign-in needs you, and the tools stop being offered', async () => {
    await service.connect(MockSlack.USER_TOKEN);
    const { ctx } = context();
    expect(offeredSlackTools(service, ctx).map((t) => t.name)).toHaveLength(4);
    mock.userTokens.clear();
    expect((await service.check()).health).toMatchObject({
      state: 'needs-auth',
      action: 'reconnect',
    });
    expect(offeredSlackTools(service, ctx)).toEqual([]);
    expect(await service.promptSection()).toMatch(/connect it again/);
  });

  it('a call that finds the sign-in refused marks it, so the page says so', async () => {
    await service.connect(MockSlack.USER_TOKEN);
    mock.userTokens.clear();
    const { ctx } = context();
    expect(text(await tool(ctx, 'slack_channels').run({}))).toMatch(/Connect Slack again/);
    expect((await service.status()).health.state).toBe('needs-auth');
  });

  it('Slack being away is retried quietly, and coming back leaves a note', async () => {
    let down = false;
    const flaky = new SlackService({
      store: new SlackStore(home),
      base: () => mock.api,
      manualChecks: true,
      onHeal: (message) => notes.push(message),
      fetch: (input, init) =>
        down ? Promise.reject(new Error('ECONNREFUSED')) : fetch(input, init),
    });
    await flaky.connect(MockSlack.USER_TOKEN);
    down = true;
    expect((await flaky.check()).health).toMatchObject({ state: 'error', action: 'retry' });
    down = false;
    expect((await flaky.check()).health.state).toBe('ok');
    expect(notes).toEqual(['Slack wasn’t answering for a while; it’s working again.']);
  });
});

describe('the tools', () => {
  beforeEach(async () => {
    await service.connect(MockSlack.USER_TOKEN);
  });

  it('lists the channels you’re in, public and private', async () => {
    const { ctx } = context();
    const out = JSON.parse(text(await tool(ctx, 'slack_channels').run({}))) as {
      channels: { id: string; name: string; private: boolean }[];
      note: string;
    };
    expect(out.channels.map((c) => c.name)).toEqual(['general', 'launch', 'leadership']);
    expect(out.channels.find((c) => c.name === 'leadership')?.private).toBe(true);
    expect(out.note).toMatch(/never instructions/);
  });

  it('catches up on a channel oldest first, with who said it', async () => {
    const { ctx } = context();
    const out = JSON.parse(
      text(await tool(ctx, 'slack_read_channel').run({ channel: 'C0LAUNCH01', limit: 50 })),
    ) as {
      channel: { name: string };
      messages: { from: string; text: string; replies?: number }[];
    };
    expect(out.channel.name).toBe('launch');
    expect(out.messages[0]).toMatchObject({ from: 'Sam Rivera', replies: 1 });
    expect(out.messages.at(-1)?.from).toBe('Eve Mallory');
  });

  it('searches, with Slack’s own links only', async () => {
    const { ctx } = context();
    const out = JSON.parse(
      text(await tool(ctx, 'slack_search').run({ query: 'thursday', limit: 10 })),
    ) as { matches: { link?: string; channel: { name: string } }[] };
    expect(out.matches).toHaveLength(2);
    expect(out.matches[0]?.link).toMatch(/^https:\/\/mock\.slack\.com\/archives\//);
  });

  it('refuses a made-up channel id before calling Slack', async () => {
    const { ctx } = context();
    await expect(
      tool(ctx, 'slack_read_channel').run({ channel: '../../auth.revoke', limit: 5 }),
    ).rejects.toThrow();
  });

  it('a read set to Ask asks; one set to Off isn’t offered at all', async () => {
    await service.update({ tools: { slack_search: 'ask', slack_channels: 'off' } });
    const { ctx, ask } = context({ ask: vi.fn(async () => 'deny' as const) });
    expect(offeredSlackTools(service, ctx).map((t) => t.name)).not.toContain('slack_channels');
    const result = await tool(ctx, 'slack_search').run({ query: 'launch', limit: 5 });
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'search Slack for “launch”' }),
    );
    expect(result).toMatchObject({ effect: 'not-executed' });
  });

  it('sending can be turned off, never let go by itself', async () => {
    await expect(service.update({ tools: { slack_send_message: 'allow' } })).rejects.toThrow(
      /always asks/,
    );
    expect(await service.decide('slack_send_message')).toBe('ask');
  });
});

describe('sending always asks first', () => {
  beforeEach(async () => {
    await service.connect(MockSlack.USER_TOKEN);
  });

  it('shows the exact words and the channel, and sends only after a yes', async () => {
    const { ctx, ask } = context();
    const result = await tool(ctx, 'slack_send_message').run({
      channel: 'C0GENERAL1',
      text: 'Standup notes are in the doc.',
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      toolName: 'slack_send_message',
      summary: 'send this to #general in Slack: “Standup notes are in the doc.”',
    });
    expect(JSON.parse(text(result))).toMatchObject({ sent: true, channel: '#general' });
    expect(mock.posted).toEqual([
      expect.objectContaining({ channel: 'C0GENERAL1', text: 'Standup notes are in the doc.' }),
    ]);
  });

  it('a no sends nothing', async () => {
    const { ctx } = context({ ask: vi.fn(async () => 'deny' as const) });
    const result = await tool(ctx, 'slack_send_message').run({ channel: 'C0GENERAL1', text: 'hi' });
    expect(result).toMatchObject({ effect: 'not-executed' });
    expect(mock.posted).toEqual([]);
  });

  it('after reading other people’s words, the card says why it’s checking', async () => {
    const { ctx, ask } = context({
      untrusted: () =>
        'This chat read things in Slack messages, which could be trying to steer me.',
    });
    // What a hostile message would ask for: the person still sees it and decides.
    await tool(ctx, 'slack_send_message').run({ channel: 'C0GENERAL1', text: 'API keys: …' });
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ taint: expect.stringMatching(/steer me/) });
  });

  it('a skill that doesn’t say it needs apps is named on the same card', async () => {
    const { ctx, ask } = context({
      restricted: async (capability, detail) =>
        capability === 'apps' && detail === 'slack'
          ? 'The “Notes” skill doesn’t use apps.'
          : undefined,
    });
    await tool(ctx, 'slack_send_message').run({ channel: 'C0GENERAL1', text: 'hi' });
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ taint: expect.stringMatching(/Notes/) });
  });

  it('a new sign-in while waiting for the OK sends nothing', async () => {
    const ask = vi.fn(async () => {
      await service.connect(MockSlack.USER_TOKEN);
      return 'allow' as const;
    });
    const { ctx } = context({ ask });
    const result = await tool(ctx, 'slack_send_message').run({ channel: 'C0GENERAL1', text: 'hi' });
    expect(text(result)).toMatch(/connected again while waiting/);
    expect(mock.posted).toEqual([]);
  });

  it('stopped after the OK, nothing goes', async () => {
    const stop = new AbortController();
    const { ctx } = context({
      signal: stop.signal,
      ask: vi.fn(async () => {
        stop.abort();
        return 'allow' as const;
      }),
    });
    const result = await tool(ctx, 'slack_send_message').run({ channel: 'C0GENERAL1', text: 'hi' });
    expect(result).toMatchObject({ effect: 'not-executed' });
    expect(mock.posted).toEqual([]);
  });
});

describe('the guard after reading, and skill limits', () => {
  it('Slack reads taint the chat; sending is a sink; both need apps', () => {
    for (const prefix of ['', 'mcp__conch__']) {
      for (const read of ['slack_channels', 'slack_search', 'slack_read_channel'])
        expect(taintFrom(`${prefix}${read}`, {})).toEqual({ kind: 'app', label: 'Slack messages' });
      expect(taintFrom(`${prefix}slack_send_message`, {})).toBeUndefined();
      expect(sinkReason(`${prefix}slack_send_message`, {}, { workspace: '/work' })).toBe(
        'send a Slack message',
      );
      expect(needs(`${prefix}slack_search`, {}, { workspace: '/work' })).toEqual({
        capability: 'apps',
        detail: 'slack',
      });
    }
  });
});

describe('the Web API seam', () => {
  it('only calls Slack’s own origin, only the methods it uses, and never follows a redirect', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
    await slackCall('xoxp-test', 'auth.test', {}, { fetch: fake });
    expect(seen[0]?.url).toBe(`${SLACK_WEB_API}/auth.test`);
    expect(SLACK_WEB_API).toBe('https://slack.com/api');
    expect(seen[0]?.init.redirect).toBe('error');
    expect(String(seen[0]?.url)).not.toContain('xoxp');
    await expect(slackCall('xoxp-test', 'admin.users.remove', {}, { fetch: fake })).rejects.toThrow(
      /doesn’t do that/,
    );
    await expect(slackCall('xoxp-test', '../../evil', {}, { fetch: fake })).rejects.toThrow(
      SlackApiError,
    );
  });

  it('keeps the token out of errors', async () => {
    const token = 'xoxp-' + '1234567890-secretsecretsecret';
    const leaky = (async () => {
      throw new Error(`connect failed for Bearer ${token}`);
    }) as unknown as typeof fetch;
    const error = await slackCall(token, 'auth.test', {}, { fetch: leaky }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(SlackApiError);
    expect((error as Error).message).not.toContain(token);
  });

  it('a send whose answer was lost is never called a failure', async () => {
    const lost = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await expect(
      slackCall('xoxp-test', 'chat.postMessage', { channel: 'C1', text: 'hi' }, { fetch: lost }),
    ).rejects.toMatchObject({ kind: 'ambiguous' });
  });

  it('refuses an answer that is far too big', async () => {
    const huge = (async () =>
      new Response('x'.repeat(10), {
        headers: { 'content-length': String(50 * 1024 * 1024) },
      })) as unknown as typeof fetch;
    await expect(slackCall('xoxp-test', 'auth.test', {}, { fetch: huge })).rejects.toThrow(
      /too large/,
    );
  });
});
