import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import { type GoogleService } from './service';
import { readMail, replyEnvelope } from './mail';
import { draftRaw, googleTools, matchesDraft, reconcileDraft } from './tools';

const source = [
  'From: Alice <alice@example.com>',
  'Reply-To: Alice <reply@example.com>',
  'To: Person <person@example.com>',
  'Subject: =?UTF-8?B?Q2FmZSDimJU=?=',
  'Message-ID: <original@example.com>',
  'References: <earlier@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="parts"',
  '',
  '--parts',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Meet at the caf=C3=A9.',
  '--parts',
  'Content-Type: text/html; charset=UTF-8',
  '',
  '<p>Meet at the <b>caf&eacute;</b>.</p><img src="https://evil.example/tracker">',
  '--parts--',
].join('\r\n');
const profile = {
  id: 'account1',
  email: 'person@example.com',
  name: 'Person',
  capabilities: ['mail-read', 'mail-draft'],
  state: 'ready',
};
const args = {
  accountId: 'account1',
  sourceMessageId: 'source1',
  to: ['reply@example.com'],
  subject: 'Cafe ☕',
  body: 'Thanks, I will be there.',
};
const message = (raw = source) => ({
  id: 'source1',
  threadId: 'thread1',
  labelIds: ['INBOX'],
  raw: Buffer.from(raw).toString('base64url'),
});
function fixture() {
  let savedRaw = '';
  const calls: { path: string; options?: Record<string, unknown> }[] = [];
  const api = vi.fn(
    async (_id: string, _capability: string, path: string, options?: Record<string, unknown>) => {
      calls.push({ path, options });
      if (path.includes('/messages/')) return message();
      if (options?.method === 'POST') {
        const body = options.body as { message: { raw: string } };
        savedRaw = body.message.raw;
        return { id: 'draft1', message: { id: 'draftMessage1', threadId: 'thread1' } };
      }
      if (path.endsWith('/drafts')) return { drafts: savedRaw ? [{ id: 'draft1' }] : [] };
      return { id: 'draft1', message: { id: 'draftMessage1', threadId: 'thread1', raw: savedRaw } };
    },
  );
  const service = {
    api,
    viaPassword: vi.fn(async () => false),
    status: vi.fn(async () => ({ configured: true, accounts: [profile] })),
    verificationScope: vi.fn(async () => ({
      account: 'account1',
      authorization: 'grant1',
      expiresAt: Date.now() + 100000,
    })),
  } as unknown as GoogleService;
  return { service, api, calls };
}
describe('readable mail and verified follow-up drafts', () => {
  it('marks only trusted truly-empty mail search evidence empty, never a model flag or paginated result', async () => {
    const { service, api } = fixture();
    const tool = googleTools(service, {} as ToolContext).find(
      (t) => t.name === 'google_mail_search',
    ) as unknown as {
      run: (args: Record<string, unknown>, context: { operationId: string }) => Promise<unknown>;
      verification: {
        reconcile: (
          args: Record<string, unknown>,
          id: string,
        ) => Promise<{ receipt: { empty?: boolean } }>;
      };
    };
    api.mockResolvedValueOnce({ messages: [], resultSizeEstimate: 0 } as never);
    const input = { accountId: 'account1', query: 'newer_than:1d', empty: true };
    await tool.run(input, { operationId: 'empty1' });
    expect((await tool.verification.reconcile(input, 'empty1')).receipt.empty).toBe(true);
    api.mockResolvedValueOnce({ messages: [], nextPageToken: 'more' } as never);
    await tool.run(input, { operationId: 'page1' });
    expect((await tool.verification.reconcile(input, 'page1')).receipt.empty).toBeUndefined();
  });
  it('decodes MIME content and headers with a real account-correct source link', async () => {
    const { service } = fixture();
    const mail = await readMail(service, 'account1', 'source1');
    expect(mail.view).toMatchObject({
      subject: 'Cafe ☕',
      from: ['alice@example.com'],
      replyTo: ['reply@example.com'],
      text: 'Meet at the café.\n',
      source: 'https://mail.google.com/mail/?authuser=person%40example.com#all/source1',
    });
    expect(JSON.stringify(mail.view)).not.toContain('evil.example');
  });
  it('converts HTML-only mail to text without loading images or executing scripts', async () => {
    const { service, api } = fixture();
    api.mockResolvedValueOnce(
      message(
        'From: sender@example.com\r\nTo: person@example.com\r\nContent-Type: text/html\r\n\r\n<p>Hello <b>world</b> &amp; friends</p><script>steal()</script><img src="https://evil.example/secret">',
      ),
    );
    const mail = await readMail(service, 'account1', 'source1');
    expect(mail.view.text).toContain('Hello world & friends');
    expect(mail.view.text).not.toMatch(/steal|evil.example|<script/);
  });
  it('binds thread, reply address, original subject and RFC reply headers', async () => {
    const { service } = fixture();
    const reply = await replyEnvelope(service, args);
    expect(reply).toEqual({
      threadId: 'thread1',
      inReplyTo: '<original@example.com>',
      references: '<earlier@example.com> <original@example.com>',
    });
    const raw = draftRaw(args, 'op1', reply);
    expect(raw).toContain('In-Reply-To: <original@example.com>');
    expect(matchesDraft(raw, args, 'op1', reply)).toBe(true);
    await expect(replyEnvelope(service, { ...args, to: ['thief@example.com'] })).rejects.toThrow(
      'recipients',
    );
    await expect(replyEnvelope(service, { ...args, subject: 'Changed subject' })).rejects.toThrow(
      'exact subject',
    );
    await expect(replyEnvelope(service, { ...args, threadId: 'otherThread' })).rejects.toThrow(
      'another thread',
    );
  });
  it('uses original recipients, not yourself, for sent follow-ups', async () => {
    const { service, api } = fixture();
    api.mockResolvedValueOnce({
      ...message(
        source
          .replace('Alice <alice@example.com>', 'Person <person@example.com>')
          .replace('To: Person <person@example.com>', 'To: Alice <alice@example.com>'),
      ),
      labelIds: ['SENT'],
    });
    expect(await replyEnvelope(service, { ...args, to: ['alice@example.com'] })).toMatchObject({
      threadId: 'thread1',
    });
  });
  it('asks with verified account and full body, saves one threaded draft, verifies actual provider contents', async () => {
    const { service, calls } = fixture();
    const ask = vi.fn(async () => 'allow' as const);
    const ctx = {
      ask,
      signal: new AbortController().signal,
      untrusted: () => 'This chat read email.',
      restricted: async () => 'This skill did not declare apps.',
    } as unknown as ToolContext;
    const draft = googleTools(service, ctx).find(
      (t) => t.name === 'google_mail_create_draft',
    ) as unknown as {
      run: (args: Record<string, unknown>, context: { operationId: string }) => Promise<string>;
    };
    const result = JSON.parse(await draft.run(args, { operationId: 'op1' })) as {
      state: string;
      receipt: { url: string };
    };
    expect(result.state).toBe('confirmed');
    expect(result.receipt.url).toContain('authuser=person%40example.com#drafts/draftMessage1');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        taint: 'This chat read email. This skill did not declare apps.',
        input: expect.objectContaining({ accountEmail: 'person@example.com', body: args.body }),
      }),
    );
    const writes = calls.filter((c) => c.options?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.options?.body).toMatchObject({ message: { threadId: 'thread1' } });
    expect(await reconcileDraft(service, args, 'op1')).toMatchObject({ state: 'confirmed' });
    await draft.run(args, { operationId: 'op1' });
    expect(calls.filter((c) => c.options?.method === 'POST')).toHaveLength(1);
  });
  it('hands ordinary chat drafts to a durable task without asking or writing', async () => {
    const { service, calls } = fixture();
    const ask = vi.fn();
    const handoff = vi.fn(async () => ({ id: 'task1' }));
    const draft = googleTools(service, { ask } as unknown as ToolContext, handoff).find(
      (t) => t.name === 'google_mail_create_draft',
    );
    const result = await draft?.run(args);
    expect(JSON.parse(result as string)).toMatchObject({ state: 'queued', taskId: 'task1' });
    expect(handoff).toHaveBeenCalledWith(args);
    expect(ask).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
  it('does not save if account authority changes while approval waits', async () => {
    const { service, calls } = fixture();
    const ask = vi.fn(async () => {
      vi.mocked(service.verificationScope).mockResolvedValue({
        account: 'account1',
        authorization: 'grant2',
        expiresAt: Date.now() + 10000,
      });
      return 'allow' as const;
    });
    const draft = googleTools(service, {
      ask,
      signal: new AbortController().signal,
    } as unknown as ToolContext).find((t) => t.name === 'google_mail_create_draft') as unknown as {
      run: (args: Record<string, unknown>, context: { operationId: string }) => Promise<string>;
    };
    expect(await draft.run(args, { operationId: 'op1' })).toMatchObject({ effect: 'not-executed' });
    expect(calls.some((c) => c.options?.method === 'POST')).toBe(false);
  });
});
