import { describe, expect, it } from 'vitest';

import { BrowserGuard, type GuardPolicy } from './guard';

const dns: Record<string, string[]> = {
  'example.com': ['93.184.215.14'],
  'rebind.evil.test': ['127.0.0.1'],
  'router.evil.test': ['192.168.1.1'],
  'metadata.evil.test': ['169.254.169.254'],
  'mixed.evil.test': ['93.184.215.14', '10.0.0.5'],
};

function guard(policy: Partial<GuardPolicy> = {}) {
  return new BrowserGuard(
    () => ({ allowLocal: false, gatewayPort: 4317, ...policy }),
    (host) => {
      const found = dns[host];
      return found ? Promise.resolve(found) : Promise.reject(new Error('ENOTFOUND'));
    },
  );
}

describe('BrowserGuard', () => {
  it('lets ordinary web pages through', async () => {
    expect(await guard().navigation('https://example.com/a?b=1')).toEqual({ ok: true });
    expect(await guard().navigation('about:blank')).toEqual({ ok: true });
  });

  it('only navigates to http(s)', async () => {
    for (const url of [
      'file:///etc/passwd',
      'chrome://settings',
      'javascript:alert(1)',
      'data:text/html,hi',
      'view-source:https://example.com',
    ]) {
      expect(await guard().navigation(url)).toMatchObject({ ok: false, reason: 'scheme' });
    }
    expect(await guard().navigation('not a url')).toMatchObject({ ok: false, reason: 'scheme' });
  });

  it('never reaches the gateway, even with local apps allowed', async () => {
    for (const allowLocal of [false, true]) {
      const g = guard({ allowLocal });
      for (const url of [
        'http://127.0.0.1:4317/api/state',
        'http://localhost:4317/',
        'http://[::1]:4317/',
        'ws://127.0.0.1:4317/ws',
        'http://rebind.evil.test:4317/api/permissions',
      ]) {
        expect(await g.request(url)).toMatchObject({ ok: false, reason: 'gateway' });
      }
    }
  });

  it('keeps out of this computer and the network unless allowed', async () => {
    const strict = guard();
    for (const url of [
      'http://localhost:3000/',
      'http://127.0.0.1:8080/',
      'http://192.168.1.1/',
      'http://router.evil.test/',
      'http://rebind.evil.test/',
      'https://mixed.evil.test/',
    ]) {
      expect(await strict.request(url)).toMatchObject({ ok: false, reason: 'local' });
    }
    const relaxed = guard({ allowLocal: true });
    expect(await relaxed.request('http://localhost:3000/')).toEqual({ ok: true });
    expect(await relaxed.request('http://192.168.1.1/')).toEqual({ ok: true });
  });

  it('never goes to link-local or cloud metadata addresses', async () => {
    for (const allowLocal of [false, true]) {
      expect(await guard({ allowLocal }).request('http://169.254.169.254/latest/')).toMatchObject({
        ok: false,
        reason: 'metadata',
      });
      expect(
        await guard({ allowLocal }).request('http://metadata.evil.test/computeMetadata/'),
      ).toMatchObject({ ok: false, reason: 'metadata' });
    }
  });

  it('refuses addresses with credentials and names it cannot check', async () => {
    expect(await guard().request('https://user:pw@example.com/')).toMatchObject({
      ok: false,
      reason: 'credentials',
    });
    expect(await guard().request('https://nowhere.invalid/')).toMatchObject({
      ok: false,
      reason: 'unresolved',
    });
  });

  it('ignores schemes that never touch the network', async () => {
    expect(await guard().request('data:image/png;base64,AAAA')).toEqual({ ok: true });
    expect(await guard().request('blob:https://example.com/1')).toEqual({ ok: true });
  });
});
