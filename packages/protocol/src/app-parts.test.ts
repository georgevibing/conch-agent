import { describe, expect, it } from 'vitest';

import { AppChannelPart, AppProviderPart, appOfProvider, appProviderId } from './app-parts';
import { EngineId, isAppProviderId } from './common';
import { appAbilities } from './conch-apps-words';
import { ChannelSecrets } from './channels';
import { ConchAppManifest } from './conch-apps';

const base = {
  conch: 1,
  id: 'fireworks',
  name: 'Fireworks AI',
  tagline: 'Fast open models',
  version: '1.0.0',
  icon: { glyph: 'zap', color: 'violet' },
  reaches: ['api.fireworks.ai'],
};

describe('a provider in a manifest (ADR 0119)', () => {
  it('reads the declarative shape, with no code', () => {
    const manifest = ConchAppManifest.parse({
      ...base,
      provider: {
        speaks: 'openai',
        address: 'https://api.fireworks.ai/inference/v1/',
        key: { label: 'Fireworks API key', link: 'https://fireworks.ai/account/api-keys' },
      },
    });
    expect(manifest.provider).toMatchObject({
      speaks: 'openai',
      // The trailing slash is tidied away.
      address: 'https://api.fireworks.ai/inference/v1',
      auth: 'bearer',
      models: [],
    });
  });

  it('says what is missing, in words', () => {
    const read = (provider: unknown) => AppProviderPart.safeParse(provider);
    expect(read({ speaks: 'openai' }).error?.issues[0]?.message).toMatch(/https address/);
    expect(
      read({ speaks: 'openai', address: 'http://api.example.com/v1', auth: 'none' }).success,
    ).toBe(false);
    expect(
      read({ speaks: 'openai', address: 'https://user:pw@api.example.com', auth: 'none' }).success,
    ).toBe(false);
    expect(
      read({ speaks: 'anthropic', address: 'https://api.example.com', auth: 'header' }).error
        ?.issues[0]?.message,
    ).toMatch(/Name the header/);
    expect(
      read({ speaks: 'openai', address: 'https://api.example.com' }).error?.issues[0]?.message,
    ).toMatch(/what the person types/);
    expect(read({ speaks: 'code', auth: 'none' }).error?.issues[0]?.message).toMatch(
      /lists its models/,
    );
  });

  it('never lets a key ride in a header that belongs to the connection', () => {
    for (const header of [
      'host',
      'Cookie',
      'content-length',
      'x-forwarded-for',
      'proxy-authorization',
    ])
      expect(
        AppProviderPart.safeParse({
          speaks: 'openai',
          address: 'https://api.example.com/v1',
          auth: 'header',
          header,
          key: { label: 'Key' },
        }).success,
        header,
      ).toBe(false);
  });

  it('is a provider id of its own, kept in the engine ids', () => {
    expect(appProviderId('fireworks')).toBe('app-fireworks');
    expect(appOfProvider('app-fireworks')).toBe('fireworks');
    expect(appOfProvider('openai')).toBeUndefined();
    expect(isAppProviderId('app-fireworks')).toBe(true);
    expect(EngineId.safeParse('app-fireworks').success).toBe(true);
    expect(EngineId.safeParse('app-../x').success).toBe(false);
  });
});

describe('a chat app in a manifest (ADR 0119)', () => {
  it('reads its fields, secret unless it says otherwise', () => {
    const part = AppChannelPart.parse({
      name: 'Zulip',
      fields: [
        { key: 'site', label: 'Your Zulip address', secret: false },
        { key: 'apiKey', label: 'The bot’s API key' },
      ],
    });
    expect(part.receives).toBe('poll');
    expect(part.fields.map((f) => f.secret)).toEqual([false, true]);
  });

  it('keeps its keys with the channel’s, by app', () => {
    expect(
      ChannelSecrets.parse({ kind: 'app', app: 'zulip', fields: { apiKey: 'k' } }),
    ).toMatchObject({ kind: 'app', app: 'zulip' });
    expect(ChannelSecrets.safeParse({ kind: 'app', app: '../x', fields: {} }).success).toBe(false);
  });

  it('says what it brings first on its card, and that keys stay in Conch', () => {
    const manifest = ConchAppManifest.parse({
      ...base,
      id: 'zulip',
      name: 'Zulip',
      tools: 'tools.mjs',
      reaches: ['chat.zulip.org'],
      channel: { fields: [{ key: 'apiKey', label: 'Bot API key' }] },
    });
    const lines = appAbilities(manifest, []);
    expect(lines[0]).toEqual({
      kind: 'channel',
      text: expect.stringMatching(
        /^Lets you talk to your assistant on Zulip; only delivers messages/,
      ),
    });
    expect(lines.find((l) => l.kind === 'needs')?.text).toBe(
      'Needs from you: Bot API key (kept by Conch, never in the app)',
    );
  });
});
