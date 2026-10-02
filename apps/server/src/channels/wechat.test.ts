import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockWeChat } from './mock/wechat';
import { personId } from './types';
import { normalizeWeChat } from './wechat';
import {
  aesKeyOf,
  buildXml,
  decrypt,
  encrypt,
  newAesKey,
  newToken,
  parseXml,
  signature,
  signed,
} from './wechat-crypto';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-wechat-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const wechat = services.mockWeChat;
  if (!wechat) throw new Error('no mock WeChat');
  return { s: services, wechat };
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

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;

/**
 * Tencent's own sample (企业微信 "加解密方案说明" / WXBizMsgCrypt): the
 * Official Account uses the same scheme, with its AppID in place of the CorpID.
 */
const SAMPLE = {
  token: 'QDG6eK',
  aesKey: 'jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C',
  id: 'wx5823bf96d3bd56c7',
  verify: {
    signature: '5c45ff5e21c57e6ad56bac8758b79b1d9ac89fd3',
    timestamp: '1409659589',
    nonce: '263014780',
    echostr:
      'P9nAzCzyDtyTWESHep1vC5X9xho/qYX3Zpb4yKa9SKld1DsH3Iyt3tP3zNdtp+4RPcs8TgAE7OaBO+FZXvnaqQ==',
  },
  message: {
    signature: '477715d11cdb4164915debcba66cb864d751f3e6',
    timestamp: '1409659813',
    nonce: '1372623149',
    encrypt:
      'RypEvHKD8QQKFhvQ6QleEB4J58tiPdvo+rtK1I9qca6aM/wvqnLSV5zEPeusUiX5L5X/0lWfrf0QADHHhGd3QczcdCUpj911L3vg3W/sYYvuJTs3TUUkSUXxaccAS0qhxchrRYt66wiSpGLYL42aM6A8dTT+6k4aSknmPj48kzJs8qLjvd4Xgpue06DOdnLxAUHzM6+kDZ+HMZfJYuR+LtwGc2hgf5gsijff0ekUNXZiqATP7PF5mZxZ3Izoun1s4zG4LUMnvw2r+KqCKIw+3IQH03v+BCA9nMELNqbSf6tiWSrXJB3LAVGUcallcrw8V2t9EL4EhzJWrQUax5wLVMNS0+rUPA3k22Ncx4XXZS9o0MBH27Bo6BpNelZpS+/uh9KsNlY6bHCmJU9p8g7m3fVKn28H3KDYA5Pl/T8Z1ptDAVe0lXdQ2YoyyH2uyPIGHBZZIs2pDBS8R07+qN+E7Q==',
  },
};

describe('WeChat’s signatures and encryption', () => {
  it('verifies and decrypts Tencent’s own sample vectors', () => {
    const v = SAMPLE.verify;
    expect(signature(SAMPLE.token, v.timestamp, v.nonce, v.echostr)).toBe(v.signature);
    expect(signed(v.signature, SAMPLE.token, v.timestamp, v.nonce, v.echostr)).toBe(true);
    expect(decrypt(v.echostr, SAMPLE.aesKey, SAMPLE.id)).toBe('1616140317555161061');
    const m = SAMPLE.message;
    expect(signed(m.signature, SAMPLE.token, m.timestamp, m.nonce, m.encrypt)).toBe(true);
    const message = parseXml(decrypt(m.encrypt, SAMPLE.aesKey, SAMPLE.id));
    expect(message).toMatchObject({
      FromUserName: 'mycreate',
      MsgType: 'text',
      Content: 'hello',
      MsgId: '4561255354251345929',
    });
  });

  it('refuses a wrong signature, another account’s message, and tampered bytes', () => {
    const m = SAMPLE.message;
    expect(
      signed(m.signature.replace('4', '5'), SAMPLE.token, m.timestamp, m.nonce, m.encrypt),
    ).toBe(false);
    expect(signed('not-hex', SAMPLE.token, m.timestamp, m.nonce, m.encrypt)).toBe(false);
    expect(() => decrypt(m.encrypt, SAMPLE.aesKey, 'wx0000000000000000')).toThrow(
      /Not for this account/,
    );
    const bytes = Buffer.from(m.encrypt, 'base64');
    bytes[bytes.length - 40] = (bytes[bytes.length - 40] ?? 0) ^ 0xff;
    expect(() => decrypt(bytes.toString('base64'), SAMPLE.aesKey, SAMPLE.id)).toThrow();
  });

  it('encrypts replies WeChat can read (round trip, PKCS#7 to 32 bytes, fresh each time)', () => {
    const xml = buildXml({
      ToUserName: 'o1',
      FromUserName: 'gh',
      CreateTime: 1,
      MsgType: 'text',
      Content: '你好 ]]> world',
    });
    const a = encrypt(xml, SAMPLE.aesKey, SAMPLE.id);
    const b = encrypt(xml, SAMPLE.aesKey, SAMPLE.id);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64').length % 32).toBe(0);
    expect(parseXml(decrypt(a, SAMPLE.aesKey, SAMPLE.id)).Content).toBe('你好 ]]> world');
  });

  it('reads only WeChat’s flat XML: no DOCTYPE, no entities that expand', () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><xml><A>&a;</A></xml>')).toThrow();
    expect(() => parseXml('<html></html>')).toThrow();
    expect(parseXml('<xml><A>&lt;b&gt; &#20320;</A><B><![CDATA[<i>]]></B></xml>')).toEqual({
      A: '<b> 你',
      B: '<i>',
    });
    // What someone typed can't become a field of its own (or replace one).
    const sneaky = buildXml({
      FromUserName: 'oAda',
      Content: '</Content><FromUserName>oGrace</FromUserName><Content>x',
    });
    expect(parseXml(sneaky)).toEqual({
      FromUserName: 'oAda',
      Content: '</Content><FromUserName>oGrace</FromUserName><Content>x',
    });
    expect(
      parseXml('<xml><FromUserName>oAda</FromUserName><FromUserName>oGrace</FromUserName></xml>')
        .FromUserName,
    ).toBe('oAda');
  });

  it('makes a token and an EncodingAESKey WeChat accepts', () => {
    for (let i = 0; i < 50; i++) {
      const key = newAesKey();
      expect(key).toMatch(/^[A-Za-z0-9]{43}$/);
      expect(aesKeyOf(key)).toHaveLength(32);
    }
    expect(newToken()).toMatch(/^[A-Za-z0-9]{3,32}$/);
  });

  it('keeps an account’s token, key and address when only the AppSecret changes', () => {
    const first = normalizeWeChat({
      kind: 'wechat',
      mode: 'official',
      appId: ' wx0123456789abcdef ',
      secret: 's',
    });
    const again = normalizeWeChat(
      { kind: 'wechat', mode: 'official', appId: 'wx0123456789abcdef', secret: 't' },
      first,
    );
    expect(again).toMatchObject({
      token: first.token,
      aesKey: first.aesKey,
      hookId: first.hookId,
      secret: 't',
    });
  });
});

describe('WeChat through a WeCom bot (no public address)', { timeout: 30_000 }, () => {
  const keys = {
    kind: 'wechat' as const,
    mode: 'wecom' as const,
    appId: MockWeChat.BOT_ID,
    secret: MockWeChat.BOT_SECRET,
  };

  async function paired() {
    const ctx = await setup();
    const channel = await ctx.s.channels.create(keys);
    await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
    ctx.wechat.wecomSay('hi');
    await until(
      async () => (await ctx.s.channels.get(channel.id)).requests.length === 1,
      'request',
    );
    await ctx.s.channels.answer(channel.id, personId(MockWeChat.USER), 'allow');
    await until(() => ctx.wechat.sent.some((m) => m.text.includes('Hi AdaLovelace')), 'welcome');
    return { ...ctx, channel };
  }

  it('checks the Bot ID and Secret over the long connection', async () => {
    const { s } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({ ok: true, bot: { account: 'wecom' } });
    expect(await s.channels.check({ ...keys, secret: 'wrong' })).toMatchObject({
      ok: false,
      field: 'secret',
    });
  });

  it('talks with the owner, and an approval card’s press is answered', async () => {
    const { wechat } = await paired();
    wechat.wecomSay('please run the tests');
    const card = await until(() => wechat.sent.find((m) => m.card), 'a card');
    const allow = card.card?.buttons.find((b) => b.text === 'Allow');
    wechat.wecomPress(allow?.key ?? '', card.card?.task_id ?? '');
    await until(() => wechat.sent.some((m) => m.text.includes('Allowed')), 'the decision');
  });

  it('names another program that takes the bot’s connection, and Conch’s own check isn’t one', async () => {
    const { s, wechat, channel } = await paired();
    // Checking the keys again (the page does) is answered by the running connection,
    // not by opening another that would take the line from it.
    const before = wechat.connections;
    expect(await s.channels.check(keys)).toMatchObject({ ok: true });
    expect(wechat.connections).toBe(before);
    await new Promise((r) => setTimeout(r, 5_500));
    wechat.takeOver();
    await until(
      () => state(s, channel.id).then((st) => st === 'conflict'),
      'named as another program',
    );
    expect((await s.channels.get(channel.id)).health.message).toMatch(/Another program/);
  }, 30_000);
});

describe('WeChat through an Official Account (the public door)', { timeout: 40_000 }, () => {
  const keys = {
    kind: 'wechat' as const,
    mode: 'official' as const,
    appId: MockWeChat.APP_ID,
    secret: MockWeChat.APP_SECRET,
  };

  async function configured(options: { plain?: boolean } = {}) {
    const ctx = await setup();
    const channel = await ctx.s.channels.create(keys);
    await ctx.s.door.useTailscale();
    await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
    const hook = await ctx.s.channels.hookSecrets(channel.id);
    expect(hook.token).toMatch(/^[A-Za-z0-9]{3,32}$/);
    expect(hook.aesKey).toMatch(/^[A-Za-z0-9]{43}$/);
    // Pressing Submit in WeChat: it checks the address answers its echo.
    expect(
      await ctx.wechat.configure(
        hook.url ?? '',
        hook.token ?? '',
        options.plain ? undefined : hook.aesKey,
      ),
    ).toBe(200);
    await until(
      async () => (await ctx.s.channels.get(channel.id)).hook?.heardAt,
      'heard from WeChat',
    );
    return { ...ctx, channel, hook };
  }

  it('answers in the reply itself when it can, encrypted, and later as a customer-service message', async () => {
    const { s, wechat, channel } = await configured();
    const hello = await wechat.say('hi');
    expect(hello.reply).toMatch(/That’s me/);
    await s.channels.answer(channel.id, personId(MockWeChat.OWNER), 'allow');
    await until(
      () => wechat.sent.some((m) => m.via === 'custom' && m.text.includes('Hi WeChat')),
      'welcome, sent later',
    );
  });

  it('works in plaintext mode too (the test account’s)', async () => {
    const { wechat } = await configured({ plain: true });
    expect((await wechat.say('hi')).reply).toMatch(/That’s me/);
  });

  it('refuses forged and replayed deliveries', async () => {
    const { s, wechat, channel } = await configured();
    expect((await wechat.say('x', { tamper: true })).status).toBe(401);
    expect(
      (await wechat.say('x', { timestamp: String(Math.floor(Date.now() / 1000) - 3600) })).status,
    ).toBe(401);
    const url = s.door.localFor((await s.channels.get(channel.id)).hook?.url ?? '');
    expect(
      (
        await fetch(`${url}?signature=0&timestamp=1&nonce=1`, {
          method: 'POST',
          body: '<xml></xml>',
        })
      ).status,
    ).toBe(401);
    // The same message twice (WeChat retries; an attacker replays) is one request.
    const first = await wechat.say('once', { msgId: 77 });
    await wechat.say('once', { msgId: 77 });
    expect(first.status).toBe(200);
    const request = (await s.channels.get(channel.id)).requests[0];
    expect(request?.count).toBe(1);
  });

  it('an unverified account keeps the answer for the next message, and says so', async () => {
    const { s, wechat, channel } = await configured();
    wechat.verified = false;
    await wechat.say('hi');
    await s.channels.answer(channel.id, personId(MockWeChat.OWNER), 'allow');
    // The welcome couldn't be sent by itself: "?" fetches it.
    await new Promise((r) => setTimeout(r, 300));
    const fetched = await wechat.say('?');
    expect(fetched.reply).toMatch(/Hi WeChat/);
  });
});
