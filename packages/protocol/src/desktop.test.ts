import { describe, expect, it } from 'vitest';

import { AppToGateway, GatewayToApp, LoopbackUrl, ReleaseFeed } from './desktop';

describe('the desktop app and its gateway', () => {
  it('only ever opens an address on this computer', () => {
    for (const url of ['http://localhost:4317', 'http://127.0.0.1:4318/', 'http://[::1]:4317'])
      expect(LoopbackUrl.safeParse(url).success).toBe(true);
    for (const url of [
      'https://localhost:4317',
      'http://example.com',
      'http://localhost.example.com:4317',
      'http://user:pw@localhost:4317',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(LoopbackUrl.safeParse(url).success).toBe(false);
  });

  it('only downloads a release from GitHub', () => {
    expect(
      ReleaseFeed.safeParse('https://github.com/georgevibing/conch-agent/releases/download/v0.3.0')
        .success,
    ).toBe(true);
    for (const feed of [
      'http://github.com/a/b/releases/download/v0.3.0',
      'https://github.com.evil.example/a/b/releases/download/v0.3.0',
      'https://github.com/a/b/releases/download/v0.3.0/../../x',
      'https://evil.example/releases/download/v0.3.0',
    ])
      expect(ReleaseFeed.safeParse(feed).success).toBe(false);
  });

  it('drops a message it doesn’t know', () => {
    expect(
      GatewayToApp.safeParse({ type: 'listening', url: 'http://localhost:4317' }).success,
    ).toBe(true);
    expect(GatewayToApp.safeParse({ type: 'run', command: 'rm -rf /' }).success).toBe(false);
    expect(GatewayToApp.safeParse({ type: 'listening', url: 'https://evil.example' }).success).toBe(
      false,
    );
    expect(
      AppToGateway.safeParse({ type: 'update.progress', version: '0.3.0', percent: 140 }).success,
    ).toBe(false);
  });
});
