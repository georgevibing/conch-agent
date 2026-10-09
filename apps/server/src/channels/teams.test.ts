import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { askFirst } from '../test/modes';
import { MockTeams } from './mock/teams';
import { connectorAllowed, teamsText } from './teams';
import { teamsAppPackage } from './teams-app';
import { personId } from './types';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-teams-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await askFirst(services);
  await services.start();
  const teams = services.mockTeams;
  if (!teams) throw new Error('no mock Teams');
  return { s: services, teams, home };
}

async function until<T>(
  fn: () => T | Promise<T>,
  what: string,
  ms = 10_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const keys = {
  kind: 'microsoftteams' as const,
  appId: MockTeams.APP_ID,
  appPassword: MockTeams.SECRET,
};
/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;

/** Connected, its address public, pasted in "Azure", and Ada let in. */
async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(keys);
  await ctx.s.door.useTailscale();
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  const hook = (await ctx.s.channels.get(channel.id)).hook?.url;
  if (!hook) throw new Error('no address');
  ctx.teams.endpoint(hook);
  expect(await ctx.teams.say('hi')).toBe(200);
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, personId(MockTeams.OWNER.aadObjectId), 'allow');
  await until(() => ctx.teams.last()?.text.includes('Hi Ada'), 'welcome');
  return { ...ctx, channel, hook };
}

describe('Microsoft Teams', () => {
  it('checks the App ID and secret with Microsoft, naming the box that’s wrong', async () => {
    const { s } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({ ok: true, bot: { id: MockTeams.APP_ID } });
    expect(await s.channels.check({ ...keys, appPassword: 'wrong' })).toMatchObject({
      ok: false,
      field: 'appPassword',
    });
    expect(await s.channels.check({ ...keys, appId: 'not an id' })).toMatchObject({
      ok: false,
      field: 'appId',
    });
  });

  it('asks for the tenant of a single-tenant bot, and works with it', async () => {
    const { s, teams } = await setup();
    teams.singleTenant = true;
    const without = await s.channels.check(keys);
    expect(without).toMatchObject({ ok: false, field: 'tenantId' });
    expect(without.ok ? '' : without.message).toMatch(/Directory \(tenant\) ID/);
    expect(await s.channels.check({ ...keys, tenantId: MockTeams.TENANT })).toMatchObject({
      ok: true,
    });
  });

  it('serves its address only once the door is public, and says so until then', async () => {
    const { s } = await setup();
    const channel = await s.channels.create(keys);
    await until(() => state(s, channel.id).then((st) => st === 'error'), 'waiting for the door');
    expect((await s.channels.get(channel.id)).health.message).toMatch(/public address/);
    expect((await s.channels.get(channel.id)).hook?.url).toBeUndefined();
    const door = await s.door.useTailscale();
    expect(door).toMatchObject({
      state: 'ready',
      via: 'tailscale',
      url: 'https://conch-studio.tail1234.ts.net/conch',
    });
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    expect((await s.channels.get(channel.id)).hook?.url).toMatch(
      /^https:\/\/conch-studio\.tail1234\.ts\.net\/conch\/hooks\/[\w-]{24}$/,
    );
  });

  it('talks with the owner, and approvals come as a card whose press is checked', async () => {
    const { s, teams, channel } = await paired();
    expect(teams.last()?.text).toContain('<strong>');
    expect((await s.channels.get(channel.id)).hook?.heardAt).toBeDefined();
    await teams.say('please run the tests');
    const question = await until(() => teams.sent.find((m) => m.buttons.length === 3), 'a card');
    const allow = question.buttons.find((b) => b.title === 'Allow');
    // A stranger can't press it.
    await teams.deliver(
      teams.activity('', { stranger: true, value: { conch: allow?.data }, replyToId: question.id }),
    );
    await teams.press(allow?.data ?? '', question.id);
    await until(
      () => teams.sent.some((m) => m.updated && m.id === question.id && m.text.includes('Allowed')),
      'the card says it was allowed',
    );
  });

  it('sends a picture inside the message with its caption, and refuses other files honestly', async () => {
    const { s, teams } = await paired();
    const picture = await s.attachments.save({ name: 'beach.png', bytes: PNG });
    const notes = await s.attachments.save({ name: 'notes.pdf', bytes: Buffer.from('%PDF-1.4 x') });
    await s.attachments.claim([picture.id, notes.id], 'c_files');
    const done = await s.channels.messageOwner('Your **beach**', {
      attachments: [picture.id],
      conversationId: 'c_files',
    });
    expect(done).toMatchObject({ app: 'Microsoft Teams', sent: ['beach.png'] });
    const sent = teams.sent.find((m) => m.pictures?.length);
    expect(sent).toMatchObject({
      text: expect.stringContaining('<strong>beach</strong>'),
      pictures: [{ name: 'beach.png', type: 'image/png', size: PNG.length }],
    });
    await expect(
      s.channels.messageOwner('', { attachments: [notes.id], conversationId: 'c_files' }),
    ).resolves.toMatchObject({ sent: [], missed: [expect.stringMatching(/takes only pictures/)] });
  });

  it('refuses every forged delivery: wrong key, issuer, audience, service, channel, expired, none, HMAC', async () => {
    const { s, teams, channel } = await paired();
    const before = (await s.conversations.list()).length;
    for (const wrong of [
      'signature',
      'issuer',
      'audience',
      'expired',
      'service',
      'endorsement',
      'none',
      'hmac',
    ] as const)
      expect(await teams.forge(`forged: ${wrong}`, wrong), wrong).toBe(401);
    // No bearer at all, or a body that isn't an activity.
    const local = s.door.localFor((await s.channels.get(channel.id)).hook?.url ?? '');
    expect(
      (await fetch(local, { method: 'POST', body: JSON.stringify(teams.activity('x')) })).status,
    ).toBe(401);
    expect((await fetch(local, { method: 'POST', body: 'not json' })).status).toBe(400);
    // An address that isn't a channel's is nothing at all.
    expect(
      (
        await fetch(local.replace(/hooks\/[\w-]+$/, 'hooks/somebodyelse0000000000'), {
          method: 'POST',
        })
      ).status,
    ).toBe(404);
    expect((await fetch(local.replace(/\/hooks\/[\w-]+$/, '/api/health'))).status).toBe(404);
    await new Promise((r) => setTimeout(r, 500));
    expect((await s.conversations.list()).length).toBe(before);
    expect(teams.sent.some((m) => m.text.includes('forged'))).toBe(false);
  });

  it('remembers where your chat is, so a test reaches you after a restart', async () => {
    const { s, teams, channel } = await paired();
    s.channels.stop();
    await s.channels.start();
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    await s.channels.test(channel.id);
    await until(() => teams.last()?.text.includes('test from Conch'), 'the test message');
  });

  it('asks for a new secret when Microsoft stops accepting it', async () => {
    const { s, teams, channel } = await paired();
    teams.secrets.clear();
    await s.channels.repair(channel.id);
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'needs a new secret',
    );
  });
});

describe('Teams pieces', () => {
  it('sends the bot’s token only to Microsoft’s connector servers', () => {
    expect(connectorAllowed('https://smba.trafficmanager.net/amer/')).toBe(true);
    expect(connectorAllowed('https://smba.infra.gcc.teams.microsoft.com/x')).toBe(true);
    expect(connectorAllowed('https://evil.example/smba.trafficmanager.net/')).toBe(false);
    expect(connectorAllowed('http://smba.trafficmanager.net/amer/')).toBe(false);
    expect(connectorAllowed('https://smba.trafficmanager.net.evil.example/')).toBe(false);
  });

  it('reads what someone wrote without the mention or the markup', () => {
    expect(teamsText('<at>Conch</at> hello <b>there</b><br>and &amp; more')).toBe(
      'hello there\nand & more',
    );
  });

  it('parses mentions and markup without reassembling stripped tag fragments', () => {
    expect(teamsText('<at><b>Conch</b></at><p>Hello</p><p>there</p>')).toBe('Hello\n\nthere');
    expect(teamsText('<script>alert(1)</script>hello<style>body { color: red }</style>')).toBe(
      'hello',
    );
    expect(teamsText('<scr<at>Conch</at>ipt>hello</script>')).not.toContain('<script>');
    // Text extraction deliberately preserves escaped code as text. It is
    // escaped again by the outbound formatter, never trusted as HTML.
    expect(teamsText('&lt;script&gt;example&lt;/script&gt;')).toBe('<script>example</script>');
  });

  it('makes an app package Teams can read: a manifest and two icons of the right sizes', () => {
    const zip = teamsAppPackage({
      appId: MockTeams.APP_ID,
      name: 'Pearl',
      owner: 'Ada',
      website: 'https://example.ts.net/conch',
    });
    const files = new Map<string, Buffer>();
    for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
      const size = zip.readUInt32LE(at + 18);
      const nameLength = zip.readUInt16LE(at + 26);
      const name = zip.subarray(at + 30, at + 30 + nameLength).toString();
      const start = at + 30 + nameLength + zip.readUInt16LE(at + 28);
      files.set(name, zip.subarray(start, start + size));
      at = start + size;
    }
    const manifest = JSON.parse(files.get('manifest.json')?.toString() ?? '{}') as {
      id: string;
      bots: { botId: string; scopes: string[]; supportsFiles: boolean }[];
      name: { short: string };
    };
    expect(manifest.id).toBe(MockTeams.APP_ID);
    expect(manifest.bots[0]).toMatchObject({
      botId: MockTeams.APP_ID,
      scopes: ['personal'],
      supportsFiles: true,
    });
    expect(manifest.name.short).toBe('Pearl');
    const size = (png: Buffer | undefined) => [png?.readUInt32BE(16), png?.readUInt32BE(20)];
    expect(size(files.get('color.png'))).toEqual([192, 192]);
    expect(size(files.get('outline.png'))).toEqual([32, 32]);
  });
});
