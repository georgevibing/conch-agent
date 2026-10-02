import { registerSealer, unregisterSealer, deviceSealer } from '../lib/sealed';
import { classify } from '../backup/manifest';
import { protectedPaths } from '../lib/protect';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { GoogleService, SCOPES } from './service';
import { GoogleStore } from './store';
import { draftRaw, matchesDraft, reconcileDraft, googleTools } from './tools';
import { taintFrom, sinkReason } from '../conversations/taint';
import { needs } from '../skills/permissions';
import type { ToolContext } from '../conversations/manager';

let home: string;
const config = {
  clientId: 'test-client.apps.googleusercontent.com',
  clientSecret: 'not-a-real-client-secret',
  redirectUrl: 'https://conch.example/oauth/google/callback',
};
function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Missing test fixture');
  return value;
}
const scopes = [...SCOPES['mail-read'], ...SCOPES['mail-draft'], ...SCOPES['calendar-read']];
const fake = () => ({
  generateCodeVerifierAsync: vi.fn(async () => ({
    codeVerifier: 'secret-verifier',
    codeChallenge: 'public-challenge',
  })),
  generateAuthUrl: vi.fn(
    (params: Record<string, unknown>) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${String(params.state)}`,
  ),
  getToken: vi.fn(async () => ({
    tokens: {
      access_token: 'access-only-on-server',
      refresh_token: 'refresh-only-on-server',
      id_token: 'signed-identity',
      expiry_date: Date.now() + 3_600_000,
    },
  })),
  verifyIdToken: vi.fn(async () => ({
    getPayload: () => ({
      sub: 'account1',
      email: 'person@example.com',
      email_verified: true,
      name: 'Person',
    }),
  })),
  getTokenInfo: vi.fn(async () => ({
    aud: config.clientId,
    sub: 'account1',
    scopes,
    expiry_date: Date.now() + 3_600_000,
  })),
  setCredentials: vi.fn(),
  refreshAccessToken: vi.fn(async () => ({
    credentials: { access_token: 'renewed-access', expiry_date: Date.now() + 3_600_000 },
  })),
});
let store: GoogleStore,
  client: ReturnType<typeof fake>,
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>,
  service: GoogleService;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-google-'));
  store = new GoogleStore(home);
  client = fake();
  fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
  service = new GoogleService(store, () => client as unknown as OAuth2Client, fetcher);
  await service.configure(config, 'https://conch.example');
});
afterEach(async () => {
  unregisterSealer(home);
  await rm(home, { recursive: true, force: true });
});
async function connect() {
  const flow = await service.start(
    { capabilities: ['mail-read', 'mail-draft', 'calendar-read'] },
    'https://conch.example',
  );
  const state = must(new URL(flow.url).searchParams.get('state'));
  await service.finish(state, 'one-time-code', flow.nonce, 'https://conch.example');
  return flow;
}

describe('Google Desktop and remote setup', () => {
  const origin = 'https://conch.example';
  const local = 'http://127.0.0.1:4317';
  const downloaded = JSON.stringify({
    installed: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      project_id: 'my-conch-project',
      token_uri: 'https://attacker.example/token',
    },
  });
  const returned = (state: string, code = 'one-time-code') =>
    'http://127.0.0.1:1/?' + new URLSearchParams({ state, code }).toString();
  it('imports once with no callback registration and keeps old Web setup compatible', async () => {
    expect(await service.status()).toMatchObject({
      clientType: 'web',
      callbackUrl: config.redirectUrl,
    });
    await service.importCredentials({ credentials: downloaded }, origin);
    expect(await service.status()).toMatchObject({
      configured: true,
      clientType: 'desktop',
      projectId: 'my-conch-project',
    });
    expect(JSON.stringify(await service.status())).not.toMatch(/clientSecret|not-a-real|attacker/);
    expect((await store.read()).config?.redirectUrl).toBeUndefined();
    const flow = await service.start({ capabilities: ['mail-read'] }, local);
    expect(flow.mode).toBe('automatic');
    await service.finish(flow.flowId, 'code', flow.nonce, local);
    expect(client.getToken).toHaveBeenCalledWith(
      expect.objectContaining({ redirect_uri: local + '/oauth/google/callback' }),
    );
    expect(service.flowStatus(flow.flowId)).toEqual({ state: 'ready', accountId: 'account1' });
  });
  it('completes a remote Desktop flow with PKCE without fetching the pasted loopback address', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const flow = await service.start({ capabilities: ['mail-read'] }, origin);
    expect(flow.mode).toBe('manual');
    await service.complete(flow.flowId, { redirectUrl: returned(flow.flowId) }, flow.nonce, origin);
    expect(client.getToken).toHaveBeenCalledWith({
      code: 'one-time-code',
      codeVerifier: 'secret-verifier',
      redirect_uri: 'http://127.0.0.1:1/',
    });
    expect(
      fetcher.mock.calls.every(([url]) => String(url).startsWith('https://www.googleapis.com/')),
    ).toBe(true);
    expect(client.generateAuthUrl).toHaveBeenCalledWith(
      expect.not.objectContaining({ include_granted_scopes: true }),
    );
    await expect(
      service.complete(flow.flowId, { redirectUrl: returned(flow.flowId) }, flow.nonce, origin),
    ).rejects.toThrow('expired');
    expect(client.getToken).toHaveBeenCalledTimes(1);
  });
  it('uses the actual Google library to generate a PKCE native-client URL without a shared service', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const real = new GoogleService(store);
    const flow = await real.start({ capabilities: ['mail-read'] }, origin);
    const url = new URL(flow.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.has('include_granted_scopes')).toBe(false);
  });
  it('rejects return-address substitution, duplicate fields and mismatched state without spending the valid flow', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const flow = await service.start({ capabilities: ['mail-read'] }, origin);
    const address = returned(flow.flowId);
    for (const redirectUrl of [
      address.replace('127.0.0.1', 'attacker.example'),
      address.replace(':1/', ':2/'),
      address.replace('/?', '/different?'),
      address.replace(flow.flowId, 'wrong-state'),
      address + '&state=' + flow.flowId,
      address + '&code=other',
      address + '#fragment',
      address.replace('127.0.0.1', 'user@127.0.0.1'),
      'http://127.0.0.1:1/?state=' + flow.flowId,
    ])
      await expect(
        service.complete(flow.flowId, { redirectUrl }, flow.nonce, origin),
      ).rejects.toThrow();
    expect(client.getToken).not.toHaveBeenCalled();
    expect(service.flowStatus(flow.flowId)).toMatchObject({ state: 'pending', mode: 'manual' });
    await service.complete(flow.flowId, { redirectUrl: address }, flow.nonce, origin);
  });
  it('binds manual completion and cancellation to the initiating browser and origin', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const flow = await service.start({ capabilities: ['mail-read'] }, origin);
    for (const [nonce, address] of [
      ['wrong-browser', origin],
      [flow.nonce, 'https://attacker.example'],
    ] as const) {
      await expect(
        service.complete(flow.flowId, { redirectUrl: returned(flow.flowId) }, nonce, address),
      ).rejects.toThrow('another browser');
      service.cancel(flow.flowId, nonce, address);
    }
    expect(service.flowStatus(flow.flowId)).toMatchObject({ state: 'pending' });
    expect(client.getToken).not.toHaveBeenCalled();
    service.cancel(flow.flowId, flow.nonce, origin);
    expect(service.flowStatus(flow.flowId)).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('cancelled'),
    });
  });
  it('does not let the manual API consume an automatic flow or an automatic callback consume a manual flow', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const automatic = await service.start({ capabilities: ['mail-read'] }, local);
    await expect(
      service.complete(
        automatic.flowId,
        { redirectUrl: returned(automatic.flowId) },
        automatic.nonce,
        local,
      ),
    ).rejects.toThrow();
    const manual = await service.start({ capabilities: ['mail-read'] }, origin);
    await expect(service.finish(manual.flowId, 'code', manual.nonce, origin)).rejects.toThrow();
    expect(client.getToken).not.toHaveBeenCalled();
  });
  it('preserves existing native-client scopes when adding permissions on reconnect', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const first = await service.start({ capabilities: ['mail-read'] }, local);
    await service.finish(first.flowId, 'code', first.nonce, local);
    await service.start({ capabilities: ['drive-read'], accountId: 'account1' }, origin);
    expect(client.generateAuthUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.arrayContaining([...scopes, ...SCOPES['drive-read']]),
        login_hint: 'person@example.com',
      }),
    );
  });
  it('never saves credentials when cancelled during an in-flight token exchange', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const flow = await service.start({ capabilities: ['mail-read'] }, origin);
    const tokens = await fake().getToken();
    let release!: () => void;
    client.getToken.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return tokens;
    });
    const finish = service.complete(
      flow.flowId,
      { redirectUrl: returned(flow.flowId) },
      flow.nonce,
      origin,
    );
    service.cancel(flow.flowId, flow.nonce, origin);
    release();
    await expect(finish).rejects.toThrow('cancelled');
    expect((await service.status()).accounts).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cannot narrow an existing connection by picking it through the add-another-account path', async () => {
    await service.importCredentials({ credentials: downloaded }, origin);
    const first = await service.start({ capabilities: ['mail-read', 'calendar-read'] }, local);
    await service.finish(first.flowId, 'code', first.nonce, local);
    const original = (await store.read()).accounts.account1;
    client.getTokenInfo.mockResolvedValue({
      aud: config.clientId,
      sub: 'account1',
      scopes: SCOPES['calendar-read'],
      expiry_date: Date.now() + 3_600_000,
    });
    const next = await service.start({ capabilities: ['calendar-read'] }, origin);
    await expect(
      service.complete(next.flowId, { redirectUrl: returned(next.flowId) }, next.nonce, origin),
    ).rejects.toThrow('already connected with more access');
    expect((await store.read()).accounts.account1).toEqual(original);
  });
  it('returns curated consent failures, never raw Google errors', async () => {
    const flow = await service.start({ capabilities: ['mail-read'] }, origin);
    client.getToken.mockRejectedValue({
      response: { data: { error: 'invalid_client', error_description: 'secret-do-not-echo' } },
    });
    await expect(service.finish(flow.flowId, 'code', flow.nonce, origin)).rejects.toThrow(
      'download a current OAuth client JSON',
    );
    expect(service.flowStatus(flow.flowId)).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('Clients'),
    });
    expect(JSON.stringify(service.flowStatus(flow.flowId))).not.toContain('secret-do-not-echo');
  });
  it('diagnoses a disabled API and rechecks it without discarding consent', async () => {
    await connect();
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'private upstream detail',
              details: [{ reason: 'SERVICE_DISABLED' }],
            },
          }),
          { status: 403 },
        ),
    );
    expect((await service.check('account1')).accounts[0]).toMatchObject({
      state: 'unavailable',
      message: expect.stringContaining('Enable Gmail API'),
    });
    expect((await store.read()).accounts.account1?.credential.refreshToken).toBe(
      'refresh-only-on-server',
    );
    fetcher.mockImplementation(async () => new Response('{}'));
    expect((await service.check('account1')).accounts[0]).toMatchObject({ state: 'ready' });
    expect(client.getToken).toHaveBeenCalledTimes(1);
  });
});

describe('Google consent and credentials', () => {
  it('seals credentials at rest and includes the file in protected paths and passphrase-only backups', async () => {
    registerSealer(
      home,
      deviceSealer(async () => Buffer.alloc(32, 7)),
    );
    await connect();
    const disk = await readFile(join(home, 'google.secrets.json'), 'utf8');
    expect(disk).toContain('conch-sealed');
    expect(disk).not.toMatch(/access-only-on-server|refresh-only-on-server|person@example.com/);
    expect(protectedPaths(home)).toContain(join(home, 'google.secrets.json'));
    expect(classify('google.secrets.json')).toMatchObject({ class: 'secret', group: 'secrets' });
    expect((await service.status()).accounts).toHaveLength(1);
  });
  it('uses the exact origin, PKCE, actual scopes and verified identity; never returns credentials', async () => {
    await expect(
      service.configure(
        { ...config, redirectUrl: 'https://attacker.example/oauth/google/callback' },
        'https://conch.example',
      ),
    ).rejects.toThrow('Use this Conch');
    await expect(
      service.start({ capabilities: ['mail-read'] }, 'https://other.example'),
    ).rejects.toThrow('registered callback');
    await connect();
    expect(client.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        code_challenge: 'public-challenge',
        prompt: 'select_account consent',
        include_granted_scopes: true,
      }),
    );
    expect(client.getToken).toHaveBeenCalledWith(
      expect.objectContaining({ codeVerifier: 'secret-verifier' }),
    );
    const status = await service.status();
    expect(status.accounts[0]).toMatchObject({
      id: 'account1',
      email: 'person@example.com',
      state: 'ready',
    });
    expect(JSON.stringify(status)).not.toMatch(
      /access-only|refresh-only|clientSecret|secret-verifier/,
    );
  });
  it('keeps the exact browser flow pending through token exchange and cannot confuse a background account check with consent', async () => {
    const flow = await service.start({ capabilities: ['mail-read'] }, 'https://conch.example');
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tokens = {
      access_token: 'access',
      refresh_token: 'refresh',
      id_token: 'signed',
      expiry_date: Date.now() + 3600000,
    };
    client.getToken.mockImplementation(async () => {
      await hold;
      return { tokens };
    });
    const finish = service.finish(flow.flowId, 'code', flow.nonce, 'https://conch.example');
    expect(service.flowStatus(flow.flowId)).toMatchObject({ state: 'pending', mode: 'automatic' });
    release();
    await finish;
    expect(service.flowStatus(flow.flowId)).toEqual({ state: 'ready', accountId: 'account1' });
    expect(service.flowStatus('unrelated')).toEqual({ state: 'failed' });
  });
  it('rejects forged browser state, replay and callback origin changes before token exchange', async () => {
    const flow = await service.start({ capabilities: ['mail-read'] }, 'https://conch.example'),
      state = must(new URL(flow.url).searchParams.get('state'));
    await expect(
      service.finish(state, 'code', 'other-browser', 'https://conch.example'),
    ).rejects.toThrow('another browser');
    await expect(
      service.finish(state, 'code', flow.nonce, 'https://conch.example'),
    ).rejects.toThrow('expired');
    expect(client.getToken).not.toHaveBeenCalled();
    const second = await service.start({ capabilities: ['mail-read'] }, 'https://conch.example');
    await expect(
      service.finish(
        must(new URL(second.url).searchParams.get('state')),
        'code',
        second.nonce,
        'https://evil.example',
      ),
    ).rejects.toThrow('another browser');
  });
  it('rejects wrong account on reconnect, preserving the original account', async () => {
    await connect();
    client.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'account2',
        email: 'other@example.com',
        email_verified: true,
        name: 'Other',
      }),
    });
    const flow = await service.start(
      { capabilities: ['mail-read'], accountId: 'account1' },
      'https://conch.example',
    );
    await expect(
      service.finish(
        must(new URL(flow.url).searchParams.get('state')),
        'code',
        flow.nonce,
        'https://conch.example',
      ),
    ).rejects.toThrow('different Google account');
    expect((await service.status()).accounts.map((a) => a.id)).toEqual(['account1']);
  });
  it('refuses denied scopes and a token issued to another client', async () => {
    client.getTokenInfo.mockResolvedValue({
      aud: 'another-app',
      sub: 'account1',
      scopes: [],
      expiry_date: Date.now() + 1000,
    });
    await expect(connect()).rejects.toThrow('different account');
    expect((await service.status()).accounts).toHaveLength(0);
    client.getTokenInfo.mockResolvedValue({
      aud: config.clientId,
      sub: 'account1',
      scopes: [],
      expiry_date: Date.now() + 1000,
    });
    await expect(connect()).rejects.toThrow('did not allow');
  });
  it('never dispatches a draft when stopped during credential refresh', async () => {
    await connect();
    fetcher.mockClear();
    await store.update((d) => {
      must(d.accounts.account1).credential.expiresAt = 0;
    });
    const controller = new AbortController();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = await fake().refreshAccessToken();
    client.refreshAccessToken.mockImplementation(async () => {
      entered();
      await paused;
      return refresh;
    });
    const request = service.api('account1', 'mail-draft', '/gmail/v1/users/me/drafts', {
      method: 'POST',
      signal: controller.signal,
      body: {},
    });
    await started;
    controller.abort();
    release();
    await expect(request).rejects.toMatchObject({ kind: 'not-executed' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('single-flights concurrent refresh, preserves refresh token, and marks revoked consent', async () => {
    await connect();
    await store.update((d) => {
      must(d.accounts.account1).credential.expiresAt = 0;
    });
    await Promise.all([
      service.credential('account1', 'mail-read'),
      service.credential('account1', 'mail-read'),
    ]);
    expect(client.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(must((await store.read()).accounts.account1).credential.refreshToken).toBe(
      'refresh-only-on-server',
    );
    await store.update((d) => {
      must(d.accounts.account1).credential.expiresAt = 0;
    });
    client.refreshAccessToken.mockRejectedValue({ response: { data: { error: 'invalid_grant' } } });
    await expect(service.credential('account1', 'mail-read')).rejects.toThrow('revoked');
    expect(must((await service.status()).accounts[0]).state).toBe('needs-auth');
  });
  it('retains consent during an outage and does not revive a disconnected account on late refresh', async () => {
    await connect();
    await store.update((d) => {
      must(d.accounts.account1).credential.expiresAt = 0;
    });
    client.refreshAccessToken.mockRejectedValue(new Error('NETWORK secret should never appear'));
    await expect(service.credential('account1', 'mail-read')).rejects.toThrow(
      'could not be reached',
    );
    expect(must((await service.status()).accounts[0]).state).toBe('ready');
    client.refreshAccessToken.mockImplementation(async () => {
      await store.update((d) => {
        delete d.accounts.account1;
      });
      return { credentials: { access_token: 'late', expiry_date: Date.now() + 100000 } };
    });
    await expect(service.credential('account1', 'mail-read')).rejects.toThrow('account changed');
    expect((await service.status()).accounts).toHaveLength(0);
  });
  it('never contacts a supplied origin or a send endpoint, and never retries an ambiguous write', async () => {
    await connect();
    fetcher.mockClear();
    await expect(service.api('account1', 'mail-draft', 'https://attacker.example')).rejects.toThrow(
      'Unsupported',
    );
    await expect(
      service.api('account1', 'mail-draft', '/gmail/v1/users/me/messages/send', { method: 'POST' }),
    ).rejects.toThrow('cannot send');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error('timeout'));
    await expect(
      service.api('account1', 'mail-draft', '/gmail/v1/users/me/drafts', {
        method: 'POST',
        body: {},
      }),
    ).rejects.toThrow('may have saved');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('revokes through a POST body (never token URL), then removes local credentials', async () => {
    await connect();
    await service.disconnect('account1');
    const [url, options] = must(fetcher.mock.calls.at(-1));
    expect(String(url)).toBe('https://oauth2.googleapis.com/revoke');
    expect(options?.method).toBe('POST');
    expect(String(options?.body)).toContain('refresh-only-on-server');
    expect((await service.status()).accounts).toHaveLength(0);
  });
});

describe('draft receipts and injection guard', () => {
  const args = {
    accountId: 'account1',
    to: ['friend@example.com'],
    subject: 'Coffee ☕',
    body: 'Hello\nBring notes.',
  };
  it('binds receipt to operation, recipients, subject and body; never infers absence from search lag', async () => {
    const raw = draftRaw(args, 'op1');
    expect(matchesDraft(raw, args, 'op1')).toBe(true);
    expect(matchesDraft(raw, { ...args, body: 'changed' }, 'op1')).toBe(false);
    expect(matchesDraft(raw, args, 'op2')).toBe(false);
    await connect();
    fetcher.mockResolvedValue(new Response('{"drafts":[]}'));
    expect(await reconcileDraft(service, args, 'op1')).toEqual({ state: 'unknown' });
  });
  it('confirms exact draft readback only', async () => {
    await connect();
    fetcher
      .mockResolvedValueOnce(new Response('{"drafts":[{"id":"draft1"}]}'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft1',
            message: { id: 'msg1', raw: Buffer.from(draftRaw(args, 'op1')).toString('base64url') },
          }),
        ),
      );
    expect(await reconcileDraft(service, args, 'op1')).toMatchObject({
      state: 'confirmed',
      receipt: { id: 'draft1' },
    });
  });
  it('requires durable operation identity and approval; rejects header injection', async () => {
    const ctx = {
      ask: vi.fn(async () => 'deny'),
      signal: new AbortController().signal,
    } as unknown as ToolContext;
    const tool = must(googleTools(service, ctx).find((t) => t.name === 'google_mail_create_draft'));
    await expect(tool.run(args)).rejects.toThrow('durable');
    await expect(
      tool.run({ ...args, subject: 'Subject\r\nBcc: thief@example.com' }),
    ).rejects.toThrow();
    expect(ctx.ask).not.toHaveBeenCalled();
  });
  it('taints Google reads, treats draft as sink and requires app capability for both tool spellings', () => {
    for (const prefix of ['', 'mcp__conch__']) {
      expect(taintFrom(`${prefix}google_mail_read`, {})).toMatchObject({ kind: 'app' });
      expect(taintFrom(`${prefix}google_calendar_briefing`, {})).toMatchObject({ kind: 'app' });
      expect(sinkReason(`${prefix}google_mail_create_draft`, {}, { workspace: '/work' })).toBe(
        'save a Gmail draft',
      );
      expect(needs(`${prefix}google_mail_create_draft`, {}, { workspace: '/work' })).toEqual({
        capability: 'apps',
        detail: 'google',
      });
    }
  });
});
